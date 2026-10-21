// Pure seat resolution for solo games (one identity holds both Player rows).
// No spacetimedb imports — keeps this unit-testable and publishable, like
// battlePlacement.ts.

export type SeatHint = { cardId: bigint } | { seat: bigint } | { playerId: bigint } | undefined;

export interface SeatRow { id: bigint; seat: bigint }

// rows = the sender's Player rows in this game. One row (a two-human game) →
// that row, hint ignored. Two rows (solo): an explicit playerId or seat hint
// wins; a card hint picks the card owner's row; a shared card (owner matches
// neither row) or no hint falls back to the seat in hand.
export function pickSoloRow<R extends SeatRow>(
  rows: R[],
  hint: SeatHint,
  activeSeat: bigint,
  cardOwnerId: bigint | null,
): R | undefined {
  if (rows.length <= 1) return rows[0];
  const bySeat = (seat: bigint) => rows.find((r) => r.seat === seat);
  if (hint) {
    if ('playerId' in hint) {
      const row = rows.find((r) => r.id === hint.playerId);
      if (row) return row;
    } else if ('seat' in hint) {
      const row = bySeat(hint.seat);
      if (row) return row;
    } else if ('cardId' in hint && cardOwnerId !== null) {
      const row = rows.find((r) => r.id === cardOwnerId);
      if (row) return row;
    }
  }
  return bySeat(activeSeat) ?? rows[0];
}
