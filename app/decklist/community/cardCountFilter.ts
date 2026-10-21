/**
 * Pure helpers for the Community Decks "Size" filter (main-deck card count).
 *
 * The committed filter is a {min, max} range — that is what the query
 * applies and what the URL carries (?min_cards=&max_cards=). The popover
 * edits a "draft" (mode + one or two number inputs) that maps onto a range.
 */

export type CardCountMode = "exact" | "min" | "max" | "between";

export interface CardCountRange {
  min: number | null;
  max: number | null;
}

export interface CardCountDraft {
  mode: CardCountMode;
  a: string;
  b: string;
}

export const EMPTY_RANGE: CardCountRange = { min: null, max: null };

/** Parse a user- or URL-supplied count. Positive integers up to 999 only. */
export function parseCardCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = /^\s*(\d{1,3})\s*$/.exec(raw);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

export function rangeFromDraft(mode: CardCountMode, a: string, b: string): CardCountRange {
  const na = parseCardCount(a);
  switch (mode) {
    case "exact":
      return { min: na, max: na };
    case "min":
      return { min: na, max: null };
    case "max":
      return { min: null, max: na };
    case "between": {
      const nb = parseCardCount(b);
      if (na != null && nb != null && na > nb) return { min: nb, max: na };
      return { min: na, max: nb };
    }
  }
}

export function draftFromRange({ min, max }: CardCountRange): CardCountDraft {
  if (min != null && max != null) {
    return min === max
      ? { mode: "exact", a: String(min), b: "" }
      : { mode: "between", a: String(min), b: String(max) };
  }
  if (min != null) return { mode: "min", a: String(min), b: "" };
  if (max != null) return { mode: "max", a: String(max), b: "" };
  return { mode: "exact", a: "", b: "" };
}

/** "57 cards", "52+ cards", "≤51 cards", "50–56 cards"; null when unfiltered. */
export function cardCountLabel({ min, max }: CardCountRange): string | null {
  if (min != null && max != null) {
    if (min === max) return `${min} ${min === 1 ? "card" : "cards"}`;
    return `${min}–${max} cards`;
  }
  if (min != null) return `${min}+ cards`;
  if (max != null) return `≤${max} cards`;
  return null;
}
