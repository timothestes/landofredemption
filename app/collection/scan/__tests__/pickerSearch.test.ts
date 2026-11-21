import { describe, expect, it } from 'vitest';
import { searchPrintings, withIdentity } from '../lib/pickerSearch';

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

  it('leads with Lost Souls when the row being changed holds one', () => {
    // Without the flag the name index drops the soul: its nickname only matches inside the quotes.
    expect(searchPrintings('shepherd').hits.some(h => h.name.startsWith('Lost Soul'))).toBe(false);
    for (const typed of ['shep', 'shepherd', 'shephers....', 'sheperds', 'Lost Soul shepherds']) {
      const { hits, close } = searchPrintings(typed, { lostSoulsFirst: true });
      expect(hits[0].name).toContain('Lost Soul "Shepherds"');
      expect(close).toBe(false);
      expect(new Set(hits.map(h => h.key)).size).toBe(hits.length);
    }
    const all = searchPrintings('Lost Soul', { lostSoulsFirst: true }).hits;
    expect(all.length).toBeGreaterThan(100);
    expect(all.some(h => /token/i.test(h.name))).toBe(false);
    // A search that names no soul is the ordinary search.
    expect(searchPrintings('Son of God', { lostSoulsFirst: true })).toEqual(searchPrintings('Son of God'));
  });

  it('lists both cards when two different cards share a name, type and brigade', () => {
    // The name index keeps one row for the pair, and its printing is the I deck card.
    for (const typed of ['Legion of Angels', 'Legion']) {
      const { hits } = searchPrintings(typed);
      const legions = hits.filter(h => h.name.startsWith('Legion of Angels'));
      expect(legions.map(h => h.name).sort()).toEqual(['Legion of Angels', 'Legion of Angels (GoC)']);
      expect(new Set(legions.map(h => h.identity)).size).toBe(2);
    }
  });

  it('tags candidates with their card, so printings of one card share an identity', () => {
    const { hits } = searchPrintings("Crowd's Choice");
    const bare = hits.map(({ identity: _identity, ...c }) => c);
    expect(withIdentity(bare)).toEqual(hits);
    expect(new Set(hits.map(h => h.identity)).size).toBe(1);
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
