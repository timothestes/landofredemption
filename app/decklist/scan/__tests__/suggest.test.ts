import { describe, expect, it } from 'vitest';
import { searchPrintings } from '@/app/collection/scan/lib/pickerSearch';
import { suggestFor } from '../lib/suggest';

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
