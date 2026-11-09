"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, SlidersHorizontal, X } from "lucide-react";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import NoFilterMatches from "@/app/forge/components/NoFilterMatches";
import AddCardTile from "./AddCardTile";
import { bulkLifecycle, type BulkResult } from "@/app/forge/lib/lifecycle";
import {
  STATUS_LABEL, ACTION_LABEL, isEligible, bulkReleaseLabel, bulkConfirmCopy, bulkProposalNotice, bulkBlockedNotice, bulkSummary, releaseBlockers, READ_ONLY_SET_NOTE,
  type LifecycleAction, type BulkAction, type BulkConfirmAction,
} from "@/app/forge/lib/lifecycleCopy";
import { CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";
import { sortSetCards } from "@/app/forge/lib/cardOrder";
import { SET_STATUSES, activeFilterCount, visibleSetCards, noMatchCopy } from "@/app/forge/lib/cardFilters";
import { useGridPlace } from "@/app/forge/lib/useGridPlace";
import { typeLabel, brigadeLabel } from "@/app/forge/lib/filterIcons";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ReleaseInfo } from "@/app/forge/lib/versions";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BULK_ACTIONS: BulkAction[] = ["release", "markFinal", "shelve", "restore", "returnToIdeas", "delete"];
const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm max-sm:h-11 max-sm:w-full max-sm:min-w-0 max-sm:text-base";

// Whether the phone's filter panel was open when this grid was last on screen. It has to come back
// the same way after a trip to a card, or the page's height changes and the saved scroll lands wrong.
let filtersWereOpen = false;

