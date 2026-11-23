"use client";

import { useMemo } from "react";
import type { Deck } from "../types/deck";
import { heroOpeningHandOdds, GOING_SECOND_HAND_SIZE } from "../utils/deckStats";

interface HeroOpeningHandCardProps {
  deck: Deck;
  /** Surface colours, so the cell matches the alignment cells beside it. */
  className: string;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xl font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-70 leading-tight">{label}</div>
    </div>
  );
}

export default function HeroOpeningHandCard({ deck, className }: HeroOpeningHandCardProps) {
  const { heroes, handCards, chance, goingSecond } = useMemo(() => {
    const opening = heroOpeningHandOdds(deck.cards, (dc) => dc.card.type);
    const second = heroOpeningHandOdds(deck.cards, (dc) => dc.card.type, GOING_SECOND_HAND_SIZE);
    return { ...opening, goingSecond: second.chance };
  }, [deck.cards]);

  const percent = (value: number) => (handCards === 0 ? "—" : `${(value * 100).toFixed(1)}%`);

  return (
    <div className={`col-span-2 p-3 rounded-lg border-2 ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wide mb-1.5">Hero in opening hand</div>
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Going first · 8 cards" value={percent(chance)} />
        <Figure label={`Going second · ${GOING_SECOND_HAND_SIZE} cards`} value={percent(goingSecond)} />
      </div>
      <div className="text-[10px] opacity-70 mt-1.5">
        {heroes} {heroes === 1 ? "Hero" : "Heroes"} in {handCards} non-Lost Soul cards
      </div>
    </div>
  );
}
