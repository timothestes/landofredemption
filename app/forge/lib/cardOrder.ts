import type { ForgeCardFull } from "@/app/forge/lib/cards";
import { compareCardsDefault, compareCardsEndOfTimes, type SortableCard } from "@/lib/cards/defaultSort";

type OrderableCard = Pick<ForgeCardFull, "title" | "snapshot" | "setId">;

// Adapt a forge card snapshot (array-valued cardType/brigades, numeric-or-string
// strength) to the canonical comparator's shape. Cards with no primary type get
// an empty type string, which the comparator sends to the trailing misc section
// — preserving the old "missing primary type sorts last" behavior, since every
// typed forge card lands in an earlier section.
function toSortable(c: OrderableCard): SortableCard {
  const s = c.snapshot;
  return {
    name: c.title ?? "",
    type: (s?.cardType ?? []).join("/"),
    brigade: (s?.brigades ?? []).join("/"),
    alignment: s?.alignment,
    strength: s?.strength == null ? "" : String(s.strength),
    toughness: s?.toughness == null ? "" : String(s.toughness),
    reference: s?.reference,
  };
}

// End of Times is a confirmed one-off, not a pattern to generalize: its
// final numbering (a) counts a leading "The" as a real word and breaks
// same-strength Good Enhancement ties by toughness ascending — everything
// else (Evil Enhancements included) keeps descending, same as every other
// validated set (see compareCardsEndOfTimes) — and (b) hand-orders its five
// Dominants in a sequence that doesn't reduce to any rule — Beast's Mark
// deliberately prints last despite alphabetizing before "Deceiving the
// Nations".
export const END_OF_TIMES_SET_ID = "908b4ce7-9bf8-474c-b3bf-ff957462f983";
const END_OF_TIMES_DOMINANT_ORDER = [
  "Alpha and Omega", "Word of the Lord", "Armageddon", "Deceiving the Nations", "Beast's Mark",
];

function dominantOverrideRank(title: string): number {
  const idx = END_OF_TIMES_DOMINANT_ORDER.indexOf(title);
  return idx === -1 ? END_OF_TIMES_DOMINANT_ORDER.length : idx;
}

function compareEndOfTimesSetCards(a: OrderableCard, b: OrderableCard): number {
  const diff = dominantOverrideRank(a.title ?? "") - dominantOverrideRank(b.title ?? "");
  if (diff !== 0) return diff;
  return compareCardsEndOfTimes(toSortable(a), toSortable(b));
}

// Default set-card display order: the canonical default card sort (sections →
// brigades → strength → name). Shared by the set grid (SetCardsBrowser) and the
// single-card detail view's prev/next arrows so both walk the set in the same
// order.
export function sortSetCards<C extends OrderableCard>(cards: C[]): C[] {
  const isEndOfTimes = cards.some((c) => c.setId === END_OF_TIMES_SET_ID);
  const compare = isEndOfTimes
    ? compareEndOfTimesSetCards
    : (a: OrderableCard, b: OrderableCard) => compareCardsDefault(toSortable(a), toSortable(b));
  return [...cards].sort(compare);
}
