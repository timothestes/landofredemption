import { describe, it, expect } from 'vitest';
import {
  diffDealtSouls,
  computeDealFlight,
  STAGGER_MS,
  START_SCALE,
} from '../lostSoulDeal';

describe('diffDealtSouls', () => {
  it('deals a soul that moved from the deck into the LOB', () => {
    const prevLob = new Set<string>([]);
    const prevDeck = new Set(['s1', 'c2']);
    // s1 was in the deck last frame, now in the LOB → dealt.
    expect(diffDealtSouls(prevLob, prevDeck, ['s1'])).toEqual(['s1']);
  });

  it('does NOT deal a soul dragged in from a non-deck zone', () => {
    const prevLob = new Set<string>([]);
    const prevDeck = new Set(['c2']); // s1 was NOT in the deck (came from hand)
    expect(diffDealtSouls(prevLob, prevDeck, ['s1'])).toEqual([]);
  });

  it('does NOT re-deal a soul already in the LOB', () => {
    const prevLob = new Set(['s1']);
    const prevDeck = new Set(['s1']); // even if still listed in deck, not newly arrived
    expect(diffDealtSouls(prevLob, prevDeck, ['s1'])).toEqual([]);
  });

  it('deals only the deck-sourced souls in a mixed batch, in order', () => {
    const prevLob = new Set<string>([]);
    const prevDeck = new Set(['fromDeck1', 'fromDeck2']); // dragged is not here
    expect(
      diffDealtSouls(prevLob, prevDeck, ['fromDeck1', 'dragged', 'fromDeck2']),
    ).toEqual(['fromDeck1', 'fromDeck2']);
  });

  it('deals nothing when the deck set is empty (e.g. initial placement)', () => {
    expect(diffDealtSouls(new Set(), new Set(), ['s1', 's2'])).toEqual([]);
  });
});

describe('computeDealFlight', () => {
  const deck = { x: 0, y: 0, width: 100, height: 140 };
  const slot = { x: 500, y: 300 };
  const cardWidth = 80;
  const cardHeight = 112;

  it('starts at the deck center', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.from).toEqual({ x: 50, y: 70 });
  });

  it('ends at the slot center (slot top-left + half card)', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.to).toEqual({ x: 540, y: 356 });
  });

  it('applies stagger by seq using the default interval', () => {
    const f0 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    const f2 = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 2 });
    expect(f0.delayMs).toBe(0);
    expect(f2.delayMs).toBe(2 * STAGGER_MS);
  });

  it('uses default scales', () => {
    const f = computeDealFlight({ deck, slot, cardWidth, cardHeight, seq: 0 });
    expect(f.startScale).toBe(START_SCALE);
    expect(f.endScale).toBe(1);
  });

  it('honors custom stagger and startScale', () => {
    const f = computeDealFlight({
      deck, slot, cardWidth, cardHeight, seq: 3, staggerMs: 50, startScale: 0.5,
    });
    expect(f.delayMs).toBe(150);
    expect(f.startScale).toBe(0.5);
  });
});
