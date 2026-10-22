import { describe, it, expect } from 'vitest';
import {
  captureKeepOneSnapshot,
  finishKeepOneSnapshot,
  planKeepOneUndo,
  type SnapshotCard,
  type KeepOneSnapshot,
} from '../src/keepOneUndo';

const card = (id: number, zone: string, zoneIndex: number, isFlipped = zone === 'deck'): SnapshotCard =>
  ({ id: BigInt(id), zone, zoneIndex: BigInt(zoneIndex), isFlipped });

// Pre-effect board: hand [1 keep, 2, 3], deck [10, 11, 12, 13] (10 on top).
const before: SnapshotCard[] = [
  card(1, 'hand', 0), card(2, 'hand', 1), card(3, 'hand', 2),
  card(10, 'deck', 0), card(11, 'deck', 1), card(12, 'deck', 2), card(13, 'deck', 3),
  card(50, 'territory', 0, false),
];

// The effect: 2 and 3 shuffled in, deck reshuffled, 2 drawn back (11 and 2 —
// a shuffled-away card can come straight back out).
const after: SnapshotCard[] = [
  card(1, 'hand', 0), card(11, 'hand', 1, false), card(2, 'hand', 2, false),
  card(3, 'deck', 0), card(13, 'deck', 1), card(10, 'deck', 2), card(12, 'deck', 3),
  card(50, 'territory', 0, false),
];

function snapshot(): KeepOneSnapshot {
  return finishKeepOneSnapshot(captureKeepOneSnapshot(before), after, 2, 2);
}

describe('captureKeepOneSnapshot', () => {
  it('records hand and deck in zoneIndex order and ignores other zones', () => {
    const snap = captureKeepOneSnapshot([card(11, 'deck', 1), card(3, 'hand', 2), card(10, 'deck', 0), card(1, 'hand', 0), card(50, 'territory', 0)]);
    expect(snap.hand.map((h) => h.id)).toEqual(['1', '3']);
    expect(snap.deck).toEqual(['10', '11']);
  });
});

describe('finishKeepOneSnapshot', () => {
  it('notes where every snapshotted card ended up', () => {
    const snap = snapshot();
    expect(snap.after).toEqual({ '1': 'hand', '2': 'hand', '3': 'deck', '10': 'deck', '11': 'hand', '12': 'deck', '13': 'deck' });
    expect(snap.shuffled).toBe(2);
    expect(snap.drawn).toBe(2);
  });
});

describe('planKeepOneUndo', () => {
  it('restores the original hand order and deck order', () => {
    const plan = planKeepOneUndo(snapshot(), after);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byId = Object.fromEntries(plan.updates.map((u) => [u.id, u]));
    // Hand: 1 untouched (no update), 2 back to slot 1 face up, 3 back from deck to slot 2.
    expect(byId['1']).toBeUndefined();
    expect(byId['2']).toMatchObject({ zone: 'hand', zoneIndex: 1, isFlipped: false });
    expect(byId['3']).toMatchObject({ zone: 'hand', zoneIndex: 2, isFlipped: false });
    // Deck: 10 11 12 13 in that order, 11 back from hand face down.
    expect(byId['10']).toMatchObject({ zone: 'deck', zoneIndex: 0, isFlipped: true });
    expect(byId['11']).toMatchObject({ zone: 'deck', zoneIndex: 1, isFlipped: true });
    expect(byId['12']).toMatchObject({ zone: 'deck', zoneIndex: 2, isFlipped: true });
    expect(byId['13']).toMatchObject({ zone: 'deck', zoneIndex: 3, isFlipped: true });
  });

  it('only emits updates for rows that actually change', () => {
    const plan = planKeepOneUndo(snapshot(), after);
    if (!plan.ok) throw new Error(plan.reason);
    // 13 sits at deck index 1 after the effect but belongs at index 3: changed.
    expect(plan.updates.find((u) => u.id === '13')).toMatchObject({ zone: 'deck', zoneIndex: 3 });
    // Nothing in the plan touches territory.
    expect(plan.updates.some((u) => u.id === '50')).toBe(false);
  });

  it('refuses when a drawn card has since been played', () => {
    const now = after.map((c) => (c.id === 11n ? card(11, 'territory', 0, false) : c));
    const plan = planKeepOneUndo(snapshot(), now);
    expect(plan.ok).toBe(false);
  });

  it('refuses when a shuffled-away card has since left the deck', () => {
    const now = after.filter((c) => c.id !== 3n); // 3 given away / gone
    const plan = planKeepOneUndo(snapshot(), now);
    expect(plan.ok).toBe(false);
  });

  it('skips the kept card if it was played, but restores everything else', () => {
    const now = after.map((c) => (c.id === 1n ? card(1, 'territory', 0, false) : c));
    const plan = planKeepOneUndo(snapshot(), now);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byId = Object.fromEntries(plan.updates.map((u) => [u.id, u]));
    expect(byId['1']).toBeUndefined();
    // Hand closes up: 2 then 3.
    expect(byId['2']).toMatchObject({ zone: 'hand', zoneIndex: 0 });
    expect(byId['3']).toMatchObject({ zone: 'hand', zoneIndex: 1 });
  });

  it('keeps a card drawn normally after the effect, behind the restored hand', () => {
    // Normal draw after the effect took 3 off the top (deck index 0) into hand.
    const now: SnapshotCard[] = [
      card(1, 'hand', 0), card(11, 'hand', 1, false), card(2, 'hand', 2, false), card(3, 'hand', 3, false),
      card(13, 'deck', 0), card(10, 'deck', 1), card(12, 'deck', 2),
      card(50, 'territory', 0, false),
    ];
    // 3 was a moved card (hand → deck) and is no longer in the deck: refuse.
    expect(planKeepOneUndo(snapshot(), now).ok).toBe(false);

    // But a NEW card (99) that arrived in hand after the effect is fine.
    const now2 = [...after, card(99, 'hand', 3, false)];
    const plan = planKeepOneUndo(snapshot(), now2);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates.find((u) => u.id === '99')).toBeUndefined(); // already at hand index 3
  });

  it('brings an auto-routed Lost Soul back to its deck slot', () => {
    const afterWithSoul = after.map((c) => (c.id === 13n ? card(13, 'land-of-bondage', 0, false) : c));
    const snap = finishKeepOneSnapshot(captureKeepOneSnapshot(before), afterWithSoul, 2, 1);
    expect(snap.after['13']).toBe('land-of-bondage');
    const plan = planKeepOneUndo(snap, afterWithSoul);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates.find((u) => u.id === '13')).toMatchObject({ zone: 'deck', zoneIndex: 3, isFlipped: true });
  });

  it('does nothing when nothing changed since a no-op effect', () => {
    const only = [card(1, 'hand', 0), card(10, 'deck', 0)];
    const snap = finishKeepOneSnapshot(captureKeepOneSnapshot(only), only, 0, 0);
    const plan = planKeepOneUndo(snap, only);
    expect(plan).toEqual({ ok: true, updates: [] });
  });
});
