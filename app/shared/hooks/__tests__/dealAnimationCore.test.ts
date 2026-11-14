import { describe, it, expect } from 'vitest';
import {
  diffDeals,
  scheduleDeals,
  DEAL_STAGGER_MS,
  DEAL_MAX_SPREAD_MS,
} from '../dealAnimationCore';

describe('diffDeals', () => {
  it('returns no deals on the initial snapshot (prevZones null)', () => {
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'deck' },
    ];
    const { dealt, nextZones } = diffDeals(null, cards);
    expect(dealt).toEqual([]);
    expect(nextZones.get('1')).toBe('hand');
    expect(nextZones.get('2')).toBe('deck');
  });

  it('flags cards that moved deck → hand, in current hand order', () => {
    const prev = new Map([
      ['1', 'hand'],
      ['2', 'deck'],
      ['3', 'deck'],
      ['4', 'deck'],
    ]);
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'hand' },
      { id: '3', zone: 'hand' },
      { id: '4', zone: 'deck' },
    ];
    expect(diffDeals(prev, cards).dealt).toEqual(['2', '3']);
  });

  it('ignores hand arrivals from other zones (territory, reserve, unknown)', () => {
    const prev = new Map([
      ['1', 'territory'],
      ['2', 'reserve'],
    ]);
    const cards = [
      { id: '1', zone: 'hand' },
      { id: '2', zone: 'hand' },
      { id: '9', zone: 'hand' }, // never seen before (e.g. game-start insert)
    ];
    expect(diffDeals(prev, cards).dealt).toEqual([]);
  });

  it('ignores cards that left the hand', () => {
    const prev = new Map([['1', 'hand']]);
    const cards = [{ id: '1', zone: 'discard' }];
    const { dealt, nextZones } = diffDeals(prev, cards);
    expect(dealt).toEqual([]);
    expect(nextZones.get('1')).toBe('discard');
  });

  it('with toZone "discard", flags deck → discard (a mill) and not deck → hand', () => {
    const prev = new Map([
      ['1', 'deck'],
      ['2', 'deck'],
      ['3', 'hand'],
      ['4', 'deck'],
    ]);
    const cards = [
      { id: '1', zone: 'discard' },
      { id: '2', zone: 'hand' },
      { id: '3', zone: 'discard' }, // discarded from hand — not a mill
      { id: '4', zone: 'discard' },
    ];
    expect(diffDeals(prev, cards, 'discard').dealt).toEqual(['1', '4']);
    expect(diffDeals(prev, cards).dealt).toEqual(['2']);
  });
});

describe('scheduleDeals', () => {
  it('staggers a batch by DEAL_STAGGER_MS starting now', () => {
    const { startAts } = scheduleDeals(1000, -Infinity, 3);
    expect(startAts).toEqual([1000, 1000 + DEAL_STAGGER_MS, 1000 + 2 * DEAL_STAGGER_MS]);
  });

  it('queues a new batch after an in-flight one', () => {
    const first = scheduleDeals(1000, -Infinity, 2);
    const lastStart = first.startAts[1];
    const second = scheduleDeals(1050, lastStart, 1);
    expect(second.startAts[0]).toBe(lastStart + DEAL_STAGGER_MS);
  });

  it('compresses stagger for large batches so total spread ≤ DEAL_MAX_SPREAD_MS', () => {
    const { startAts } = scheduleDeals(0, -Infinity, 12);
    // FP epsilon: 12 accumulated float additions can land a hair over 1600
    expect(startAts[11] - startAts[0]).toBeLessThanOrEqual(DEAL_MAX_SPREAD_MS + 1e-6);
    expect(startAts[1] - startAts[0]).toBeGreaterThan(0);
  });

  it('accepts a custom stagger (opening-hand fast deal)', () => {
    const { startAts } = scheduleDeals(500, -Infinity, 8, 90);
    expect(startAts[0]).toBe(500);
    expect(startAts[1] - startAts[0]).toBe(90);
    expect(startAts[7] - startAts[0]).toBe(7 * 90);
  });
});
