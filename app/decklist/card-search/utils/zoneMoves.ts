import type { DeckCard, DeckZone } from "../types/deck";
import type { Card } from "../utils";

/**
 * One step of a batch edit: `quantity` copies of `card` leave `fromZone` and
 * land in `toZone`. A null `toZone` removes them from the deck; a null
 * `fromZone` adds them from outside it (how an undone removal comes back).
 */
export interface ZoneMove {
  card: Card;
  fromZone: DeckZone | null;
  toZone: DeckZone | null;
  quantity: number;
}

const ZONE_LABELS: Record<DeckZone, string> = {
  main: "Main",
  reserve: "Reserve",
  maybeboard: "Maybeboard",
};

export function zoneLabel(zone: DeckZone): string {
  return ZONE_LABELS[zone];
}

function findEntry(cards: DeckCard[], card: Card, zone: DeckZone): number {
  return cards.findIndex(
    (dc) => dc.card.name === card.name && dc.card.set === card.set && dc.zone === zone
  );
}

/**
 * Apply moves in order. A move never takes more copies than its source zone
 * holds, so replaying a stale batch (an undo after further edits) is safe.
 */
export function applyZoneMoves(cards: DeckCard[], moves: ZoneMove[]): DeckCard[] {
  let next = cards;
  for (const move of moves) {
    let quantity = move.quantity;
    if (move.fromZone) {
      const i = findEntry(next, move.card, move.fromZone);
      if (i < 0) continue;
      const source = next[i];
      quantity = Math.min(quantity, source.quantity);
      next =
        source.quantity > quantity
          ? next.map((dc, j) => (j === i ? { ...dc, quantity: dc.quantity - quantity } : dc))
          : next.filter((_, j) => j !== i);
    }
    if (move.toZone && quantity > 0) {
      const toZone = move.toZone;
      const i = findEntry(next, move.card, toZone);
      next =
        i >= 0
          ? next.map((dc, j) => (j === i ? { ...dc, quantity: dc.quantity + quantity } : dc))
          : [...next, { card: move.card, quantity, zone: toZone }];
    }
  }
  return next;
}

/**
 * Move every copy of each entry into `toZone` (null removes them). Entries
 * already in `toZone` are left out, so dropping a selection on its own zone
 * is a no-op.
 */
export function stackMoves(entries: DeckCard[], toZone: DeckZone | null): ZoneMove[] {
  return entries
    .filter((dc) => dc.zone !== toZone)
    .map((dc) => ({ card: dc.card, fromZone: dc.zone, toZone, quantity: dc.quantity }));
}

/** The batch that undoes `moves`. */
export function invertZoneMoves(moves: ZoneMove[]): ZoneMove[] {
  return moves
    .map((move) => ({ ...move, fromZone: move.toZone, toZone: move.fromZone }))
    .reverse();
}

/** Total copies a set of deck entries holds. */
export function countCopies(entries: { quantity: number }[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

/** "Moved 7 cards to Reserve" / "Removed 1 card". */
export function describeZoneMoves(moves: ZoneMove[]): string {
  const copies = countCopies(moves);
  const noun = copies === 1 ? "card" : "cards";
  const toZone = moves[0]?.toZone ?? null;
  return toZone ? `Moved ${copies} ${noun} to ${zoneLabel(toZone)}` : `Removed ${copies} ${noun}`;
}
