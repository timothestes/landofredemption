import { describe, it, expect } from 'vitest';
import { validateHandoff } from '../lib/validateHandoff';
import { forceMainOnly } from '../lib/forceMainOnly';

const SID = '11111111-1111-4111-8111-111111111111';
const known = (k: string) => k.startsWith('Good|');
const row = (o: Record<string, unknown> = {}) => ({ card_name: 'Good', card_set: 'X', card_img_file: 'a', quantity: 1, zone: 'main', ...o });
const oc = (id: string, o: Record<string, unknown> = {}) => ({
  id, finalKey: 'Good|X|a', nameChanged: false, printingChanged: false, removed: false, unresolved: false, zone: 'main', lostSoulPick: false, ...o,
});
const good = (o: Record<string, unknown> = {}) => ({
  rows: [row()],
  outcomesByScanId: { [SID]: [oc(`${SID}:0`), oc(`${SID}:add:1`), oc(`${SID}:ls:2`, { finalKey: null, zone: null })] },
  name: 'My deck',
  format: 'Type 1',
  ...o,
});

describe('validateHandoff', () => {
  it('accepts a good payload', () => {
    const r = validateHandoff(good(), known);
    expect(r?.rows).toHaveLength(1);
    expect(r?.format).toBe('Type 1');
    expect(r?.outcomesByScanId[SID]).toHaveLength(3);
  });
  it.each([0, 100, 1.5])('rejects quantity %s', q => {
    expect(validateHandoff(good({ rows: [row({ quantity: q })] }), known)).toBeNull();
  });
  it('rejects unknown key, bad zone', () => {
    expect(validateHandoff(good({ rows: [row({ card_name: 'Nope' })] }), known)).toBeNull();
    expect(validateHandoff(good({ rows: [row({ zone: 'maybeboard' })] }), known)).toBeNull();
  });
  it('drops outcome ids under the wrong scan or malformed, and bad scan-id keys', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const r1 = validateHandoff(good({ outcomesByScanId: { [SID]: [oc(`${other}:0`), oc(`${SID}:1`)] } }), known);
    expect(r1?.outcomesByScanId[SID].map(o => o.id)).toEqual([`${SID}:1`]);
    const r2 = validateHandoff(good({ outcomesByScanId: { [SID]: [oc('x:ls:a')] } }), known);
    expect(r2?.rows).toHaveLength(1);
    expect(r2?.outcomesByScanId[SID]).toEqual([]);
    const r3 = validateHandoff(good({ outcomesByScanId: { 'not-a-uuid': [] } }), known);
    expect(r3).not.toBeNull();
    expect(r3?.outcomesByScanId).toEqual({});
  });
  it('rebuilds outcomes, dropping extra keys', () => {
    const r = validateHandoff(good({ outcomesByScanId: { [SID]: [oc(`${SID}:0`, { evil: { a: 1 } })] } }), known);
    expect(r?.outcomesByScanId[SID][0]).not.toHaveProperty('evil');
    expect(Object.keys(r!.outcomesByScanId[SID][0]).sort()).toEqual(
      ['finalKey', 'id', 'lostSoulPick', 'nameChanged', 'printingChanged', 'removed', 'unresolved', 'zone']);
  });
  it('drops bad outcomes and keeps the payload', () => {
    const bad = (o: Record<string, unknown>) => validateHandoff(good({ outcomesByScanId: { [SID]: [oc(`${SID}:0`, o), oc(`${SID}:1`)] } }), known);
    for (const o of [{ finalKey: 'Nope|X|a' }, { removed: 'yes' }, { zone: 'maybeboard' }]) {
      const r = bad(o);
      expect(r?.rows).toHaveLength(1);
      expect(r?.outcomesByScanId[SID].map(x => x.id)).toEqual([`${SID}:1`]);
    }
  });
  it('drops over-cap outcomes instead of rejecting, and still needs non-empty rows', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const r1 = validateHandoff(good({ outcomesByScanId: Object.fromEntries(ids.map(i => [i, []])) }), known);
    expect(r1?.rows).toHaveLength(1);
    expect(r1?.outcomesByScanId).toEqual({});
    const many = Array.from({ length: 401 }, (_, n) => oc(`${SID}:${n}`));
    const r2 = validateHandoff(good({ outcomesByScanId: { [SID]: many } }), known);
    expect(r2?.rows).toHaveLength(1);
    expect(r2?.outcomesByScanId[SID]).toBeUndefined();
    expect(validateHandoff(good({ rows: [] }), known)).toBeNull();
  });
  it('rejects 301 rows, long name, bad format', () => {
    expect(validateHandoff(good({ rows: Array.from({ length: 301 }, () => row()) }), known)).toBeNull();
    expect(validateHandoff(good({ name: 'x'.repeat(101) }), known)).toBeNull();
    expect(validateHandoff(good({ name: '' }), known)).toBeNull();
    expect(validateHandoff(good({ format: 'T2' }), known)).toBeNull();
    expect(validateHandoff(null, known)).toBeNull();
  });
});

describe('forceMainOnly', () => {
  const typeOf = (r: { card_name: string }) => (r.card_name === 'Soul' ? 'Lost Soul' : r.card_name === 'Dom' ? 'Dominant' : 'Hero');
  const mk = (card_name: string, quantity: number, zone: 'main' | 'reserve') => ({ card_name, card_set: 'X', card_img_file: 'a', quantity, zone });
  it('moves Lost Souls and Dominants to main and merges, capping at 99', () => {
    const out = forceMainOnly([mk('Soul', 60, 'reserve'), mk('Soul', 50, 'main'), mk('Dom', 1, 'reserve'), mk('Hero', 2, 'reserve')], typeOf);
    expect(out).toContainEqual(mk('Soul', 99, 'main'));
    expect(out).toContainEqual(mk('Dom', 1, 'main'));
    expect(out).toContainEqual(mk('Hero', 2, 'reserve'));
    expect(out).toHaveLength(3);
  });
  it('matches case-insensitively and tolerates unknown types', () => {
    const out = forceMainOnly([mk('a', 1, 'reserve')], () => 'lost soul');
    expect(out[0].zone).toBe('main');
    expect(forceMainOnly([mk('a', 1, 'reserve')], () => undefined)[0].zone).toBe('reserve');
  });
});
