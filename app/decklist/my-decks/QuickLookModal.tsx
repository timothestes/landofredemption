"use client";

import { useEffect, useState } from "react";
import { loadDeckByIdAction, DeckCardData } from "../actions";
import { buildSortInfo, compareDeckCards } from "./cardTypeSort";
import type { SortableCard } from "@/lib/cards/defaultSort";
import { getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";

// Read-only peek at a deck's contents without opening the full editor.
export default function QuickLookModal({
  deckId,
  deckName,
  onClose,
  onOpenEditor,
}: {
  deckId: string;
  deckName: string;
  onClose: () => void;
  onOpenEditor: (deckId: string) => void;
}) {
  const [cards, setCards] = useState<DeckCardData[]>([]);
  const [sortInfo, setSortInfo] = useState<Record<string, SortableCard>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadDeckByIdAction(deckId).then(async (result) => {
      if (!active) return;
      if (result.success && result.deck) {
        const list = (((result.deck as any).cards as DeckCardData[]) || []);
        // Enrich with card data for the default sort (lazy-loaded dataset)
        // before showing, so the cards do not re-sort under the pointer.
        const info = await buildSortInfo(list).catch(() => ({}));
        if (!active) return;
        setCards(list);
        setSortInfo(info);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [deckId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Canonical default sort (sections → brigades → strength → name).
  const byDefaultOrder = (a: DeckCardData, b: DeckCardData) =>
    compareDeckCards(sortInfo, a, b);
  const main = cards.filter((c) => c.zone === "main").sort(byDefaultOrder);
  const reserve = cards.filter((c) => c.zone === "reserve").sort(byDefaultOrder);

  const countCards = (list: DeckCardData[]) =>
    list.reduce((sum, c) => sum + (c.quantity || 0), 0);

  function renderSection(title: string, list: DeckCardData[]) {
    if (list.length === 0) return null;
    return (
      <div className="mb-5 last:mb-0">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {title} · {countCards(list)}
        </h3>
        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
          {list.map((card) => {
            const url = getCardImageUrlOrNull(card.card_img_file || card.card_name);
            return (
              <div
                key={`${card.card_name}|${card.card_set ?? ""}`}
                className="relative rounded-lg overflow-hidden border border-border bg-muted"
                style={{ aspectRatio: "2.5/3.5" }}
                title={card.card_name}
              >
                {url ? (
                  <img src={url} alt={card.card_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
                    {card.card_name}
                  </div>
                )}
                {card.quantity > 1 && (
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-semibold leading-none">
                    ×{card.quantity}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60"
      onClick={onClose}
    >
      <div
        // One height: sized to its content, the box re-centered when the
        // spinner gave way to the deck and when the view toggled.
        className="bg-background rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl flex flex-col h-[95vh] sm:h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold truncate">{deckName}</h2>
            {!loading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {countCards(main)} cards
                {reserve.length > 0 ? ` · ${countCards(reserve)} reserve` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">This deck has no cards yet.</p>
          ) : (
            <>
              {renderSection("Deck", main)}
              {renderSection("Reserve", reserve)}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-border flex-shrink-0 flex justify-end">
          <button
            onClick={() => onOpenEditor(deckId)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors"
          >
            Open in editor
          </button>
        </div>
      </div>
    </div>
  );
}
