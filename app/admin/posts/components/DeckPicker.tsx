"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { Button } from "@/components/ui/button";
import { DeckCovers } from "@/components/ui/DeckCovers";
import { deckIdFromUrl } from "@/app/articles/lib/markdown";
import { setDeckVisibilityAction } from "@/app/decklist/actions";
import { listMyDecksForEmbedAction, type EmbeddableDeck } from "../actions";

// Pick one of your own decks, or paste any deck link. A private deck can't be
// shown to readers, so picking one offers to make it unlisted first — the
// same action the deck builder's Share dialog runs.

const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

function VisibilityBadge({ v }: { v: EmbeddableDeck["visibility"] }) {
  const label = v === "private" ? "Private" : v === "unlisted" ? "Unlisted" : "Public";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
        v === "private" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

export default function DeckPicker({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Absolute deck URL to insert on its own paragraph. */
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<EmbeddableDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pending, setPending] = useState<EmbeddableDeck | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on the render that opens the dialog (see CardPicker); the fetch
  // below stays in an effect because it is a side effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFilter("");
      setLink("");
      setLinkError(null);
      setError(null);
      setPending(null);
      setDecks(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMyDecksForEmbedAction()
      .then((r) => {
        if (cancelled) return;
        if (r.success === false) setError(r.error);
        else setDecks(r.decks);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your decks. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const urlFor = (id: string) => `${window.location.origin}/decklist/${id}`;

  const choose = (d: EmbeddableDeck) => {
    if (d.visibility === "private") setPending(d);
    else onPick(urlFor(d.id));
  };

  const unlistAndPick = async (d: EmbeddableDeck) => {
    setBusy(true);
    setError(null);
    try {
      const r = await setDeckVisibilityAction(d.id, "unlisted");
      if (!r.success) {
        setError(r.error ?? "Couldn't change the deck's visibility.");
        return;
      }
      setDecks((list) => list?.map((x) => (x.id === d.id ? { ...x, visibility: "unlisted" } : x)) ?? null);
      onPick(urlFor(d.id));
    } catch {
      setError("Couldn't change the deck's visibility. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitLink = () => {
    const id = deckIdFromUrl(link);
    if (!id) {
      setLinkError("That doesn't look like a deck link.");
      return;
    }
    onPick(urlFor(id));
  };

  const needle = filter.trim().toLowerCase();
  const shown = (decks ?? []).filter((d) => !needle || d.name.toLowerCase().includes(needle));

  return (
    <>
      <Dialog
        open={open && pending === null}
        onOpenChange={(o) => {
          if (!o && !busy) onClose();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Embed a deck</DialogTitle>
            <DialogDescription>Readers see the cards inline with a link to the full deck.</DialogDescription>
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter your decks…"
              aria-label="Filter decks"
              autoComplete="off"
              className="mt-3 h-11 w-full rounded-md bg-muted/40 px-3 text-base text-foreground outline-none placeholder:text-muted-foreground"
            />
          </DialogHeader>
          <DialogBody className="px-2 py-2">
            {error && <p className="px-2 py-2 text-sm text-destructive">{error}</p>}
            {busy ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Making the deck unlisted…</p>
            ) : decks === null && !error ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Loading your decks…</p>
            ) : shown.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {decks && decks.length > 0 ? "No decks match." : "You don't have any decks yet. Paste a deck link below."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {shown.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => choose(d)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/60"
                    >
                      <DeckCovers deck={d} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{d.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[d.format, `${d.card_count} cards`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <VisibilityBadge v={d.visibility} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
          <DialogFooter className="flex-col items-stretch gap-2">
            <label className={LABEL} htmlFor="deck-picker-link">
              Or paste a deck link
            </label>
            <div className="flex gap-2">
              <input
                id="deck-picker-link"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitLink();
                  }
                }}
                placeholder="https://landofredemption.com/decklist/…"
                aria-label="Deck link"
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-md bg-muted/40 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button type="button" variant="outline" className="min-h-11" onClick={submitLink} disabled={!link.trim()}>
                Embed
              </Button>
            </div>
            {linkError && <p className="text-xs text-destructive">{linkError}</p>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
        onConfirm={() => {
          if (pending) void unlistAndPick(pending);
        }}
        variant="warning"
        title="Make this deck unlisted?"
        description={`“${pending?.name ?? ""}” is private, so readers couldn't see it. Unlisted decks are viewable by anyone with the link but stay out of the community gallery.`}
        confirmLabel="Make unlisted and embed"
      />
    </>
  );
}
