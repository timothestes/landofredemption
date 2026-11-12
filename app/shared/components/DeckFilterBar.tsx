'use client';

import { useInputMode } from '@/app/shared/hooks/useInputMode';
import type { GameCard } from '@/app/shared/types/gameCard';

/**
 * What a card ability may pick from the deck — set when a search_deck /
 * exchange_with_deck ability opened the window. `label` is the card's own
 * wording ("a son of Jacob", "an evil N.T. Fortress").
 */
export type DeckCardFilter = { label: string; matches: (card: GameCard) => boolean };

/**
 * Filter line at the top of Search Deck / Exchange with Deck when a card
 * ability opened it: what the card is looking for, how many deck cards
 * qualify, and a toggle to see the whole deck (the player is looking through
 * it either way, and card data can be wrong).
 */
export function DeckFilterBar({
  label,
  shown,
  total,
  filterOn,
  onToggle,
}: {
  label: string;
  shown: number;
  total: number;
  filterOn: boolean;
  onToggle: () => void;
}) {
  const isTouch = useInputMode() === 'touch';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        padding: '6px 10px',
        background: 'rgb(var(--gf-panel-rgb))',
        border: '1px solid var(--gf-border)',
        borderRadius: 4,
      }}
    >
      <span style={{ color: 'var(--gf-text)', fontSize: 12, fontFamily: 'var(--font-cinzel), Georgia, serif', minWidth: 0 }}>
        {filterOn ? `Looking for ${label} · ${shown} of ${total} cards` : `Showing all ${total} cards`}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: '1px solid var(--gf-border)',
          borderRadius: 4,
          color: 'var(--gf-text-dim)',
          fontSize: isTouch ? 12 : 10,
          padding: isTouch ? '8px 12px' : '3px 8px',
          cursor: 'pointer',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        {filterOn ? 'Show all' : 'Only matches'}
      </button>
    </div>
  );
}
