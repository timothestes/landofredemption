// Pure snapshot/restore logic for undoing Philip's Daughters
// (all_players_keep_one_shuffle_draw). No spacetimedb imports — unit-testable
// and publishable, like soloSeat.ts / battlePlacement.ts.
//
// The effect moves a player's cards in three ways: the rest of the hand goes
// into the deck, the deck reshuffles, and that many cards come back out (Lost
// Souls may auto-route to the Land of Bondage instead of hand). To take it back
// we record the player's hand and deck ORDER before anything moves, plus the
// zone the effect left every one of those cards in. The snapshot is stored as
// JSON on Player.keepOneUndo until it's undone or the turn flips.

export interface SnapshotCard {
  id: bigint;
  zone: string;
  zoneIndex: bigint;
  isFlipped: boolean;
}

export interface KeepOneSnapshot {
  /** Pre-effect hand, top-to-bottom by zoneIndex, with each card's face state. */
  hand: Array<{ id: string; flipped: boolean }>;
  /** Pre-effect deck, top card first. */
  deck: string[];
  /** Zone the effect left each card in, for every id in hand ∪ deck. */
  after: Record<string, string>;
  shuffled: number;
  drawn: number;
}

export interface UndoUpdate {
  id: string;
  zone: 'hand' | 'deck';
  zoneIndex: number;
  isFlipped: boolean;
}

export type UndoPlan =
  | { ok: true; updates: UndoUpdate[] }
  | { ok: false; reason: string };

const byIndex = (a: SnapshotCard, b: SnapshotCard) =>
  a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0;

/** Record the player's hand + deck order before the effect touches anything. */
export function captureKeepOneSnapshot(
  playerCards: SnapshotCard[],
): Pick<KeepOneSnapshot, 'hand' | 'deck'> {
  const hand = playerCards.filter((c) => c.zone === 'hand').sort(byIndex);
  const deck = playerCards.filter((c) => c.zone === 'deck').sort(byIndex);
  return {
    hand: hand.map((c) => ({ id: c.id.toString(), flipped: c.isFlipped })),
    deck: deck.map((c) => c.id.toString()),
  };
}

/** After the effect: note where every snapshotted card ended up. */
export function finishKeepOneSnapshot(
  partial: Pick<KeepOneSnapshot, 'hand' | 'deck'>,
  playerCardsAfter: SnapshotCard[],
  shuffled: number,
  drawn: number,
): KeepOneSnapshot {
  const zoneById = new Map(playerCardsAfter.map((c) => [c.id.toString(), c.zone]));
  const after: Record<string, string> = {};
  for (const h of partial.hand) after[h.id] = zoneById.get(h.id) ?? '';
  for (const id of partial.deck) after[id] = zoneById.get(id) ?? '';
  return { ...partial, after, shuffled, drawn };
}

/**
 * Work out the row updates that put the hand and deck back the way they were.
 *
 * Rules:
 * - A card the effect MOVED (shuffled away, drawn, or auto-routed) must still
 *   be exactly where the effect left it, or the undo is refused outright —
 *   restoring around a card that has since been played would leave a hand or
 *   deck that never existed.
 * - A card the effect did NOT move (the keeper, deck cards that stayed put)
 *   may have left legitimately since; those are simply skipped.
 * - Cards that arrived in hand or deck after the effect (a normal draw, say)
 *   stay where they are, slotted after the restored ones.
 * - Only rows whose zone, position, or face actually changes are returned.
 */
export function planKeepOneUndo(snap: KeepOneSnapshot, playerCards: SnapshotCard[]): UndoPlan {
  const current = new Map(playerCards.map((c) => [c.id.toString(), c]));
  const inSnapshot = new Set<string>();

  const restoredHand: Array<{ id: string; flipped: boolean }> = [];
  for (const h of snap.hand) {
    inSnapshot.add(h.id);
    const verdict = classify(h.id, 'hand', snap.after[h.id], current.get(h.id));
    if (verdict === 'refuse') return { ok: false, reason: 'a card the effect moved has since left its place' };
    if (verdict === 'restore') restoredHand.push(h);
  }

  const restoredDeck: string[] = [];
  for (const id of snap.deck) {
    inSnapshot.add(id);
    const verdict = classify(id, 'deck', snap.after[id], current.get(id));
    if (verdict === 'refuse') return { ok: false, reason: 'a card the effect moved has since left its place' };
    if (verdict === 'restore') restoredDeck.push(id);
  }

  // Newcomers keep their relative order behind the restored cards.
  const newcomers = (zone: string) =>
    playerCards
      .filter((c) => c.zone === zone && !inSnapshot.has(c.id.toString()))
      .sort(byIndex);

  const updates: UndoUpdate[] = [];
  const push = (id: string, zone: 'hand' | 'deck', zoneIndex: number, isFlipped: boolean) => {
    const cur = current.get(id);
    if (cur && cur.zone === zone && Number(cur.zoneIndex) === zoneIndex && cur.isFlipped === isFlipped) return;
    updates.push({ id, zone, zoneIndex, isFlipped });
  };

  let i = 0;
  for (const h of restoredHand) push(h.id, 'hand', i++, h.flipped);
  for (const c of newcomers('hand')) push(c.id.toString(), 'hand', i++, c.isFlipped);

  i = 0;
  for (const id of restoredDeck) push(id, 'deck', i++, true);
  for (const c of newcomers('deck')) push(c.id.toString(), 'deck', i++, c.isFlipped);

  return { ok: true, updates };
}

function classify(
  _id: string,
  before: 'hand' | 'deck',
  afterZone: string | undefined,
  cur: SnapshotCard | undefined,
): 'restore' | 'skip' | 'refuse' {
  const moved = afterZone !== undefined && afterZone !== before;
  const stillThere = !!cur && cur.zone === afterZone;
  if (moved) return stillThere ? 'restore' : 'refuse';
  return stillThere ? 'restore' : 'skip';
}
