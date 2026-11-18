"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import type { CardSearchHit } from "@/lib/cards/search";

// Search-and-pick for `[[Card Name]]`. Opened by the toolbar button or by
// typing "[[" in the body. Stays mounted in the editor; the Dialog unmounts
// its children when closed, so state is reset on every open.
//
// Where the names come from is the caller's business: the article editor goes
// through a poster-gated server action, the deck-description editors search the
// card index they already have in the browser.

const MIN_QUERY = 2;

export default function CardPicker({
  open,
  initialQuery,
  search,
  onPick,
  onClose,
}: {
  open: boolean;
  initialQuery: string;
  /** Name search; may reject or return [] — whatever list is showing then stays. */
  search: (query: string) => Promise<CardSearchHit[]>;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<CardSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  // Held in a ref so an inline arrow from the caller does not restart the
  // debounce on every render.
  const searchRef = useRef(search);
  searchRef.current = search;

  // Reset on the render that opens the dialog — not in an effect, which
  // commits a frame late and let a fast typist append to the previous query.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery(initialQuery);
      setHits([]);
      setActive(0);
    }
  }

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setHits([]);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const cards = await searchRef.current(q);
        if (id !== seq.current) return;
        setHits(cards);
        setActive(0);
      } catch {
        // Keep whatever list is showing.
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [query, open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) onPick(h.name);
    }
  };

  const tooShort = query.trim().length < MIN_QUERY;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* One height: sized to its hits, the centered box re-centered on every
          keystroke and moved the search input being typed in. */}
      <DialogContent size="md" className="h-[min(32rem,calc(100dvh-2rem))]">
        <DialogHeader>
          <DialogTitle>Mention a card</DialogTitle>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by card name…"
            aria-label="Card name"
            autoComplete="off"
            className="mt-3 h-11 w-full rounded-md bg-muted/40 px-3 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
        </DialogHeader>
        <DialogBody className="px-2 py-2">
          {tooShort ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">Type at least two letters.</p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{loading ? "Searching…" : "No cards match."}</p>
          ) : (
            <ul role="listbox" aria-label="Matching cards" className="space-y-0.5">
              {hits.map((h, i) => (
                <li key={`${h.name}|${h.set}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => onPick(h.name)}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${
                      i === active ? "bg-muted" : "hover:bg-muted/60"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getCardImageUrl(h.imgFile)}
                      alt=""
                      width={32}
                      height={45}
                      loading="lazy"
                      className="h-[45px] w-8 shrink-0 rounded-sm bg-muted object-cover"
                    />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{h.label}</span>
                        {/* Why this row matched a query that is not its name. */}
                        {h.alias && (
                          <span className="flex-shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                            {h.alias}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[h.type, h.brigade, h.set].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
