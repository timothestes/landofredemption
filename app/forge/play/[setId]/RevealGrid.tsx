"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFocusTrap } from "@/app/collection/scan/hooks/useFocusTrap";
import type { DesignCard, CardType, Brigade } from "@/app/forge/lib/designCard";
import { cardRawText, CARD_TYPES, BRIGADES } from "@/app/forge/lib/designCard";
import { textFit } from "@/app/forge/lib/textFit";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import PlaytesterComments from "./PlaytesterComments";

// Serialized into a playtester's page, so it carries the released card only. Nothing about the
// working draft belongs here, not even a flag saying it has moved on.
export type RevealItem = { cardId: string; data: DesignCard; artUrl: string | null; finishedUrl: string | null; versionNumber: number };

const selectClass = "rounded-md border bg-background px-2 py-1.5 text-sm";

// The deck builder's face: the uploaded finished image, else the frame drawn in the browser from
// the released snapshot. Not the art proxy's kind=rendered: that is one function call per tile
// on a cache miss, and this costs the server nothing.
function RevealFace({ item }: { item: RevealItem }) {
  return item.finishedUrl ? (
    <ForgeCardFace name={item.data.name ?? null} rawText={cardRawText(item.data)} finishedUrl={item.finishedUrl} artUrl={item.artUrl} className="w-full rounded-md" />
  ) : (
    <ForgeCardPreview card={item.data} artUrl={item.artUrl} className="w-full rounded-md" />
  );
}

function CardModal({ item, currentUserId, onClose }: { item: RevealItem; currentUserId: string; onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [hasDraft, setHasDraft] = useState(false);
  const [held, setHeld] = useState(false);

  // The trap only catches Tab at the first and last control. Safari's Tab skips buttons, so
  // Shift+Tab from the comment box never reaches "first" and lands on the page behind.
  useEffect(() => {
    const keepInside = (e: FocusEvent) => {
      if (!trapRef.current?.contains(e.target as Node)) trapRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("focusin", keepInside);
    return () => document.removeEventListener("focusin", keepInside);
  }, []);
  useFocusTrap(trapRef, true);

  // Written feedback is what the Forge wants from a playtester, so no way out of this modal
  // drops a typed comment without asking. Discarding is the one explicit way past it.
  const requestClose = () => {
    if (!hasDraft) {
      onClose();
      return;
    }
    setHeld(true);
    const fields = trapRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input");
    Array.from(fields ?? []).find((f) => f.value.trim())?.focus();
  };

  // Posting or clearing the comment answers the question, so it goes away.
  useEffect(() => {
    if (!hasDraft) setHeld(false);
  }, [hasDraft]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }} aria-labelledby={titleId}>
      <DialogContent size="lg" className="max-w-3xl">
        <div ref={trapRef} className="flex min-h-0 flex-col">
          {/* Pinned, so Close stays in reach below a long comment thread. */}
          <div className="flex shrink-0 items-center justify-between gap-2 pl-4 pr-1">
            <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold">{item.data.name?.trim() || "Untitled"}</h2>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">v{item.versionNumber}</span>
              <button type="button" aria-label="Close" onClick={requestClose} className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          {held && (
            <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-y bg-muted px-4 py-2 text-sm">
              <span>Your comment hasn&apos;t been posted.</span>
              <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={onClose}>
                Discard and close
              </Button>
            </div>
          )}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4 sm:flex-row">
            {/* On a phone the height cap leaves the comment box on screen; 15rem is the header,
                the Comments heading, the box and the gutters. */}
            <div className="mx-auto w-full max-w-[min(24rem,calc((100dvh-15rem)*5/7))] shrink-0 sm:mx-0 sm:w-64 sm:max-w-none md:w-80">
              <RevealFace item={item} />
              {/* An ability too long for the frame runs off the face, and this modal is the
                  only place to read a card. */}
              {!item.finishedUrl && textFit(item.data).over > 0 && (
                <p className="mt-2 whitespace-pre-wrap text-sm">{cardRawText(item.data)}</p>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-2 text-sm font-semibold">Comments</h3>
              <PlaytesterComments cardId={item.cardId} currentUserId={currentUserId} onDraftChange={setHasDraft} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function RevealGrid({ items, currentUserId }: { items: RevealItem[]; currentUserId: string }) {
  const [active, setActive] = useState<RevealItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<CardType | "">("");
  const [brigade, setBrigade] = useState<Brigade | "">("");

  // Press "/" (when not already typing in a field) to reset the search and jump to it.
  useEffect(() => {
    if (active) return; // The search sits behind the open modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      setQ("");
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // Default order: by card type, then brigade, then name. Type and brigade use
  // the canonical model order (CARD_TYPES / BRIGADES); cards missing a primary
  // type or brigade sort last within their group.
  const sorted = useMemo(() => {
    const rank = (value: string | undefined, order: readonly string[]) => {
      const i = value ? order.indexOf(value) : -1;
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const typeRank = (it: RevealItem) => rank(it.data.cardType?.[0], CARD_TYPES);
    const brigadeRank = (it: RevealItem) => rank(it.data.brigades?.[0], BRIGADES);
    return [...items].sort(
      (a, b) =>
        typeRank(a) - typeRank(b) ||
        brigadeRank(a) - brigadeRank(b) ||
        (a.data.name ?? "").localeCompare(b.data.name ?? ""),
    );
  }, [items]);

  const filtered = useMemo(() => sorted.filter((it) => {
    const d = it.data;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${d.name ?? ""}\n${cardRawText(d)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (type && !(d.cardType ?? []).includes(type)) return false;
    if (brigade && !(d.brigades ?? []).includes(brigade)) return false;
    return true;
  }), [sorted, q, type, brigade]);

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground">No cards shared for playtesting yet.</p>;
  }

  return (
    <>
      <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
        <div className="relative">
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or text… (press /)"
            className="rounded-md border bg-background px-3 py-1.5 pr-8 text-sm" />
          {q && (
            <button type="button" aria-label="Clear search"
              onClick={() => { setQ(""); searchRef.current?.focus(); }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value as CardType | "")} className={selectClass} aria-label="Filter by type">
          <option value="">All types</option>
          {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={brigade} onChange={(e) => setBrigade(e.target.value as Brigade | "")} className={selectClass} aria-label="Filter by brigade">
          <option value="">All brigades</option>
          {BRIGADES.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {items.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No cards match your filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((it) => (
            <button key={it.cardId} onClick={() => setActive(it)} className="block w-full text-left">
              <RevealFace item={it} />
              <span className="mt-1 block text-xs tabular-nums text-muted-foreground">v{it.versionNumber}</span>
            </button>
          ))}
        </div>
      )}
      {active && <CardModal item={active} currentUserId={currentUserId} onClose={() => setActive(null)} />}
    </>
  );
}
