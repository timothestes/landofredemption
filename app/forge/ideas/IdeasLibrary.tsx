"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCard, type ForgeCardFull } from "@/app/forge/lib/cards";
import { bulkShareToSet, bulkLifecycle, type BulkResult } from "@/app/forge/lib/lifecycle";
import { BULK_DONE_VERB, deleteCopy } from "@/app/forge/lib/lifecycleCopy";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";
import NoFilterMatches from "@/app/forge/components/NoFilterMatches";
import { CARD_TYPES, BRIGADES, type CardType, type Brigade } from "@/app/forge/lib/designCard";
import { typeLabel, brigadeLabel } from "@/app/forge/lib/filterIcons";
import { noMatchCopy } from "@/app/forge/lib/cardFilters";
import { useGridPlace } from "@/app/forge/lib/useGridPlace";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";

export default function IdeasLibrary({ cards, canCreate, sets }: { cards: ForgeCardFull[]; canCreate: boolean; sets: ForgeSetSummary[] }) {
  const router = useRouter();
  const { filters, query, update, typeSearch, clear } = useGridPlace();
  const { q, type, brigade } = filters;
  const [creating, setCreating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [targetSet, setTargetSet] = useState("");

  const filtered = useMemo(() => cards.filter((c) => {
    const s = c.snapshot ?? {};
    if (q && !(c.title ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (type && !(s.cardType ?? []).includes(type)) return false;
    if (brigade && !(s.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [cards, q, type, brigade]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function onNew() {
    setCreating(true);
    const r = await createCard("");
    setCreating(false);
    if (r.ok) router.push(`/forge/cards/${r.id}`);
  }

  async function onBulkSend() {
    setBusy(true); setSummary(null);
    const r: BulkResult = await bulkShareToSet(targetSet, [...selected]);
    setBusy(false);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`Sent ${r.done} · ${r.skipped} skipped · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  async function onBulkDelete() {
    setBusy(true); setSummary(null);
    const r: BulkResult = await bulkLifecycle("delete", [...selected]);
    setBusy(false);
    if (r.ok === false) { setSummary(r.error); return; }
    setSummary(`${BULK_DONE_VERB.delete} ${r.done} · ${r.failed} failed`);
    setSelected(new Set());
    router.refresh();
  }

  const delCopy = deleteCopy(cards.filter((c) => selected.has(c.id)).map((c) => c.title));

  return (
    <div className="mx-auto max-w-6xl p-4 pb-28 sm:pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Ideas</h1>
        <input value={q} onChange={(e) => typeSearch(e.target.value)} placeholder="Search…" aria-label="Search ideas by name"
          className="rounded-md border bg-background px-3 py-1.5 text-sm" />
        <select value={type} onChange={(e) => update({ type: e.target.value as CardType | "" })} className="rounded-md border bg-background px-2 py-1.5 text-sm" aria-label="Filter by type">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
        <select value={brigade} onChange={(e) => update({ brigade: e.target.value as Brigade | "" })} className="rounded-md border bg-background px-2 py-1.5 text-sm" aria-label="Filter by brigade">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{brigadeLabel(b)}</option>)}
        </select>
        {query && filtered.length > 0 && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={clear}>
            Clear filters
          </Button>
        )}
        <Button size="sm" variant={selecting ? "secondary" : "outline"} className="h-8"
          onClick={() => { setSelecting(!selecting); setSelected(new Set()); setSummary(null); }}>
          {selecting ? "Done selecting" : "Select"}
        </Button>
        {canCreate && (
          <Button size="sm" className="h-8" onClick={onNew} disabled={creating}>New card</Button>
        )}
      </div>

      {selecting && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selected.size} selected</span>
          <button type="button" className="hover:text-foreground hover:underline"
            onClick={() => setSelected(new Set(filtered.map((c) => c.id)))}>
            Select all ({filtered.length})
          </button>
          <button type="button" className="hover:text-foreground hover:underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {summary && <span aria-live="polite" className="text-foreground">{summary}</span>}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="mx-auto mt-16 max-w-xs text-center">
          <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
          <p className="mb-3 text-sm text-muted-foreground">No ideas yet. Start with a name and a thought.</p>
          {canCreate && <Button onClick={onNew} disabled={creating}>Jot an idea</Button>}
        </div>
      ) : filtered.length === 0 ? (
        <NoFilterMatches message={noMatchCopy("ideas", filters)} onClear={clear} />
      ) : (
        <ForgeCardGrid cards={filtered} cardQuery={query} selection={{ active: selecting, selected, onToggle: toggle }} />
      )}

      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
          <select value={targetSet} onChange={(e) => setTargetSet(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm" aria-label="Destination set">
            <option value="">Send to set…</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button size="sm" className="h-8 text-xs" disabled={busy || !targetSet} onClick={onBulkSend}>
            {busy ? "Working…" : `Send ${selected.size} to set`}
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onBulkDelete}
        variant="destructive"
        title={delCopy.title}
        description={delCopy.description}
        confirmLabel={delCopy.confirmLabel}
      />
    </div>
  );
}
