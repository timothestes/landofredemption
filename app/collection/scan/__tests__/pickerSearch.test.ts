import { describe, expect, it } from 'vitest';
import { searchPrintings } from '../lib/pickerSearch';

describe('searchPrintings', () => {
  it('expands a name hit to every printing of that card, unpriced and deduped', () => {
    const { hits, close } = searchPrintings('Son of God');
    expect(close).toBe(false);
    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map(h => h.key)).size).toBe(hits.length);
    expect(hits.every(h => h.price === null)).toBe(true);
    expect(hits.every(h => h.key === `${h.name}|${h.set}|${h.imgFile}`)).toBe(true);
    const first = hits.filter(h => h.identity === hits[0].identity);
    expect(first.length).toBeGreaterThan(1);
  });

  it('returns nothing for a query no card matches', () => {
    expect(searchPrintings('zzqqxx qqzzyy')).toEqual({ hits: [], close: false });
  });

  it('a misread title still finds the card, flagged as a close match', () => {
    for (const misread of ['Captve Preist', 'Captve Priest', 'Captive Preist']) {
      const { hits, close } = searchPrintings(misread);
      expect(close).toBe(true);
      // Ranked first, not just somewhere below the fold: it matches both words.
      expect(hits[0].name).toMatch(/captive priest/i);
    }
  });
});
