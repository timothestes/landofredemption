"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import AddCardTile from "./AddCardTile";
import { bulkLifecycle, type BulkResult } from "@/app/forge/lib/lifecycle";
import {
  STATUS_LABEL, ACTION_LABEL, isEligible, bulkReleaseLabel, bulkConfirmCopy, bulkProposalNotice, bulkBlockedNotice, bulkSummary, releaseBlockers,
  type LifecycleAction, type BulkAction, type BulkConfirmAction,
} from "@/app/forge/lib/lifecycleCopy";
import { cardRawText, CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";
import { sortSetCards } from "@/app/forge/lib/cardOrder";
import { SET_STATUSES } from "@/app/forge/lib/cardFilters";
import { useGridPlace } from "@/app/forge/lib/useGridPlace";
import { typeLabel, brigadeLabel } from "@/app/forge/lib/filterIcons";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { ReleaseInfo } from "@/app/forge/lib/versions";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

const BULK_ACTIONS: BulkAction[] = ["release", "markFinal", "shelve", "restore", "returnToIdeas", "delete"];
const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm";

export default function SetCardsBrowser({ cards, setId, canCreate, commentCounts, proposalCounts, releases }: { cards: ForgeCardFull[]; setId: string; canCreate: boolean; commentCounts?: Record<string, number>; proposalCounts?: Record<string, number>; releases?: Record<string, ReleaseInfo> }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const { filters, query, update, typeSearch } = useGridPlace();
  const { q, status, type, brigade, since } = filters;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<BulkConfirmAction | null>(null);

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

  const filtered = useMemo(() => sorted.filter((c) => {
    const s = c.snapshot ?? {};
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${c.title ?? ""}\n${cardRawText(s)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (status && c.status !== status) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    if (since) {
      const cutoff = Date.parse(since);
      const rel = releases?.[c.id];
      if (!rel || Date.parse(rel.releasedAt) < cutoff) return false;
    }
    return true;
  }), [sorted, q, status, type, brigade, since, releases]);

  const shown = useMemo(() => {
    if (!since) return filtered;
    return [...filtered].sort(
      (a, b) => Date.parse(releases?.[b.id]?.releasedAt ?? "") - Date.parse(releases?.[a.id]?.releasedAt ?? "")
    );
  }, [filtered, since, releases]);

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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <input ref={searchRef} value={q} onChange={(e) => typeSearch(e.target.value)} placeholder="Search name or text… (press /)" aria-label="Search cards by name or text"
            className="rounded-md border bg-background px-3 py-1.5 pr-8 text-sm" />
          {q && (
            <button type="button" aria-label="Clear search"
              onClick={() => { update({ q: "" }); searchRef.current?.focus(); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
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
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="A release or an accepted proposal. Saved edits don't make a new version.">
          New version since
          <input
            type="date"
            value={since}
            onChange={(e) => update({ since: e.target.value })}
            aria-label="Show cards with a new version since date"
            className={selectClass}
          />
        </label>
        <span className="text-xs text-muted-foreground">{filtered.length} of {cards.length}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {selecting && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selected.size} selected</span>
              <button type="button" className="hover:text-foreground hover:underline"
                onClick={() => setSelected(new Set(shown.map((c) => c.id)))}>
                Select all ({shown.length})
              </button>
              <button type="button" className="hover:text-foreground hover:underline" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
          {!selecting && canCreate && (
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link href={`/forge/import?set=${setId}`}>Import cards</Link>
            </Button>
          )}
          {!selecting && draftIds.length > 0 && (
            <Button size="sm" className="h-8" disabled={busy !== null} onClick={() => setConfirming("releaseAll")}>
              {busy === "release" ? "Working…" : `Release all to playtest (${draftIds.length})`}
            </Button>
          )}
          <Button
            size="sm" variant={selecting ? "secondary" : "outline"} className="h-8"
            onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}
          >
            {selecting ? "Done selecting" : "Select"}
          </Button>
        </div>
      </div>

      {summary && (
        <div aria-live="polite" className="mb-3 text-xs text-foreground">{summary}</div>
      )}

      <ForgeCardGrid
        cards={shown}
        cardQuery={query}
        showStatus
        commentCounts={commentCounts}
        proposalCounts={proposalCounts}
        releaseBadges={since ? Object.fromEntries(
          shown.flatMap((c) => {
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
