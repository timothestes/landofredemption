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
      title="Swap seat (W)"
      onClick={onSwap}
      className="inline-flex h-11 min-w-11 shrink-0 items-center gap-2 rounded-full border border-border bg-card/95 px-3 text-sm text-card-foreground hover:bg-muted"
    >
      <ArrowLeftRight className="size-4 shrink-0" aria-hidden="true" />
      <span className="max-w-[8rem] truncate">{deckName}</span>
    </button>
  );
}
