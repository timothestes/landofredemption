import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { getScanIndex } from '../stemIndex';
import { cardKey } from '../vocab';
const byName = (n: string) => CARDS.find(c => c.name === n)!;
const idx = getScanIndex();
const same = (a: string, b: string) => idx.identityOf(byName(a)).key === idx.identityOf(byName(b)).key;

describe('unions', () => {
  it('AB pairs merge, including the stem-split Fourth Seal', () => { expect(same('Fourth Seal, Death (RoJ)', 'Fourth Seal (Death) (RoJ AB)')).toBe(true); expect(same('The Murdering Pharaoh', 'The Murdering Pharaoh (CoW AB)')).toBe(true); });
  it('vanilla Lost Souls on one verse merge across name decorations', () => expect(same('Lost Soul (Proverbs 21:16) (LoC)', 'Lost Soul Proverbs 21:16 (I)')).toBe(true));
  it('a reprint with a different ability stays its own card', () => { expect(same("Josiah's Covenant", 'Josiah’s Covenant (LoC)')).toBe(false); expect(same('Thievery of Judas', 'Thievery of Judas (GoC)')).toBe(false); });
  it('a nicknamed Lost Soul never merges with the plain one', () => expect(same('Lost Soul  Ezekiel 34:12', 'Lost Soul "Lost Boy" [Ezekiel 34:12 - PoC]')).toBe(false));
  it('counts', () => { expect(idx.stats.identities).toBeLessThanOrEqual(4705); expect(idx.stats.unions).toBeGreaterThanOrEqual(78); });
});
describe('stem index', () => {
  it('indexes both halves of a dual name', () => { expect(idx.byStem.get('ram the exalter')).toBeTruthy(); expect(idx.byStem.get('whirlwind')).toBeTruthy(); });
  it('Lost Souls are reachable by every component reference', () => { expect(idx.lostSoulByRef.get('james4:6')?.length).toBeGreaterThan(0); expect(idx.lostSoulByRef.get('proverbs3:34')?.length).toBeGreaterThan(0); });
  it('abTwinKey is symmetric', () => { const o = byName('Aaron\'s Staff (CoW)'), a = byName('Aaron\'s Staff (CoW AB)'); expect(idx.abTwinKey(cardKey(o))).toBe(cardKey(a)); expect(idx.abTwinKey(cardKey(a))).toBe(cardKey(o)); });
});