export default function SetCardsBrowser({ cards, setId, canCreate, commentCounts, proposalCounts, releases }: { cards: ForgeCardFull[]; setId: string; canCreate: boolean; commentCounts?: Record<string, number>; proposalCounts?: Record<string, number>; releases?: Record<string, ReleaseInfo> }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const { filters, query, update, typeSearch, clear } = useGridPlace();
  const { q, status, type, brigade, since } = filters;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<BulkConfirmAction | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => filtersWereOpen);
  const activeFilters = activeFilterCount(filters);

  // Press "/" (when not already typing in a field) to reset the search and jump to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      update({ q: "" });
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update]);

  // Default order: the design team's print order (compareCardsDefault — sections,
  // multi-first brigade groups, strength). Shared with the single-card detail
  // view's prev/next arrows via sortSetCards.
  const sorted = useMemo(() => sortSetCards(cards), [cards]);

  // The same list the card page's arrows walk.
  const filtered = useMemo(() => visibleSetCards(sorted, filters, releases), [sorted, filters, releases]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const ids = [...selected];
  // "Release all" only sweeps drafts — re-releasing a playtesting card mints a
  // new frozen version, which stays a deliberate per-card (or selection) act.
  const draftIds = useMemo(() => filtered.filter((c) => c.status === "draft").map((c) => c.id), [filtered]);
  // How many selected cards each action would actually touch — shown on the button.
  const eligibleCards = (a: LifecycleAction) =>
    ids.flatMap((id) => { const c = byId.get(id); return c && isEligible(a, c.status) ? [c] : []; });
  const eligibleCount = (a: LifecycleAction) => eligibleCards(a).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function runBulk(action: LifecycleAction, targetIds: string[]) {
    setBusy(action);
    setSummary(null);
    const r: BulkResult = await bulkLifecycle(action, targetIds);
    setBusy(null);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(bulkSummary(action, r));
    setSelected(new Set());
    router.refresh();
  }

  const confirmingRelease = confirming === "release" || confirming === "releaseAll";
  const confirmEligible = confirming === "releaseAll"
    ? filtered.filter((c) => c.status === "draft")
    : eligibleCards(confirming ?? "delete");
  // A release skips cards with no name or type, so they don't count as being released.
  const confirmCards = confirmingRelease
    ? confirmEligible.filter((c) => releaseBlockers(c.snapshot ?? {}).length === 0)
    : confirmEligible;
  const confirmCopy = bulkConfirmCopy(confirming ?? "delete", { names: confirmCards.map((c) => c.title) });
  // Release closes open proposals (migration 083), so say so before it happens.
  const confirmNotices = confirmingRelease
    ? [
        ...bulkBlockedNotice(confirmEligible.length - confirmCards.length),
        ...bulkProposalNotice(confirmCards.reduce((sum, c) => sum + (proposalCounts?.[c.id] ?? 0), 0)),
      ]
    : [];

  return (
    <div className="relative pb-28 sm:pb-20">
      {/* A phone gets search on one row and the rest behind Filters and the More menu, so the first
          screen is mostly cards. display: contents from sm up leaves every control in the one row. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex w-full gap-2 sm:contents">
          <div className="relative max-sm:min-w-0 max-sm:flex-1">
            <input ref={searchRef} value={q} onChange={(e) => typeSearch(e.target.value)} placeholder="Search name or text… (press /)" aria-label="Search cards by name or text"
              className="rounded-md border bg-background px-3 py-1.5 pr-8 text-sm max-sm:h-11 max-sm:w-full max-sm:text-base" />
            {q && (
              <button type="button" aria-label="Clear search"
                onClick={() => { update({ q: "" }); searchRef.current?.focus(); }}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button variant={filtersOpen ? "secondary" : "outline"} className="h-11 shrink-0 px-3 sm:hidden" aria-expanded={filtersOpen}
            onClick={() => { filtersWereOpen = !filtersOpen; setFiltersOpen(!filtersOpen); }}>
            <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Filters{activeFilters > 0 && ` (${activeFilters})`}
          </Button>
        </div>
        <div className={`w-full grid-cols-2 gap-2 sm:contents ${filtersOpen ? "grid" : "hidden"}`}>
          <select value={status} onChange={(e) => update({ status: e.target.value })} className={selectClass} aria-label="Filter by status">
            <option value="">All statuses</option>
            {SET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select value={type} onChange={(e) => update({ type: e.target.value as CardType | "" })} className={selectClass} aria-label="Filter by type">
            <option value="">All types</option>
            {CARD_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <select value={brigade} onChange={(e) => update({ brigade: e.target.value as Brigade | "" })} className={selectClass} aria-label="Filter by brigade">
            <option value="">All brigades</option>
            {BRIGADES.map((b) => <option key={b} value={b}>{brigadeLabel(b)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:col-span-2 max-sm:whitespace-nowrap" title="A release or an accepted proposal. Saved edits don't make a new version.">
            New version since
            <input
              type="date"
              value={since}
              onChange={(e) => update({ since: e.target.value })}
              aria-label="Show cards with a new version since date"
              className={selectClass}
            />
          </label>
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} of {cards.length}</span>
        {query && filtered.length > 0 && (
          <Button size="sm" variant="ghost" className="h-11 px-2 text-xs text-muted-foreground sm:h-8" onClick={clear}>
            Clear filters
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 max-sm:ml-auto max-sm:justify-end">
          {selecting && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selected.size} selected</span>
              <button type="button" className="hover:text-foreground hover:underline"
                onClick={() => setSelected(new Set(filtered.map((c) => c.id)))}>
                Select all ({filtered.length})
              </button>
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
          {!selecting && canCreate && (
            <Button asChild size="sm" variant="outline" className="hidden h-8 sm:inline-flex">
              <Link href={`/forge/import?set=${setId}`}>Import cards</Link>
            </Button>
          )}
          {/* A rare whole-set act, so it doesn't take the page's one solid green. */}
          {!selecting && canCreate && draftIds.length > 0 && (
            <Button size="sm" variant="outline" className="hidden h-8 sm:inline-flex" disabled={busy !== null} onClick={() => setConfirming("releaseAll")}>
              {busy === "release" ? "Working…" : `Release all to playtest (${draftIds.length})`}
            </Button>
          )}
          {canCreate ? (
            <Button
              size="sm" variant={selecting ? "secondary" : "outline"} className="h-11 sm:h-8"
              onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}
            >
              {selecting ? "Done selecting" : "Select"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{READ_ONLY_SET_NOTE}</span>
          )}
          {!selecting && canCreate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-11 w-11 p-0 sm:hidden" disabled={busy !== null} aria-label="More actions">
                  {busy === "release" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild className="min-h-11">
                  <Link href={`/forge/import?set=${setId}`}>Import cards</Link>
                </DropdownMenuItem>
                {draftIds.length > 0 && (
                  <DropdownMenuItem className="min-h-11" onSelect={() => setConfirming("releaseAll")}>
                    Release all to playtest ({draftIds.length})
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {summary && (
        <div aria-live="polite" className="mb-3 text-xs text-foreground">{summary}</div>
      )}

      {filtered.length === 0 ? (
        <NoFilterMatches message={noMatchCopy("cards", filters)} onClear={clear} />
      ) : (
        <ForgeCardGrid
          cards={filtered}
          cardQuery={query}
          showStatus
          commentCounts={commentCounts}
          proposalCounts={proposalCounts}
          releaseBadges={since ? Object.fromEntries(
            filtered.flatMap((c) => {
              const rel = releases?.[c.id];
              // Draft iterations count as activity but must not read as releases.
              return rel ? [[c.id, `v${rel.versionNumber}${rel.status === "draft" ? " draft" : ""} · ${new Date(rel.releasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`]] : [];
            })
          ) : undefined}
          versionNumbers={Object.fromEntries(
            Object.entries(releases ?? {}).map(([id, r]) => [id, r.versionNumber])
          )}
          selection={{ active: selecting, selected, onToggle: toggle }}
          leading={canCreate ? <AddCardTile setId={setId} disabled={selecting} /> : undefined}
        />
      )}

      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
          {BULK_ACTIONS.map((a) => {
            const n = eligibleCount(a);
            const danger = a === "delete";
            const name = a === "release" ? bulkReleaseLabel(eligibleCards(a).map((c) => c.status)) : ACTION_LABEL[a];
            const label = busy === a ? "Working…" : `${name}${n ? ` (${n})` : ""}`;
            return (
              <Button
                key={a}
                size="sm"
                variant={a === "release" ? "default" : "outline"}
                className={`h-8 text-xs ${danger ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" : ""}`}
                disabled={busy !== null || n === 0}
                onClick={() => setConfirming(a)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}

      <ConfirmationDialog
        open={confirming !== null}
        onOpenChange={(o) => { if (!o) setConfirming(null); }}
        onConfirm={() => {
          const a = confirming;
          setConfirming(null);
          if (a === "releaseAll") runBulk("release", draftIds);
          else if (a) runBulk(a, ids);
        }}
        variant={confirming === "delete" ? "destructive" : "warning"}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
      >
        {confirmNotices.length > 0 && (
          <ul className="space-y-1 rounded-md border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            {confirmNotices.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </ConfirmationDialog>
    </div>
  );
}
