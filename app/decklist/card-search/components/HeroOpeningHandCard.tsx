"use client";

import { useMemo } from "react";
import type { Deck } from "../types/deck";
import { heroOpeningHandOdds, GOING_SECOND_HAND_SIZE } from "../utils/deckStats";

interface HeroOpeningHandCardProps {
  deck: Deck;
  /** Surface colours, so the cell matches the alignment cells beside it. */
  className: string;
}

const TOOLTIP =
  "The chance your opening hand of 8 holds at least one Hero. " +
  "Lost Souls you draw (Hopper included) are put in play and replaced, so the hand " +
  "is 8 of your main deck's non-Lost Soul cards. Dual-type Heroes count. " +
  "Hover the rest of this cell for the chance when going second (11 cards). " +
  "This is an exact figure, not a simulation. Lost Soul abilities that draw or " +
  "search are not counted.";

export default function HeroOpeningHandCard({ deck, className }: HeroOpeningHandCardProps) {
  const { heroes, handCards, chance, goingSecond } = useMemo(() => {
    const opening = heroOpeningHandOdds(deck.cards, (dc) => dc.card.type);
    const second = heroOpeningHandOdds(deck.cards, (dc) => dc.card.type, GOING_SECOND_HAND_SIZE);
    return { ...opening, goingSecond: second.chance };
  }, [deck.cards]);

  // Hovering the cell shows the figure for the player going second, who has
  // drawn 3 more cards before their first turn.
  const hoverText =
    handCards === 0
      ? undefined
      : `Going second (${GOING_SECOND_HAND_SIZE} cards, after your first draw of 3): ${(goingSecond * 100).toFixed(1)}%`;

  return (
    <div title={hoverText} className={`col-span-2 p-3 rounded-lg border-2 ${className}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1">
        <span>Hero in opening hand</span>
        <span title={TOOLTIP} className="cursor-help opacity-60 leading-none">
          &#9432;
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-2xl font-bold tabular-nums">
          {handCards === 0 ? "—" : `${(chance * 100).toFixed(1)}%`}
        </div>
        <div className="text-[10px] opacity-70 text-right">
          {heroes} {heroes === 1 ? "Hero" : "Heroes"} in {handCards} non-Lost Soul cards
        </div>
      </div>
    </div>
  );
}
