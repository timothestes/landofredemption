import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { matchDetection, selectPrinting, PRICE_DELTA_FLOOR } from '../match';
import { getScanIndex } from '../stemIndex';
import { cardKey } from '../vocab';
import type { ScanDetection } from '../schema';
const det = (p: Partial<ScanDetection>): ScanDetection => ({ title: null, reference: null, nickname: null, abilityStart: null, abilityEnd: null, type: 'unknown', brigade: null, strength: null, toughness: null, identifier: null, printNumber: null, rarityCode: null, promoText: null, illustrator: null, copyrightYear: null, grid: { row: 1, col: 1 }, orientation: 'upright', confidence: 'high', ...p });
const byName = (n: string) => CARDS.find(c => c.name === n)!;
const priced = (pairs: [string, number][]): Record<string, number> => Object.fromEntries(pairs.map(([n, p]) => [cardKey(byName(n)), p]));
const NO = {};

describe('names', () => {
  it('exact stem with one identity matches', () => { const m = matchDetection(det({ title: 'Captive Priest', reference: 'Judges 18:27', printNumber: '98' }), NO); expect(m.status).toBe('matched'); expect(m.chosen?.name).toBe('Captive Priest'); expect(m.printingReason).toBe('print_number'); });
  it('other-game titles are not found', () => { for (const t of ['Lightning Bolt', 'Pikachu', 'Dark Magician']) expect(matchDetection(det({ title: t }), NO).status).toBe('not_found'); });
  it('null title does not throw and is not found', () => expect(matchDetection(det({ title: null, reference: 'John 3:16' }), NO).status).toBe('not_found'));
  it('trailing parenthetical and dual-name halves resolve', () => { expect(matchDetection(det({ title: 'Shadrach (Hananiah)', reference: 'Daniel 3:12' }), NO).status).not.toBe('not_found'); expect(matchDetection(det({ title: 'Ram, the Exalter', reference: 'I Chronicles 2:9' }), NO).status).not.toBe('not_found'); });
  it('fuzzy respects the short-name and numeral guards', () => { expect(matchDetection(det({ title: 'Herod Agrippa I', reference: 'Acts 12:1' }), NO).chosen?.name).toMatch(/Agrippa I\b/); expect(matchDetection(det({ title: 'Cage' }), NO).nameReason).not.toBe('fuzzy'); });
});
describe('identity', () => {
  it('Son of God printings resolve by verse', () => { const m = matchDetection(det({ title: 'Son of God', reference: 'Revelation 3:12', type: 'Dominant' }), NO); expect(m.chosen?.name).toBe('Son of God (2019) (Promo)'); expect(m.printingReason).toBe('reference'); });
  it('reprints with changed text split on the corner code', () => { const m = matchDetection(det({ title: "Josiah's Covenant", reference: 'II Kings 23:3', printNumber: '12', abilityStart: 'Discard an evil card. Cannot be negated' }), NO); expect(m.status).toBe('matched'); expect(m.chosen?.name).toBe('Josiah’s Covenant (LoC)'); });
  it('reference against six words of ability text is Check this', () => { const m = matchDetection(det({ title: 'King Asa', reference: 'II Chronicles 14:2-3', abilityStart: 'Discard High Places and Queen Maachah.', strength: '7', toughness: '5' }), NO); expect(m.status).toBe('check'); expect(m.note).toMatch(/disagree/); });
});
describe('Lost Souls', () => {
  it('plain verse beats the nicknamed twin when no nickname is read', () => expect(matchDetection(det({ title: 'Lost Soul', reference: 'Ezekiel 34:12', type: 'Lost Soul' }), NO).chosen?.name).toMatch(/^Lost Soul\s+Ezekiel 34:12/));
  it('token word must agree', () => expect(matchDetection(det({ title: 'Lost Soul Token', reference: 'John 4:35', nickname: 'Harvest', type: 'Lost Soul' }), NO).chosen?.name).toMatch(/Token/));
  it('compound verse reaches the card', () => expect(matchDetection(det({ title: 'Lost Soul', reference: 'James 4:6 (Proverbs 3:34)', nickname: 'Humble', type: 'Lost Soul' }), NO).status).toBe('matched'));
  it('no verse is reference_missing', () => expect(matchDetection(det({ title: 'Lost Soul', type: 'Lost Soul' }), NO).printingReason).toBe('reference_missing'));
});
describe('printing filters', () => {
  const pop = det({ title: 'The Prince of Persia', reference: 'Daniel 10:13', strength: '7', toughness: '8', printNumber: '76', rarityCode: 'UR' });
  it('the shared number never decides an AB pair; credit and year do', () => {
    expect(matchDetection({ ...pop, illustrator: 'Illus. © Cahaba Productions', copyrightYear: '2026' }, NO).chosen?.name).toBe('The Prince of Persia [T2C AB]');
    expect(matchDetection({ ...pop, illustrator: 'Illus. AI Generated', copyrightYear: '2025' }, NO).chosen?.name).toBe('The Prince of Persia [T2C]');
    const bare = matchDetection(pop, NO); expect(bare.chosen?.name).toBe('The Prince of Persia [T2C]'); expect(bare.printingReason).toBe('default');
  });
  it('UR+ and LR codes pick their printings, including LoC UR-Plus', () => { expect(matchDetection(det({ title: 'Doubt', reference: 'Deuteronomy 28:66', printNumber: '3', rarityCode: 'UR+' }), NO).chosen?.imgFile).toMatch(/UR-Plus$/); expect(matchDetection(det({ title: 'Mayhem', reference: 'Isaiah 59:7', rarityCode: 'LR', printNumber: '116' }), NO).chosen?.name).toBe('Mayhem (FoM)'); });
  it('caption and printed event words choose among promos', () => {
    const crowds = det({ title: 'Lost Soul', reference: 'Luke 5:15', nickname: 'Crowds', type: 'Lost Soul' });
    expect(matchDetection({ ...crowds, promoText: 'Special Promo' }, NO).chosen?.name).toMatch(/Worker/);
    expect(matchDetection({ ...crowds, promoText: 'Local Redemption Tournament Participant' }, NO).chosen?.name).toMatch(/Local/);
    expect(matchDetection({ ...crowds, promoText: 'Seasonal Promo' }, NO).chosen?.name).toMatch(/Seasonal/);
  });
  it('a placement that leaves several promos is Check this, never equivalent', () => {
    const id = getScanIndex().identityOf(byName('Son of God [2023 - 1st Place]'));
    const r = selectPrinting(id, det({ title: 'Son of God', promoText: '1st Place Winner' }), NO);
    expect(r.status).toBe('check'); expect(r.printingReason).toBe('printing_ambiguous');
    expect(r.candidates.every(c => /1st Place/.test(c.name))).toBe(true);
  });
  it('a bare P keeps the promos without scoring them', () => {
    const m = matchDetection(det({ title: 'Lost Soul', reference: 'Luke 5:15', nickname: 'Crowds', type: 'Lost Soul', rarityCode: 'P' }), NO);
    expect(m.printingReason).not.toBe('promo_text'); expect(m.printingReason).not.toBe('caption');
    expect(m.candidates.length).toBeGreaterThan(1);
  });
  it('a contradicted placement is Check this', () => { const m = matchDetection(det({ title: 'Warrior Overtaken', reference: 'II Chronicles 18:33', promoText: '2nd Place Promo' }), NO); expect(m.status).toBe('check'); });
  it('stats split old reprints', () => expect(matchDetection(det({ title: 'Christian Soldier', strength: '4', toughness: '4', reference: 'II Timothy 2:3' }), NO).chosen?.name).not.toMatch(/\( C\)/));
  it('promo text in the corner books the promo', () => {
    expect(matchDetection(det({ title: 'Root of Jesse', reference: 'Isaiah 11:10', rarityCode: 'P' }), NO).chosen?.name).toBe('Root of Jesse (Promo)');
    expect(matchDetection(det({ title: 'Root of Jesse', reference: 'Isaiah 11:10' }), NO).chosen?.name).toBe('Root of Jesse (LoC)');
  });
});
describe('collapse', () => {
  const id = getScanIndex().identityOf(byName('Son of God (1st Print - L)'));
  const sog = det({ title: 'Son of God', type: 'Dominant' });
  it('prices under the floor collapse to the cheapest, over it ask', () => {
    const cheap = priced([['Son of God (1st Print - L)', 3], ['Son of God (1st Print - K)', 3.5], ['Son of God [K]', 4.9], ['Son of God [L]', 3]]);
    const eq = selectPrinting(id, sog, cheap);
    expect(eq.status).toBe('matched'); expect(eq.printingReason).toBe('equivalent');
    expect(eq.candidates.map(c => c.key).sort()).toEqual(id.cards.map(cardKey).sort());
    const wide = { ...cheap, [cardKey(byName('Son of God [K]'))]: 3 + PRICE_DELTA_FLOOR };
    expect(selectPrinting(id, sog, wide).status).toBe('check');
  });
  it('all unpriced counts as zero span and picks a real printing', () => { const r = selectPrinting(id, sog, NO); expect(r.chosen?.price).toBeNull(); expect(r.chosen?.key).toBeTruthy(); });
});
