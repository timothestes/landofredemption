import { describe, expect, it } from 'vitest';
import { searchPrintings } from '../lib/pickerSearch';

describe('searchPrintings', () => {
  it('expands a name hit to every printing of that card, unpriced and deduped', () => {
    const hits = searchPrintings('Son of God');
    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map(h => h.key)).size).toBe(hits.length);
    expect(hits.every(h => h.price === null)).toBe(true);
    expect(hits.every(h => h.key === `${h.name}|${h.set}|${h.imgFile}`)).toBe(true);
    const first = hits.filter(h => h.identity === hits[0].identity);
    expect(first.length).toBeGreaterThan(1);
  });

  it('returns nothing for a query no card matches', () => {
    expect(searchPrintings('zzqqxx no such card')).toEqual([]);
  });
});
