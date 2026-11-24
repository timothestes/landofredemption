import { describe, it, expect } from 'vitest';
import { statCards, countBy, sumQuantity, openingHandOdds, GOING_SECOND_HAND_SIZE } from '../deckStats';

interface Row {
  name: string;
  type: string;
  brigade: string;
  quantity: number;
  zone: 'main' | 'reserve' | 'maybeboard';
}

function row(name: string, zone: Row['zone'], overrides: Partial<Row> = {}): Row {
  return { name, type: 'Hero', brigade: 'Blue', quantity: 1, zone, ...overrides };
}

describe('statCards', () => {
  it('keeps main and reserve, drops maybeboard', () => {
    const cards = [row('A', 'main'), row('B', 'reserve'), row('C', 'maybeboard')];
    expect(statCards(cards).map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('returns an empty list for a maybeboard-only deck', () => {
    expect(statCards([row('A', 'maybeboard'), row('B', 'maybeboard')])).toEqual([]);
  });
});

describe('sumQuantity', () => {
  it('sums copies across main and reserve only', () => {
    const cards = [
      row('A', 'main', { quantity: 3 }),
      row('B', 'reserve', { quantity: 2 }),
      row('C', 'maybeboard', { quantity: 40 }),
    ];
    expect(sumQuantity(cards)).toBe(5);
  });
});

describe('countBy', () => {
  it('excludes maybeboard cards from single-key aggregation', () => {
    const cards = [
      row('A', 'main', { type: 'Hero', quantity: 2 }),
      row('B', 'reserve', { type: 'Hero', quantity: 1 }),
      row('C', 'maybeboard', { type: 'Hero', quantity: 9 }),
      row('D', 'maybeboard', { type: 'Evil Character', quantity: 5 }),
    ];
    expect(countBy(cards, (c) => c.type)).toEqual({ Hero: 3 });
  });

  it('counts a card once per key when the key function returns several', () => {
    const cards = [
      row('A', 'main', { brigade: 'Blue/Green', quantity: 2 }),
      row('B', 'maybeboard', { brigade: 'Red', quantity: 7 }),
    ];
    expect(countBy(cards, (c) => c.brigade.split('/'))).toEqual({ Blue: 2, Green: 2 });
  });

  it('skips cards whose key function returns null', () => {
    const cards = [row('A', 'main'), row('B', 'main', { brigade: '' })];
    expect(countBy(cards, (c) => c.brigade || null)).toEqual({ Blue: 1 });
  });

  it('returns an empty record when every card is on the maybeboard', () => {
    expect(countBy([row('A', 'maybeboard')], (c) => c.type)).toEqual({});
  });
});

describe('openingHandOdds', () => {
  const isHero = (c: Row) => c.type.toLowerCase().split('/').some((part) => part.trim() === 'hero');
  const odds = (cards: Row[], handSize?: number) => openingHandOdds(cards, (c) => c.type, isHero, handSize);

  it('matches the exact figure for 10 Heroes among 43 non-Lost-Soul cards', () => {
    const result = odds([
      row('Heroes', 'main', { quantity: 10 }),
      row('Other', 'main', { type: 'Evil Character', quantity: 33 }),
      row('Souls', 'main', { type: 'Lost Soul', quantity: 7 }),
    ]);
    expect(result.matching).toBe(10);
    expect(result.handCards).toBe(43);
    // 1 - C(33,8)/C(43,8)
    expect(result.chance).toBeCloseTo(1 - 13884156 / 145008513, 10);
  });

  it('uses 11 cards for the player going second', () => {
    const cards = [
      row('Heroes', 'main', { quantity: 10 }),
      row('Other', 'main', { type: 'Evil Character', quantity: 33 }),
      row('Souls', 'main', { type: 'Lost Soul', quantity: 7 }),
    ];
    const second = odds(cards, GOING_SECOND_HAND_SIZE);
    // 1 - C(33,11)/C(43,11)
    expect(second.chance).toBeCloseTo(1 - 193536720 / 5752004349, 10);
    expect(second.chance).toBeGreaterThan(odds(cards).chance);
  });

  it('is unchanged by how many Lost Souls the deck runs, Hopper included', () => {
    const base = [
      row('Heroes', 'main', { quantity: 8 }),
      row('Other', 'main', { type: 'GE', quantity: 30 }),
    ];
    const withSouls = [
      ...base,
      row('Lost Soul "Hopper" [Matthew 18:12] [2025 - Seasonal]', 'main', { type: 'Lost Soul' }),
      row('Souls', 'main', { type: 'Lost Soul', quantity: 7 }),
    ];
    expect(odds(withSouls)).toEqual(odds(base));
  });

  it('counts dual-type Heroes and ignores reserve and maybeboard', () => {
    const result = odds([
      row('Saul/Paul', 'main', { type: 'Hero/Evil Character' }),
      row('Dual GE', 'main', { type: 'GE/Hero' }),
      row('Evil', 'main', { type: 'Evil Character', quantity: 20 }),
      row('Reserve Hero', 'reserve', { quantity: 5 }),
      row('Maybe Hero', 'maybeboard', { quantity: 5 }),
    ]);
    expect(result.matching).toBe(2);
    expect(result.handCards).toBe(22);
  });

  it('is 0 with no Heroes and 1 when every hand must hold one', () => {
    expect(odds([row('Evil', 'main', { type: 'Evil Character', quantity: 40 })]).chance).toBe(0);
    // 7 non-Heroes cannot fill an 8-card hand.
    expect(odds([
      row('Heroes', 'main', { quantity: 3 }),
      row('Evil', 'main', { type: 'Evil Character', quantity: 7 }),
    ]).chance).toBe(1);
  });

  it('handles a deck smaller than a hand, and an empty deck', () => {
    expect(odds([row('Hero', 'main'), row('Evil', 'main', { type: 'Evil Character', quantity: 3 })]).chance).toBe(1);
    expect(odds([])).toEqual({ matching: 0, handCards: 0, chance: 0 });
  });
});
