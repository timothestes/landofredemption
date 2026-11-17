"use client";

import { useEffect, useState } from "react";
import { loadUserDecksAction } from "../../actions";
import type { DeckListItem } from "../builderConfig";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { getFormatDef } from "@/lib/formats";
import { MyDeckList } from "@/components/ui/MyDeckList";

// Helper function to normalize deck format display
function formatDeckType(format?: string): string {
  return getFormatDef(format).id;
}

interface LoadDeckModalProps {
  onLoadDeck: (deckId: string) => void;
  onClose: () => void;
  /** Heading text (defaults to "Load Deck"). */
  title?: string;
  /** Sub-heading text (defaults to "Select a deck to load into the builder"). */
  subtitle?: string;
  /** When set, only decks of the same normalized type (Limited/Unlimited/T2/Paragon) are shown. */
  matchFormat?: string;
  /** Override the deck list source (defaults to the public `loadUserDecksAction`). */
  listDecks?: () => Promise<DeckListItem[]>;
}

export default function LoadDeckModal({
  onLoadDeck,
  onClose,
  title = "Load Deck",
  subtitle = "Select a deck to load into the builder",
  matchFormat,
  listDecks,
}: LoadDeckModalProps) {
  const [decks, setDecks] = useState<DeckListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load user's decks
  useEffect(() => {
    async function loadDecks() {
      try {
        setLoading(true);
        if (listDecks) {
          const items = await listDecks();
          const sorted = [...items].sort((a, b) =>
            new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
          );
          setDecks(sorted);
        } else {
          const result = await loadUserDecksAction();
          if (result.success && result.decks) {
            const sorted = [...result.decks].sort((a, b) =>
              new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
            );
            setDecks(sorted as DeckListItem[]);
          } else {
            setError(result.error || "Failed to load decks");
          }
        }
      } catch (err) {
        setError("Failed to load decks");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadDecks();
  }, [listDecks]);

  const formatDecks = decks.filter(deck =>
    !matchFormat || formatDeckType(deck.format) === formatDeckType(matchFormat)
  );

  const handleDeckClick = (deckId: string) => {
    onLoadDeck(deckId);
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="lg" className="max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="bg-primary/10 border-primary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {subtitle}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </DialogHeader>

        {/* Search + deck list */}
        <div className="flex-1 min-h-0 flex flex-col">
          <MyDeckList
            decks={formatDecks}
            loading={loading}
            error={error}
            onPick={(d) => handleDeckClick(d.id)}
            listClassName="flex-1 overflow-y-auto"
            emptyMessage={
              <p className="text-sm text-muted-foreground">
                {matchFormat ? `No ${formatDeckType(matchFormat)} decks found` : "No saved decks found"}
              </p>
            }
          />
        </div>

        {/* Footer */}
        <DialogFooter className="bg-muted/50 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg text-foreground hover:bg-muted font-medium transition-colors"
          >
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
