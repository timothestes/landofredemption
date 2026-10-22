import { describe, expect, it } from 'vitest';
import {
  brigadeCounts, cardKey, deckBreakdown, faceOffRows, groupDeck, type MatchupCard,
} from '../matchup';

const card = (
  name: string, type: string, extra: Partial<MatchupCard> = {},
): MatchupCard => ({
  card_name: name,
  card_set: 'Set',
  card_img_file: name.replace(/ /g, '_'),
  quantity: 1,
  zone: 'main',
  type,
  alignment: 'Good',
  brigade: '',
  ...extra,
});

const GOOD_MULTI = 'Blue/Clay/Good Gold/Green/Purple/Red/Silver/Teal/White';
const EVIL_MULTI = 'Black/Brown/Crimson/Evil Gold/Gray/Orange/Pale Green';

describe('cardKey', () => {
  it('is the catalog key: name|set|imgFile with the image sanitized', () => {
    expect(cardKey({ card_name: 'Son of God', card_set: 'Pi', card_img_file: 'Son_of_God.jpg' }))
      .toBe('Son of God|Pi|Son_of_God');
    expect(cardKey({ card_name: 'A/B', card_set: 'S', card_img_file: 'A/B' })).toBe('A/B|S|A_B');
  });

  it('tolerates missing set and image', () => {
    expect(cardKey({ card_name: 'X' })).toBe('X||');
  });
});

describe('groupDeck', () => {
  it('buckets the main deck in canonical order, merges small types, and keeps the reserve apart', () => {
    const cards = [
      card('Zeal', 'GE'),
      card('Abram', 'Hero'),
      card('Ark of the Covenant', 'Artifact'),
      card('Covenant of Noah', 'Covenant'),
      card('Son of God', 'Dominant'),
      card('Lost Soul', 'Lost Soul'),
      card('Herod', 'Evil Character', { alignment: 'Evil' }),
      card('Spare', 'GE', { zone: 'reserve' }),
      card('Idea', 'GE', { zone: 'maybeboard' }),
    ];
    const { main, reserve } = groupDeck(cards);
    expect(main.map(g => g.name)).toEqual([
      'Dominants', 'Artifacts / Covenants / Curses', 'Lost Souls', 'Heroes', 'Good Enhancements', 'Evil Characters',
    ]);
    expect(main[1].cards.map(c => c.card_name)).toEqual(['Ark of the Covenant', 'Covenant of Noah']);
    expect(reserve.map(c => c.card_name)).toEqual(['Spare']);
    expect(main.flatMap(g => g.cards).some(c => c.card_name === 'Idea')).toBe(false);
  });

  it('counts copies, not rows, and sorts a bucket by brigade then name', () => {
    const cards = [
      card('Tent', 'GE', { brigade: 'Red', quantity: 2 }),
      card('Altar', 'GE', { brigade: 'Blue' }),
      card('Bow', 'GE', { brigade: 'Blue' }),
    ];
    const { main } = groupDeck(cards);
    expect(main).toHaveLength(1);
    expect(main[0].count).toBe(4);
    expect(main[0].cards.map(c => c.card_name)).toEqual(['Altar', 'Bow', 'Tent']);
  });

  it('puts a card with no catalog match in an Other bucket at the end', () => {
    const { main } = groupDeck([card('Mystery', ''), card('Abram', 'Hero')]);
    expect(main.map(g => g.name)).toEqual(['Heroes', 'Other']);
  });
});

describe('brigadeCounts', () => {
  it('weights by quantity, counts a two-colour card under both, and splits good from evil', () => {
    const counts = brigadeCounts([
      card('Abram', 'Hero', { brigade: 'Red', quantity: 3 }),
      card('Moses', 'Hero', { brigade: 'Blue/Red' }),
      card('Herod', 'Evil Character', { brigade: 'Orange', alignment: 'Evil', quantity: 2 }),
    ]);
    expect(counts.good).toEqual([{ name: 'Red', count: 4 }, { name: 'Blue', count: 1 }]);
    expect(counts.evil).toEqual([{ name: 'Orange', count: 2 }]);
  });

  it('collapses an all-brigade card to Multi and drops the Good/Evil prefix from Gold', () => {
    const counts = brigadeCounts([
      card('Angel of the Lord', 'Hero', { brigade: GOOD_MULTI }),
      card('Satan', 'Evil Character', { brigade: EVIL_MULTI, alignment: 'Evil' }),
      card('Solomon', 'Hero', { brigade: 'Good Gold' }),
      card('Ahab', 'Evil Character', { brigade: 'Evil Gold', alignment: 'Evil' }),
    ]);
    expect(counts.good).toEqual([{ name: 'Multi', count: 1 }, { name: 'Gold', count: 1 }]);
    expect(counts.evil).toEqual([{ name: 'Multi', count: 1 }, { name: 'Gold', count: 1 }]);
  });

  it('ignores the reserve and cards with no brigade', () => {
    const counts = brigadeCounts([
      card('Spare', 'GE', { brigade: 'Red', zone: 'reserve' }),
      card('Son of God', 'Dominant', { brigade: '' }),
    ]);
    expect(counts).toEqual({ good: [], evil: [] });
  });
});

describe('deckBreakdown', () => {
  it('totals main and reserve and lists type buckets with counts', () => {
    const b = deckBreakdown([
      card('Abram', 'Hero', { quantity: 2 }),
      card('Zeal', 'GE'),
      card('Spare', 'GE', { zone: 'reserve', quantity: 3 }),
    ]);
    expect(b.main).toBe(3);
    expect(b.reserve).toBe(3);
    expect(b.types).toEqual([
      { key: 'Hero', name: 'Heroes', count: 2 },
      { key: 'Good Enhancement', name: 'Good Enhancements', count: 1 },
    ]);
  });
});

describe('faceOffRows', () => {
  const a = deckBreakdown([card('Abram', 'Hero', { quantity: 2 }), card('Son of God', 'Dominant')]);
  const b = deckBreakdown([card('Herod', 'Evil Character', { alignment: 'Evil' }), card('Spare', 'GE', { zone: 'reserve' })]);

  it('lists totals then the union of buckets in canonical order, zero where a side lacks the bucket', () => {
    expect(faceOffRows(a, b)).toEqual([
      { label: 'Main deck', a: 3, b: 1 },
      { label: 'Reserve', a: 0, b: 1 },
      { label: 'Dominants', a: 1, b: 0 },
      { label: 'Heroes', a: 2, b: 0 },
      { label: 'Evil Characters', a: 0, b: 1 },
    ]);
  });

  it('drops a row that is zero on both sides', () => {
    const rows = faceOffRows(a, deckBreakdown([card('Son of God', 'Dominant')]));
    expect(rows.map(r => r.label)).toEqual(['Main deck', 'Dominants', 'Heroes']);
  });

  it('shows null for an unavailable side and nothing when both are unavailable', () => {
    expect(faceOffRows(a, null)).toEqual([
      { label: 'Main deck', a: 3, b: null },
      { label: 'Dominants', a: 1, b: null },
      { label: 'Heroes', a: 2, b: null },
    ]);
    expect(faceOffRows(null, null)).toEqual([]);
  });
});
