'use client';

import { ArrowLeftRight } from 'lucide-react';

/**
 * Solo (Deck Bracket) seat swap: hands the controls to the other seat. Shows
 * the deck name of the seat currently in hand so the player always knows
 * whose cards they are holding. Placement is owned by GameToolbar — see the
 * comment where it renders.
 */
export function SeatSwapPill({ deckName, onSwap }: { deckName: string; onSwap: () => void }) {
  return (
    <button
      type="button"
      aria-label="Swap seat"
      title={`${deckName} in hand · Swap seat (W)`}
      onClick={onSwap}
      // The play table's own palette (GameToolbar / its collapsed trigger),
      // not site tokens, which turn white over the dark table in light mode.
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--gf-border)] bg-[rgba(30,22,16,0.92)] px-3 text-sm text-[var(--gf-text)] transition-colors hover:bg-[var(--gf-hover)] hover:text-[var(--gf-text-bright)]"
    >
      <ArrowLeftRight className="size-4 shrink-0" aria-hidden="true" />
      {/* Icon-only below sm so the portrait phone toolbar fits; the title
          and aria-label still name the action. */}
      <span className="hidden max-w-[8rem] truncate sm:inline">{deckName}</span>
    </button>
  );
}
