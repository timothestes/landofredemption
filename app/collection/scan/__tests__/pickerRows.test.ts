import { describe, expect, it } from 'vitest';
import { onePerCard, moveActive } from '../lib/pickerRows';
import type { PickerHit } from '../lib/pickerSearch';

const hit = (name: string, identity: string, legality = ''): PickerHit => ({
  key: `${name}|S|${name}`, name, set: 'S', officialSet: 'Set', imgFile: name, legality, price: null, identity,
});

describe('onePerCard', () => {
  it('lists each card once, on its Rotation printing, with how many printings it has', () => {
    const rows = onePerCard([hit('Moses (Pr)', 'moses'), hit('Moses (RoJ)', 'moses', 'Rotation'), hit('Moses (Wa)', 'moses')], null);
    expect(rows).toEqual([{ hit: expect.objectContaining({ name: 'Moses (RoJ)' }), printings: 3 }]);
  });
  it('shows the regular printing before an alternate border', () => {
    const rows = onePerCard([hit('Moses (CoW AB)', 'moses', 'Rotation'), hit('Moses (CoW)', 'moses', 'Rotation')], null);
    expect(rows[0].hit.name).toBe('Moses (CoW)');
  });
  it('shows the current printing for the card that has it', () => {
    const hits = [hit('Moses (Pr)', 'moses'), hit('Moses (RoJ)', 'moses', 'Rotation')];
    expect(onePerCard(hits, hits[0].key)[0].hit.name).toBe('Moses (Pr)');
  });
  it('puts cards legal in Limited first and otherwise keeps the search order', () => {
    const rows = onePerCard([
      hit('Aaron', 'aaron-old'), hit('Aaron, the Voice', 'aaron-voice', 'Rotation'), hit('Abihu', 'abihu'), hit("Aaron's Rod", 'rod', 'Rotation'),
    ], null);
    expect(rows.map(r => r.hit.name)).toEqual(['Aaron, the Voice', "Aaron's Rod", 'Aaron', 'Abihu']);
  });
  it('is empty for no hits', () => expect(onePerCard([], null)).toEqual([]));
});

describe('moveActive', () => {
  it('steps within the list and stops at its ends', () => {
    expect(moveActive(0, 1, 3)).toBe(1);
    expect(moveActive(2, 1, 3)).toBe(2);
    expect(moveActive(0, -1, 3)).toBe(0);
  });
  it('stays at 0 for an empty list', () => expect(moveActive(0, 1, 0)).toBe(0));
});
