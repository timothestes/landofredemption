"use client";

import { useMemo } from "react";
import type { Deck } from "../types/deck";
import { heroOpeningHandOdds } from "../utils/deckStats";

interface HeroOpeningHandCardProps {
  deck: Deck;
  /** Surface colours, so the cell matches the alignment cells beside it. */
  className: string;
}

const TOOLTIP =
  "The chance your opening hand of 8 holds at least one Hero. " +
  "Lost Souls you draw (Hopper included) are put in play and replaced, so the hand " +
  "is 8 of your main deck's non-Lost Soul cards. Dual-type Heroes count. " +
  "This is an exact figure, not a simulation. Lost Soul abilities that draw or " +
  "search are not counted.";

export default function HeroOpeningHandCard({ deck, className }: HeroOpeningHandCardProps) {
  const { heroes, handCards, chance } = useMemo(
    () => heroOpeningHandOdds(deck.cards, (dc) => dc.card.type),
    [deck.cards]
  );

  return (
    <div className={`col-span-2 p-3 rounded-lg border-2 ${className}`}>
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
