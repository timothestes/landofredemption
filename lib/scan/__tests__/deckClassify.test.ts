import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { matchDetection } from '../match';
import { getScanIndex } from '../stemIndex';
import { cardKey, isAB } from '../vocab';
import { classifyDeckRead, deckPrinting, deckReadToDetection } from '../deckClassify';
import type { DeckRead } from '../deckSchema';

const read = (p: Partial<DeckRead>): DeckRead => ({ title: null, strength: null, toughness: null, type: 'unknown', brigade: null, reference: null, group: 1, position: 1, titleBox: null, confidence: 'high', ...p });
const classify = (r: DeckRead) => classifyDeckRead(r, matchDetection(deckReadToDetection(r), {}));
const legalityOf = (key: string | null) => CARDS.find(x => cardKey(x) === key)!.legality;
const FALLING_AWAY = 'falling away|dominant||evil|#Falling Away (Promo 2018)';

describe('deckReadToDetection', () => {
  it('copies the read fields, nulls the rest and maps the grid', () => {
    const d = deckReadToDetection(read({ title: 'X', strength: '7', toughness: '5', type: 'Hero', brigade: 'Teal', reference: 'John 3:16', group: 2, position: 4, confidence: 'low' }));
    expect(d).toMatchObject({ title: 'X', strength: '7', toughness: '5', type: 'Hero', brigade: 'Teal', reference: 'John 3:16', nickname: null, abilityStart: null, printNumber: null, grid: { row: 4, col: 2 }, orientation: 'upright', confidence: 'low' });
  });
});

describe('classifyDeckRead', () => {
  it('a title-only read of a unique card is matched to a Rotation printing', () => { const c = classify(read({ title: 'Captive Priest' })); expect(c.kind).toBe('matched'); expect(legalityOf(c.key)).toBe('Rotation'); });
  it('null title is unread', () => { const c = classify(read({ title: null })); expect(c.kind).toBe('unread'); expect(c.key).toBeNull(); });
  it('a fanned Lost Soul is a placeholder', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul' })).kind).toBe('lost_soul'));
  it('a Lost Soul with an unmatched reference is a placeholder', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul', reference: 'Obadiah 9:99' })).kind).toBe('lost_soul'));
  it('a Lost Soul with a read reference is matched', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul', reference: 'Ezekiel 34:12' })).kind).toBe('matched'));
  it('Forest Fire by title alone is which-card with FooF and Roots', () => {
    const c = classify(read({ title: 'Forest Fire', brigade: 'Green/Crimson', type: 'Enhancement' }));
    expect(c.kind).toBe('which');
    const names = c.identityCandidates!.flatMap(k => getScanIndex().identities.get(k)!.cards.map(x => x.name));
    expect(names).toEqual(expect.arrayContaining(['Forest Fire (FooF)', 'Forest Fire (Roots)']));
    expect(c.key).not.toBeNull();
  });
  it('which-card provisional is the only Rotation-legal identity', () => {
    const c = classify(read({ title: 'Forest Fire', brigade: 'Green/Crimson', type: 'Enhancement' }));
    expect(c.identityCandidates!.length).toBe(2);
    expect(CARDS.find(x => cardKey(x) === c.key)!.name).toBe('Forest Fire (Roots)');
    expect(legalityOf(c.key)).toBe('Rotation');
  });
  it('Amariah read as Clay is the Roots card', () => { const c = classify(read({ title: 'Amariah, the High Priest', brigade: 'Clay', type: 'Hero' })); expect(c.kind).toBe('matched'); expect(c.key).toMatch(/^Amariah, the High Priest \(Roots\)\|/); });
  it('a low-confidence fuzzy hit is read_as; a sharp one stays matched', () => {
    expect(classify(read({ title: 'Captive Preist', confidence: 'low' })).kind).toBe('read_as');
    expect(classify(read({ title: 'Captive Preist', confidence: 'high' })).kind).toBe('matched');
  });
  it("another game's card is not_found", () => { const c = classify(read({ title: 'Lightning Bolt' })); expect(c.kind).toBe('not_found'); expect(c.key).toBeNull(); });
});

describe('deckPrinting', () => {
  const id = getScanIndex().identities.get(FALLING_AWAY)!;
  const ab = id.cards.find(c => isAB(c) && c.legality === 'Rotation')!;
  const plain = id.cards.find(c => !isAB(c) && c.legality === 'Rotation')!;
  it('fixture has an AB printing listed before a non-AB one', () => expect(id.cards.indexOf(ab)).toBeLessThan(id.cards.indexOf(plain)));
  it('keeps the matcher choice when it is Rotation-legal', () => expect(deckPrinting(FALLING_AWAY, cardKey(ab))).toBe(cardKey(ab)));
  it('else takes the first non-AB Rotation printing', () => expect(deckPrinting(FALLING_AWAY)).toBe(cardKey(id.cards.find(c => !isAB(c) && c.legality === 'Rotation')!)));
  it('ignores a matcher choice that is not Rotation-legal', () => {
    const other = CARDS.find(c => c.legality !== 'Rotation' && getScanIndex().identities.get(FALLING_AWAY)!.cards.every(x => cardKey(x) !== cardKey(c)))!;
    expect(deckPrinting(FALLING_AWAY, cardKey(other))).toBe(cardKey(plain));
  });
});
