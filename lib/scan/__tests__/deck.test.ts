import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mergeDeckRows, impliedFamily, defaultReserveGroup, type DeckEntry, type GroupSize } from '../deck';
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
describe('defaultReserveGroup', () => {
  it('the last group is Reserve when the rest make a deck and it fits', () => expect(defaultReserveGroup([g('0:1', 25), g('0:2', 25), g('0:3', 10)])).toBe('0:3'));
  it('the only sideways group is Reserve even when not last', () => expect(defaultReserveGroup([g('0:1', 8, 'rotated_cw'), g('0:2', 26), g('0:3', 26)])).toBe('0:1'));
  it('no Reserve when the rest are under the main minimum', () => expect(defaultReserveGroup([g('0:1', 40), g('0:2', 9)])).toBeNull());
  it('no Reserve when the group is over the reserve max', () => expect(defaultReserveGroup([g('0:1', 50), g('0:2', 11)])).toBeNull());
  it('a Type 2 main allows a 20-card reserve', () => expect(defaultReserveGroup([g('0:1', 100), g('0:2', 20)])).toBe('0:2'));
  it('two sideways groups fall back to the last group', () => expect(defaultReserveGroup([g('0:1', 5, 'rotated_cw'), g('0:2', 50), g('0:3', 5, 'rotated_ccw')])).toBe('0:3'));
  it('one group is never Reserve', () => expect(defaultReserveGroup([g('0:1', 60)])).toBeNull());
});

describe('client safety', () => {
  it('deck.ts avoids the catalog, stemIndex and vocab', () => {
    expect(fs.readFileSync('lib/scan/deck.ts', 'utf8')).not.toMatch(/lib\/cards|stemIndex|\.\/vocab/);
  });
});
