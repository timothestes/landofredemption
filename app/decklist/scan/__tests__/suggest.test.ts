import { describe, expect, it } from 'vitest';
import { searchPrintings } from '@/app/collection/scan/lib/pickerSearch';
import { CARDS } from '@/lib/cards/lookup';
import { cardIdentityKey } from '@/lib/cards/cardIdentity';
import { chipsFor, suggestFor } from '../lib/suggest';

describe('suggestFor', () => {
  it('gives one printing per card identity', () => {
    const out = suggestFor('Captive Preist', undefined);
    expect(out.length).toBeGreaterThan(0);
    expect(new Set(out.map(h => h.identity)).size).toBe(out.length);
  });

  it('puts a near stem ahead of what the read title finds', () => {
    const near = searchPrintings('Son of God').hits[0];
    const out = suggestFor('Captive Preist', [{ stem: 'Son of God', d: 1 }]);
    expect(out[0].identity).toBe(near.identity);
  });

  it('orders near stems by ascending distance regardless of input order', () => {
    const a = searchPrintings('Son of God').hits[0].identity;
    const b = searchPrintings('Moses').hits[0].identity;
    const out = suggestFor(null, [{ stem: 'Moses', d: 3 }, { stem: 'Son of God', d: 1 }]);
    expect(out[0].identity).toBe(a);
    expect(out[1].identity).toBe(b);
  });

  it('does not repeat a card the read title and a near stem both find', () => {
    const out = suggestFor('Son of God', [{ stem: 'Son of God', d: 0 }]);
    expect(new Set(out.map(h => h.identity)).size).toBe(out.length);
  });

  it('caps the list at max', () => {
    expect(suggestFor('Captive Preist', undefined, 2).length).toBeLessThanOrEqual(2);
    expect(suggestFor('Captive Preist', undefined).length).toBeLessThanOrEqual(5);
  });

  it('prefers the Rotation printing of a card', () => {
    const out = suggestFor('Son of God', undefined, 50);
    for (const h of out) {
      const all = searchPrintings(h.name).hits.filter(x => x.identity === h.identity);
      if (all.some(x => x.legality === 'Rotation')) expect(h.legality).toBe('Rotation');
    }
  });

  it('returns nothing with no title and no stems', () => {
    expect(suggestFor(null, undefined)).toEqual([]);
    expect(suggestFor('', [])).toEqual([]);
  });
});

describe('chipsFor', () => {
  it('gives nothing for an unread, matched or Lost Soul row', () => {
    expect(chipsFor({ kind: 'unread', title: null })).toEqual([]);
    expect(chipsFor({ kind: 'matched', title: 'Moses' })).toEqual([]);
    expect(chipsFor({ kind: 'lost_soul', title: 'Lost Soul' })).toEqual([]);
  });

  it('gives up to three chips for a Not found row, the misread card first', () => {
    const chips = chipsFor({ kind: 'not_found', title: 'Captive Preist' });
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips[0].label).toMatch(/^Captive Priest/);
    for (const c of chips) expect(c.siblings.map(x => x.key)).toContain(c.key);
  });

  it('puts the candidates of a Which card? row first, with labels that tell them apart', () => {
    const ids = [...new Set(CARDS.filter(c => /^A New Beginning( \(|$)/.test(c.name)).map(cardIdentityKey))];
    expect(ids.length).toBe(2);
    const chips = chipsFor({ kind: 'which', title: 'A New Beginning', identityCandidates: ids });
    expect(chips.slice(0, 2).map(c => cardIdentityKey(CARDS.find(x => `${x.name}|${x.set}|${x.imgFile}` === c.key)!))).toEqual(ids);
    expect(new Set(chips.map(c => c.label)).size).toBe(chips.length);
    expect(new Set(chips.map(c => c.key)).size).toBe(chips.length);
  });

  it('prefers the Rotation printing of a candidate', () => {
    const id = cardIdentityKey(CARDS.find(c => c.name === 'A New Beginning (FoM)')!);
    const [chip] = chipsFor({ kind: 'which', title: null, identityCandidates: [id] });
    expect(chip.siblings.find(x => x.key === chip.key)!.legality).toBe('Rotation');
  });

  it("turns the server's near stem into a chip for a title its own search cannot find", () => {
    const chips = chipsFor({ kind: 'not_found', title: 'Cremus Choice', near: [{ stem: 'crowds choice', d: 0.23 }] });
    expect(chips[0].label).toMatch(/^Crowd's Choice/);
  });
});
