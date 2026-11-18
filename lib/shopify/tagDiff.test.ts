import { describe, it, expect } from 'vitest';
import type { CardData } from '@/lib/cards/lookup';
import { computeProductTagDiff, rollupTagChanges, splitTags } from './tagDiff';

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    name: 'Test Card',
    set: 'Ki',
    imgFile: 'test-card',
    officialSet: 'Kings',
    type: 'Hero',
    brigade: '',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Common',
    reference: '',
    alignment: 'Good',
    legality: '',
    artist: '',
    ...overrides,
  };
}
// makeCard({}) => desiredTags = ['Hero', 'Kings']

function product(id: string, title: string, tags: string | null) {
  return { id, title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), tags };
}

describe('computeProductTagDiff', () => {
  it('single mapping: adds missing desired tags, removes stale managed tags', () => {
    const rows = computeProductTagDiff(
      [product('1', 'Test Card (Ki)', 'Hero, Rotation Cards')],
      new Map([['1', [makeCard({})]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe('1');
    expect(rows[0].add).toEqual(['Kings']);
    expect(rows[0].remove).toEqual(['Rotation Cards']);
  });

  it("spec promo_fallback scenario: union over multi-mapped product keeps BOTH 'Promos' and the original set tag", () => {
    // Card X (promo print) and card Y (original print) both map to product P
    // (promo fallback pass — shopify_product_id is not unique in card_price_mappings).
    const promoCard = makeCard({ name: 'Angel Food', officialSet: 'Promo', type: 'GE' });
    // desiredTags(promoCard) = ['Good Enhancement', 'Promo', 'Promos']
    const originalCard = makeCard({ name: 'Angel Food', officialSet: 'Kings', type: 'GE' });
    // desiredTags(originalCard) = ['Good Enhancement', 'Kings']
    const rows = computeProductTagDiff(
      [product('7', 'Angel Food (Ki)', 'Good Enhancement, Kings, Promos, Rotation Cards')],
      new Map([['7', [promoCard, originalCard]]]),
    );
    expect(rows).toHaveLength(1);
    // Desired = UNION of both prints — neither 'Promos' nor 'Kings' may be removed.
    expect(rows[0].remove).toEqual(['Rotation Cards']);
    expect(rows[0].remove).not.toContain('Promos');
    expect(rows[0].remove).not.toContain('Kings');
    expect(rows[0].add).toEqual(['Promo']);
  });

  it('never removes non-managed store tags', () => {
    const rows = computeProductTagDiff(
      [product('2', 'Test Card (Ki)', 'Hero, Kings, Staff Pick, Best Sellers, Rotation Cards')],
      new Map([['2', [makeCard({})]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].remove).toEqual(['Rotation Cards']); // Staff Pick / Best Sellers untouched
    expect(rows[0].add).toEqual([]);
  });

  it('removes a managed (collision-name) tag when it is outside the union', () => {
    // 'Gold' is a managed brigade tag name Andy also hand-uses for merchandising.
    // On a MAPPED product carrying it outside the union, the diff proposes removal —
    // the per-tag removal opt-in in the UI is what protects hand-added uses.
    const rows = computeProductTagDiff(
      [product('3', 'Test Card (Ki)', 'Hero, Kings, Gold')],
      new Map([['3', [makeCard({})]]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].remove).toEqual(['Gold']);
    expect(rows[0].add).toEqual([]);
  });

  it('excludes clean products and products with no mapped cards', () => {
    const rows = computeProductTagDiff(
      [
        product('4', 'Clean Product', 'Hero, Kings'),          // matches desired exactly
        product('5', 'Unmapped Product', 'Rotation Cards'),    // no confirmed mapping → skipped
      ],
      new Map([['4', [makeCard({})]]]),
    );
    expect(rows).toEqual([]);
  });

  it('sorts rows by title and add/remove lists alphabetically', () => {
    const dominant = makeCard({ name: 'Dom', type: 'Dominant', officialSet: 'Apostles', legality: 'Rotation' });
    const rows = computeProductTagDiff(
      [product('11', 'Zeta Card', ''), product('10', 'Alpha Card', '')],
      new Map([
        ['11', [makeCard({})]],
        ['10', [dominant]],
      ]),
    );
    expect(rows.map(r => r.title)).toEqual(['Alpha Card', 'Zeta Card']);
    expect(rows[0].add).toEqual(['Apostles', 'Dominant', 'Rotation Cards']);
    expect(rows[1].add).toEqual(['Hero', 'Kings']);
  });
});

describe('rollupTagChanges', () => {
  it('counts adds and removes per tag, sorted by total desc then name', () => {
    const rollup = rollupTagChanges([
      { productId: '1', title: 'A', handle: 'a', add: ['Limited'], remove: ['Rotation Cards'] },
      { productId: '2', title: 'B', handle: 'b', add: ['Limited', 'Kings'], remove: [] },
      { productId: '3', title: 'C', handle: 'c', add: [], remove: ['Rotation Cards'] },
    ]);
    expect(rollup).toEqual([
      { tag: 'Limited', addCount: 2, removeCount: 0 },
      { tag: 'Rotation Cards', addCount: 0, removeCount: 2 },
      { tag: 'Kings', addCount: 1, removeCount: 0 },
    ]);
  });
});

describe('splitTags', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(splitTags('Hero, Kings ,  Rotation Cards')).toEqual(['Hero', 'Kings', 'Rotation Cards']);
  });
  it('returns [] for null, empty, and separator-only strings', () => {
    expect(splitTags(null)).toEqual([]);
    expect(splitTags('')).toEqual([]);
    expect(splitTags(' , ,')).toEqual([]);
  });
});
