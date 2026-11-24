"use client";

import { useId, useMemo, useState } from "react";
import type { Deck } from "../types/deck";
import { openingHandOdds, GOING_SECOND_HAND_SIZE } from "../utils/deckStats";
import {
  DEFAULT_OPENING_HAND_CATEGORY,
  OPENING_HAND_CATEGORIES,
  isInCategory,
  openingHandCategory,
} from "../utils/openingHandCategories";

interface OpeningHandOddsCardProps {
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

export default function OpeningHandOddsCard({ deck, className }: OpeningHandOddsCardProps) {
  const [categoryId, setCategoryId] = useState(DEFAULT_OPENING_HAND_CATEGORY.id);
  const selectId = useId();
  const category = openingHandCategory(categoryId);

  const { matching, handCards, chance, goingSecond } = useMemo(() => {
    const typeOf = (dc: Deck["cards"][number]) => dc.card.type;
    const isTarget = (dc: Deck["cards"][number]) => isInCategory(dc.card, category);
    const opening = openingHandOdds(deck.cards, typeOf, isTarget);
    const second = openingHandOdds(deck.cards, typeOf, isTarget, GOING_SECOND_HAND_SIZE);
    return { ...opening, goingSecond: second.chance };
  }, [deck.cards, category]);

  const percent = (value: number) => (handCards === 0 ? "—" : `${(value * 100).toFixed(1)}%`);

  return (
    <div className={`col-span-2 p-3 rounded-lg border-2 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide">
          In opening hand
        </label>
        <select
          id={selectId}
          value={category.id}
          onChange={(e) => setCategoryId(e.target.value)}
          className="text-xs px-1.5 py-0.5 border border-border rounded bg-card text-foreground"
        >
          {OPENING_HAND_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Going first · 8 cards" value={percent(chance)} />
        <Figure label={`Going second · ${GOING_SECOND_HAND_SIZE} cards`} value={percent(goingSecond)} />
      </div>
      <div className="text-[10px] opacity-70 mt-1.5">
        Chance of at least one · {matching} {matching === 1 ? category.one : category.many} in {handCards} non-Lost Soul cards
      </div>
    </div>
  );
}
