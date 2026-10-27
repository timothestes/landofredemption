import { describe, it, expect } from 'vitest';
import { PRINTING_CUES, normalizeCredit, creditAgrees, normalizeCaption, cueFor } from '../cues';
describe('credits', () => {
  it('normalizes the credit line', () => { expect(normalizeCredit('Illus. © Cahaba Productions')).toBe('cahaba productions'); expect(normalizeCredit('Illus. J.J. Tissot')).toBe('j j tissot'); });
  it('agrees across punctuation and disagrees across artists', () => { expect(creditAgrees(normalizeCredit('Illus. J.J. Tissot'), normalizeCredit('Illus. JJ Tissot'))).toBe(true); expect(creditAgrees('ai generated', 'cahaba productions')).toBe(false); expect(creditAgrees('todd demelle', 'todd a demelle')).toBe(true); });
});
describe('table', () => {
  it('covers the multi-printing rows and separates the T2C AB pairs by year', () => {
    expect(Object.keys(PRINTING_CUES).length).toBeGreaterThanOrEqual(1800);
    expect(cueFor('The Prince of Persia [T2C]|T2C|076-The-Prince-of-Persia-UR')?.year).toBe('2025');
    expect(cueFor('The Prince of Persia [T2C AB]|T2C (AB)|076-The-Prince-of-Persia-UR-AB')?.year).toBe('2026');
    expect(normalizeCaption(cueFor('Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]|Pmo-P3|Lost-Soul-Crowds-Worker')?.caption)).toBe('special promo');
  });
  it('missing entries are neutral', () => { expect(cueFor('No Such Card|XX|nope')).toBeUndefined(); expect(normalizeCredit(undefined)).toBe(''); expect(creditAgrees('', 'tissot')).toBe(false); });
});
