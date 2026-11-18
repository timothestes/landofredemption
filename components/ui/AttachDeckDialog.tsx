"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, BookOpen } from "lucide-react";
import { getCardImageUrl } from "../../app/shared/utils/cardImageUrl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "./dialog";
import { searchDecksForTournamentAction, type DeckSearchResult } from "../../app/tracker/tournaments/actions";
import { FORMATS, normalizeFormat, normalizeTournamentFormat } from "../../lib/formats";
import { FormatBadge } from "./FormatBadge";

interface AttachDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantName: string;
  // The tournament's raw deck_format column. null/'Other' (draft, sealed, or
  // simply unset — the overwhelming majority of real tournaments) means
  // "attach anything," matching today's ungated behavior (spec §6).
  tournamentFormat?: string | null;
  onSelect: (deck: DeckSearchResult) => void;
}

// Whether `deck` is attachable to a tournament normalized to `tf`, and if not,
// why. A Limited deck is attachable to an Unlimited event (pool subset); every
// other gated case requires exact normalized-id equality. null/'Other' means
// the tournament doesn't gate at all.
function deckAttachability(
  tf: ReturnType<typeof normalizeTournamentFormat>,
  deck: DeckSearchResult
): { allowed: true } | { allowed: false; reason: string } {
  if (tf === null || tf === "Other") return { allowed: true };
  const deckFmt = normalizeFormat(deck.format);
  if (deckFmt === tf) return { allowed: true };
  if (tf === "Unlimited" && deckFmt === "Limited") return { allowed: true };
  return {
    allowed: false,
    reason: `This event is ${FORMATS[tf].label} — this deck is ${FORMATS[deckFmt].label}`,
  };
}

export default function AttachDeckDialog({
  open,
  onOpenChange,
  participantName,
  tournamentFormat,
  onSelect,
}: AttachDeckDialogProps) {
  const tf = normalizeTournamentFormat(tournamentFormat);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DeckSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setFocusedIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Reset focus index when results change
  useEffect(() => {
    setFocusedIndex(-1);
  }, [results]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-deck-item]");
    items[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchDecksForTournamentAction(query);
      if (res.success) {
        setResults(res.decks);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const selectDeck = useCallback((deck: DeckSearchResult) => {
    onSelect(deck);
    onOpenChange(false);
  }, [onSelect, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const deck = results[focusedIndex];
      if (deckAttachability(tf, deck).allowed) selectDeck(deck);
    }
  }, [results, focusedIndex, selectDeck, tf]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* One height: with only a min-h on the list, the centered box grew past
          four results and shrank back to the spinner on every search. */}
      <DialogContent size="md" className="max-w-xl h-[min(40rem,85vh)] flex flex-col">
        <DialogHeader>
          <DialogTitle>Attach Deck</DialogTitle>
          <DialogDescription>
            Search your decks or public decks for <strong>{participantName}</strong>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by deck name..."
              className="w-full pl-9 pr-9 py-2.5 border border-border rounded-lg bg-card text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Results — a refined search keeps the old rows (dimmed) until the
              new ones land, so the rows do not vanish under the pointer. */}
          <div ref={listRef} className="flex-1 overflow-y-auto min-h-[300px] -mx-6 px-6">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-12">
                No decks found for &ldquo;{query}&rdquo;
              </p>
            )}

            {!loading && !query && (
              <div className="text-center py-12">
                <BookOpen className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Type to search your decks and public community decks
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div className={`space-y-0.5 transition-opacity ${loading ? "opacity-60" : ""}`}>
                {results.map((deck, index) => {
                  const attach = deckAttachability(tf, deck);
                  return (
                  <button
                    key={deck.id}
                    data-deck-item
                    disabled={attach.allowed === false}
                    title={attach.allowed === false ? attach.reason : undefined}
                    onClick={() => attach.allowed && selectDeck(deck)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left group ${
                      !attach.allowed
                        ? "opacity-50 cursor-not-allowed"
                        : focusedIndex === index
                          ? "bg-muted"
                          : "hover:bg-muted"
                    }`}
                  >
                    {/* Preview thumbnail */}
                    <div className="w-10 h-14 rounded bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {deck.preview_card_1 ? (
                        <img
                          src={getCardImageUrl(deck.preview_card_1)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <BookOpen className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>

                    {/* Deck info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{deck.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FormatBadge format={deck.format} className="min-w-[3.25rem]" />
                        <span>{deck.card_count} cards</span>
                        {deck.username && deck.username !== "You" && (
                          <span className="truncate">by {deck.username}</span>
                        )}
                      </div>
                      {attach.allowed === false && (
                        <p className="text-xs text-destructive mt-0.5 truncate">{attach.reason}</p>
                      )}
                    </div>

                    {/* Select indicator */}
                    {attach.allowed && (
                      <span className={`text-xs text-primary flex-shrink-0 transition-opacity ${
                        focusedIndex === index ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}>
                        Select
                      </span>
                    )}
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
