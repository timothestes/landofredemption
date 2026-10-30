import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mergeDeckRows, impliedFamily, defaultReserveGroups, type DeckEntry, type GroupSize } from '../deck';
import type { Box } from '../deckSchema';
import { FORMATS } from '@/lib/formats';

const e = (p: Partial<DeckEntry>): DeckEntry => ({ readId: 's:0', photo: 0, group: 1, kind: 'matched', key: 'Abner|K|abner', title: 'Abner', type: 'Evil Character', ...p });

describe('mergeDeckRows', () => {
  it('merges matched reads across groups with per-group shares', () => {
    const rows = mergeDeckRows([e({ readId: 's:0' }), e({ readId: 's:1', group: 2 }), e({ readId: 's:2', group: 2 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
    expect(rows[0].shares).toEqual({ '0:1': 1, '0:2': 2 });
    expect(rows[0].readIds).toEqual(['s:0', 's:1', 's:2']);
  });
  it('a read_as row never merges into a matched row of the same card', () => expect(mergeDeckRows([e({}), e({ kind: 'read_as' })])).toHaveLength(2));
  it('Lost Soul placeholders and unread reads collapse per group', () => {
    const rows = mergeDeckRows([
      e({ kind: 'lost_soul', key: null, title: 'Lost Soul', type: 'Lost Soul' }),
      e({ kind: 'lost_soul', key: null, title: 'Lost Soul', type: 'Lost Soul' }),
      e({ kind: 'lost_soul', key: null, group: 2, title: 'Lost Soul', type: 'Lost Soul' }),
      e({ kind: 'unread', key: null, title: null }),
    ]);
    expect(rows.map(r => [r.kind, r.quantity])).toEqual([['lost_soul', 2], ['lost_soul', 1], ['unread', 1]]);
  });
  it('not_found merges on the normalized read title', () => expect(mergeDeckRows([e({ kind: 'not_found', key: null, title: 'Fresh Bread' }), e({ kind: 'not_found', key: null, title: 'fresh  bread', group: 3 })])[0].quantity).toBe(2));
  it('Lost Souls and Dominants are main-only', () => {
    const rows = mergeDeckRows([e({ kind: 'lost_soul', key: null, type: 'Lost Soul' }), e({ key: 'Son of God|P|sog', type: 'Dominant' })]);
    expect(rows.every(r => r.mainOnly)).toBe(true);
  });
  it('which rows key on sorted candidates', () => {
    const rows = mergeDeckRows([e({ kind: 'which', key: null, identityCandidates: ['b', 'a'] }), e({ kind: 'which', key: null, identityCandidates: ['a', 'b'] })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
  });
  it('ordinary characters are not main-only', () => expect(mergeDeckRows([e({})])[0].mainOnly).toBe(false));
});

describe('impliedFamily', () => {
  it('reads FORMATS', () => {
    expect(impliedFamily(FORMATS.T2.main.min)).toBe('T2');
    expect(impliedFamily(FORMATS.T2.main.min - 1)).toBe('T1');
    expect(impliedFamily(FORMATS.T2.main.max + 1)).toBe('T1');
  });
});

const g = (key: string, count: number, orientation: GroupSize['orientation'] = 'upright') => ({ key, count, orientation });
describe('defaultReserveGroups', () => {
  it('the last group is Reserve when the rest make a deck and it fits', () => expect(defaultReserveGroups([g('0:1', 25), g('0:2', 25), g('0:3', 10)])).toEqual(['0:3']));
  it('the only sideways group is Reserve even when not last', () => expect(defaultReserveGroups([g('0:1', 8, 'rotated_cw'), g('0:2', 26), g('0:3', 26)])).toEqual(['0:1']));
  it('no Reserve when the rest are under the main minimum', () => expect(defaultReserveGroups([g('0:1', 40), g('0:2', 9)])).toEqual([]));
  it('no Reserve when the group is over the reserve max', () => expect(defaultReserveGroups([g('0:1', 50), g('0:2', 11)])).toEqual([]));
  it('a Type 2 main allows a 20-card reserve', () => expect(defaultReserveGroups([g('0:1', 100), g('0:2', 20)])).toEqual(['0:2']));
  it('two sideways groups fall back to the last group', () => expect(defaultReserveGroups([g('0:1', 5, 'rotated_cw'), g('0:2', 50), g('0:3', 5, 'rotated_ccw')])).toEqual(['0:3']));
  it('a synthetic group 0 is never Reserve, but counts toward the rest', () => expect(defaultReserveGroups([g('0:1', 25), g('0:2', 25), g('0:0', 5)])).toEqual([]));
  it('a synthetic group 0 is skipped for the real last group', () => expect(defaultReserveGroups([g('0:1', 50), g('0:2', 8), g('0:0', 3)])).toEqual(['0:2']));
  it('one group is never Reserve', () => expect(defaultReserveGroups([g('0:1', 60)])).toEqual([]));

  describe('from the layout (group boxes recorded on eval photos)', () => {
    // id, cards read, cards identified (matched / which / read as), box, orientation.
    const p = (id: number, count: number, identified: number, bbox: Box, orientation: GroupSize['orientation'] = 'upright'): GroupSize =>
      ({ key: `0:${id}`, count, identified, bbox, orientation });
    const keys = (...ids: number[]) => ids.map(id => `0:${id}`);

    it('a row set apart from the columns is Reserve, even fanned across two groups (20240804_163529)', () => {
      expect(defaultReserveGroups([p(1, 7, 0, [0, 0.08, 0.14, 0.6]), p(2, 7, 5, [0.14, 0.08, 0.28, 0.6]), p(3, 10, 8, [0.27, 0.09, 0.41, 0.76]), p(4, 11, 11, [0.4, 0.09, 0.54, 0.76]), p(5, 5, 4, [0.52, 0.09, 0.65, 0.47]), p(6, 7, 6, [0.65, 0.09, 0.77, 0.55]), p(7, 4, 1, [0.77, 0.11, 0.91, 0.47]), p(8, 7, 6, [0.56, 0.55, 1, 0.93]), p(9, 3, 3, [0.56, 0.69, 0.77, 1])]))
        .toEqual(keys(8, 9));
    });
    it('a row above the columns is Reserve, not the last column (IMG_2745)', () => {
      expect(defaultReserveGroups([p(1, 10, 5, [0, 0, 1, 0.2]), p(2, 7, 0, [0, 0.18, 0.15, 0.86]), p(3, 7, 7, [0.12, 0.18, 0.27, 0.78]), p(4, 10, 10, [0.25, 0.19, 0.4, 0.99]), p(5, 6, 6, [0.4, 0.19, 0.53, 0.72]), p(6, 7, 7, [0.52, 0.2, 0.66, 0.78]), p(7, 4, 4, [0.65, 0.2, 0.78, 0.65]), p(8, 1, 1, [0.67, 0.69, 0.8, 0.93]), p(9, 9, 9, [0.79, 0.2, 0.94, 0.97])]))
        .toEqual(keys(1));
    });
    it('a row of short columns is Reserve as one (SPOILER_IMG_20231019)', () => {
      expect(defaultReserveGroups([p(1, 7, 0, [0.14, 0.07, 0.24, 0.37]), p(2, 6, 0, [0.24, 0.07, 0.34, 0.34]), p(3, 7, 0, [0.34, 0.07, 0.43, 0.34]), p(4, 9, 0, [0.43, 0.07, 0.54, 0.4]), p(5, 8, 0, [0.54, 0.07, 0.64, 0.4]), p(6, 4, 0, [0.62, 0.07, 0.72, 0.31]), p(7, 5, 0, [0.71, 0.07, 0.82, 0.3]), p(8, 10, 0, [0.81, 0.07, 0.93, 0.43]), p(9, 2, 0, [0.12, 0.41, 0.23, 0.61]), p(10, 2, 1, [0.23, 0.41, 0.33, 0.61]), p(11, 2, 0, [0.33, 0.4, 0.42, 0.6]), p(12, 4, 3, [0.43, 0.41, 0.54, 0.67]), p(13, 0, 0, [0.85, 0.43, 0.97, 0.7])]))
        .toEqual(keys(9, 10, 11, 12));
    });
    it('rows that read no card (tokens, art cards) are skipped for the last column (20240622_125334)', () => {
      expect(defaultReserveGroups([p(1, 7, 0, [0.01, 0.14, 0.17, 0.6]), p(2, 7, 6, [0.12, 0.14, 0.25, 0.6]), p(3, 4, 4, [0.25, 0.15, 0.35, 0.45]), p(4, 7, 7, [0.34, 0.14, 0.45, 0.48]), p(5, 10, 10, [0.45, 0.14, 0.55, 0.61]), p(6, 7, 7, [0.54, 0.15, 0.63, 0.47]), p(7, 5, 5, [0.62, 0.15, 0.73, 0.47]), p(8, 3, 3, [0.71, 0.15, 0.81, 0.35]), p(9, 10, 10, [0.83, 0.14, 0.96, 0.6]), p(10, 7, 0, [0.2, 0.56, 0.43, 0.8]), p(11, 5, 0, [0.42, 0.56, 0.64, 0.79]), p(12, 4, 0, [0.62, 0.6, 0.92, 0.81])]))
        .toEqual(keys(9));
    });
    it('a row of Lost Souls below the columns is not Reserve (IMG_4302)', () => {
      expect(defaultReserveGroups([p(1, 7, 7, [0, 0.04, 0.14, 0.66]), p(2, 6, 6, [0.14, 0.04, 0.26, 0.56]), p(3, 7, 7, [0.25, 0.04, 0.37, 0.69]), p(4, 7, 7, [0.38, 0.04, 0.49, 0.69]), p(5, 7, 7, [0.5, 0.02, 0.63, 0.65]), p(6, 9, 8, [0.63, 0.05, 0.77, 0.81]), p(7, 10, 10, [0.86, 0.04, 1, 0.86]), p(8, 7, 0, [0.01, 0.67, 0.34, 0.97])]))
        .toEqual(keys(7));
    });
    it('columns whose tops drift across a tilted photo stay one band (20240601_085635)', () => {
      expect(defaultReserveGroups([p(1, 9, 0, [0, 0.05, 0.18, 0.55]), p(2, 7, 1, [0.13, 0.09, 0.29, 0.49]), p(3, 7, 0, [0.25, 0.09, 0.4, 0.55]), p(4, 5, 1, [0.39, 0.11, 0.52, 0.45]), p(5, 9, 3, [0.52, 0.11, 0.65, 0.54]), p(6, 11, 0, [0.64, 0.12, 0.79, 0.68]), p(7, 7, 0, [0.75, 0.12, 0.9, 0.54]), p(8, 8, 0, [0.86, 0.15, 1, 0.6])]))
        .toEqual(keys(8));
    });
    it('keeps the sideways Reserve row (dark photo 1) and picks the half of a too-big row that fits (Star Wars mat)', () => {
      expect(defaultReserveGroups([p(1, 10, 8, [0.23, 0.07, 0.76, 0.25], 'rotated_ccw'), p(2, 8, 0, [0.01, 0.24, 0.17, 0.77]), p(3, 7, 6, [0.15, 0.26, 0.3, 0.73]), p(4, 6, 4, [0.3, 0.26, 0.44, 0.69]), p(5, 12, 8, [0.43, 0.25, 0.62, 0.96]), p(6, 4, 4, [0.55, 0.25, 0.71, 0.6]), p(7, 10, 9, [0.68, 0.24, 0.9, 0.87]), p(8, 4, 3, [0.81, 0.23, 0.97, 0.58])]))
        .toEqual(keys(1));
      expect(defaultReserveGroups([p(1, 8, 8, [0.02, 0.04, 0.17, 0.73]), p(2, 10, 10, [0.19, 0.05, 0.35, 0.79]), p(3, 9, 9, [0.37, 0.05, 0.53, 0.7]), p(4, 9, 9, [0.55, 0.05, 0.7, 0.7]), p(5, 7, 7, [0.72, 0.04, 0.87, 0.6]), p(6, 8, 1, [0.1, 0.78, 0.61, 0.98], 'rotated_ccw'), p(7, 6, 2, [0.61, 0.75, 0.93, 0.96], 'rotated_ccw')]))
        .toEqual(keys(7));
    });
    it('no Reserve when the rest is under the main minimum (sharp photo, a 2-card group below)', () => {
      expect(defaultReserveGroups([p(1, 7, 1, [0.07, 0.03, 0.22, 0.65]), p(2, 9, 9, [0.22, 0.02, 0.39, 0.6]), p(3, 7, 7, [0.36, 0.01, 0.54, 0.56]), p(4, 4, 4, [0.51, 0.01, 0.67, 0.43]), p(5, 12, 12, [0.67, 0.03, 0.85, 0.96]), p(6, 9, 9, [0.81, 0.04, 0.97, 0.8]), p(7, 2, 2, [0.06, 0.64, 0.23, 0.99])]))
        .toEqual([]);
    });
    it('groups from two photos, or without boxes, use the last-group rule', () => {
      const row = (key: string, count: number, bbox: Box): GroupSize => ({ key, count, identified: count, bbox, orientation: 'upright' });
      const twoPhotos = [row('a:1', 25, [0, 0, 0.5, 0.6]), row('a:2', 25, [0.5, 0, 1, 0.6]), row('a:3', 10, [0, 0.7, 1, 1]), row('b:1', 8, [0, 0, 1, 1])];
      expect(defaultReserveGroups(twoPhotos)).toEqual(['b:1']);
      // With every box, the row below (0:2) would be Reserve; one group without a box falls back to the last group.
      const noBox = [row('0:1', 50, [0, 0, 1, 0.6]), row('0:2', 9, [0, 0.7, 1, 1]), { key: '0:3', count: 5, orientation: 'upright' as const }];
      expect(defaultReserveGroups(noBox)).toEqual(['0:3']);
      expect(defaultReserveGroups([noBox[0], noBox[1], { ...noBox[2], bbox: [0.2, 0.1, 0.3, 0.6] as Box, identified: 5 }])).toEqual(['0:2']);
    });
  });
});

describe('client safety', () => {
  it('deck.ts avoids the catalog, stemIndex and vocab', () => {
    expect(fs.readFileSync('lib/scan/deck.ts', 'utf8')).not.toMatch(/lib\/cards|stemIndex|\.\/vocab/);
  });
});
