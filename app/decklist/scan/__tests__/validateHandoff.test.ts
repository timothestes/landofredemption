import { describe, it, expect } from 'vitest';
import { validateHandoff } from '../lib/validateHandoff';
import { forceMainOnly } from '../lib/forceMainOnly';

const SID = '11111111-1111-4111-8111-111111111111';
const known = (k: string) => k.startsWith('Good|');
const row = (o: Record<string, unknown> = {}) => ({ card_name: 'Good', card_set: 'X', card_img_file: 'a', quantity: 1, zone: 'main', ...o });
const good = (o: Record<string, unknown> = {}) => ({
  rows: [row()],
  outcomesByScanId: { [SID]: [{ id: `${SID}:0`, finalKey: 'Good|X|a' }, { id: `${SID}:add:1` }, { id: `${SID}:ls:2` }] },
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
  it('rejects outcome ids under the wrong scan or malformed', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    expect(validateHandoff(good({ outcomesByScanId: { [SID]: [{ id: `${other}:0` }] } }), known)).toBeNull();
    expect(validateHandoff(good({ outcomesByScanId: { [SID]: [{ id: 'x:ls:a' }] } }), known)).toBeNull();
    expect(validateHandoff(good({ outcomesByScanId: { 'not-a-uuid': [] } }), known)).toBeNull();
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
