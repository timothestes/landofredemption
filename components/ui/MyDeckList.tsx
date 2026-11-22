"use client";

import { useState, type ReactNode } from "react";
import { FormatBadge } from "./FormatBadge";
import { DeckCovers, hasDeckCover, type DeckCoverFields } from "./DeckCovers";

export interface MyDeckListItem extends DeckCoverFields {
  id?: string;
  name: string;
  format?: string | null;
  card_count?: number | null;
  updated_at?: string | null;
}

interface MyDeckListProps<T extends MyDeckListItem> {
  decks: T[];
  loading: boolean;
  error: string | null;
  onPick: (deck: T) => void;
  /** Deck currently being loaded by the host: shows a spinner on that row and disables all rows. */
  busyDeckId?: string | null;
  /** Shown when there are no decks and no search text. */
  emptyMessage?: ReactNode;
  autoFocus?: boolean;
  /** Classes for the scrolling list area (hosts set the height). */
  listClassName?: string;
}

/**
 * A searchable list of the signed-in user's own decks. Presentational: the
 * host loads the decks and decides what picking one does.
 */
export function MyDeckList<T extends MyDeckListItem>({
  decks,
  loading,
  error,
  onPick,
  busyDeckId,
  emptyMessage,
  autoFocus,
  listClassName,
}: MyDeckListProps<T>) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredDecks = decks.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  // Covers only when the source has them (the Forge's decks have none): a column of blanks says nothing.
  const showCovers = decks.some(hasDeckCover);

  return (
    <>
      {/* Search */}
      <div className="px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search decks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus={autoFocus}
            className="w-full text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground text-foreground"
          />
        </div>
      </div>

      {/* Deck list */}
      <div className={listClassName}>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <svg className="animate-spin mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading decks...
          </div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-red-500">{error}</div>
        ) : filteredDecks.length === 0 ? (
          <div className="py-10 text-center">
            {searchQuery ? (
              <p className="text-sm text-muted-foreground">No decks match your search</p>
            ) : (
              emptyMessage
            )}
          </div>
        ) : (
          <div>
            {filteredDecks.map((deck) => {
              const isLoadingThis = !!busyDeckId && busyDeckId === deck.id;
              return (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => onPick(deck)}
                  disabled={!!busyDeckId}
                  className={`w-full text-left px-4 ${showCovers ? "py-2" : "py-3"} hover:bg-muted transition-colors border-b border-border last:border-b-0 disabled:opacity-50`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {showCovers && <DeckCovers deck={deck} />}
                    <div className="flex-1 min-w-0">
                      {/* Beside the covers, the badge moves down a line so the name keeps the width. */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">
                          {deck.name}
                        </span>
                        {!showCovers && <FormatBadge format={deck.format} full />}
                      </div>
                      <div className={`flex items-center gap-3 text-xs text-muted-foreground ${showCovers ? "mt-1" : "mt-0.5"}`}>
                        {showCovers && <FormatBadge format={deck.format} full />}
                        <span>{deck.card_count || 0} cards</span>
                        {deck.updated_at && (
                          <span>
                            {new Date(deck.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {isLoadingThis ? (
                      <svg className="animate-spin h-4 w-4 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
