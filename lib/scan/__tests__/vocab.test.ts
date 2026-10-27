import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { normalizeTitle, normalizeRef, refsOf, cornerCode, isUrPlus, isPromo, editionLetter, readCornerCode, typeAgrees } from '../vocab';
const byFile = (f: string) => CARDS.find(c => c.imgFile === f)!;

describe('normalizeTitle folds quotes', () => {
  it('curly and straight apostrophes meet', () => {
    expect(normalizeTitle('Aaron’s Staff')).toBe('aarons staff');
    expect(normalizeTitle("Aaron's  Staff ")).toBe('aarons staff');
    expect(normalizeTitle('Ram, the Exalter / Ram, the Uplifted')).toBe('ram the exalter ram the uplifted');
  });
});
describe('normalizeRef', () => {
  it('folds Roman book numbers and spacing', () => {
    expect(normalizeRef('I Kings 1:41')).toBe('1kings1:41');
    expect(normalizeRef('II Chronicles 14:2-3')).toBe('2chronicles14:2-3');
    expect(normalizeRef('Luke 15: 6')).toBe('luke15:6');
    expect(normalizeRef('Isaiah 11:10')).toBe('isaiah11:10'); // "I" inside a word is not a book number
  });
  it('splits compound references', () => {
    expect(refsOf('James 4:6 (Proverbs 3:34)')).toEqual(['james4:6', 'proverbs3:34']);
    expect(refsOf('II Chronicles 33:12/II Kings 20:21')).toEqual(['2chronicles33:12', '2kings20:21']);
  });
});
describe('cornerCode', () => {
  it.each([
    ['081-Authority-of-Christ-UR+', '81'], ['LoC_232-Abducted-Subjects', '232'], ['CoW_AB_N114-The-Murdering-Pharaoh', '114'],
    ['LR29-Astrologers', '29'], ['1_Called-to-Prophesy-R', '1'], ['K13-1P-Abandoned', 'K13'], ['K13-Abandoned', 'K13'],
    ['Aarons_Staff_(CoW)', '3'], ['Promo_Son-of-God-Christmas', null], ['Lost_Soul_Ezekiel_34_12_(A)', null],
  ])('%s → %s', (file, code) => expect(cornerCode(byFile(file))).toBe(code));
  it('counts printings with a code', () => expect(CARDS.filter(c => cornerCode(c)).length).toBe(2652));
});
describe('predicates', () => {
  it('UR+ includes the LoC UR-Plus files', () => { expect(isUrPlus(byFile('001-Chronicles-of-the-Kings-UR-Plus'))).toBe(true); expect(CARDS.filter(isUrPlus).length).toBe(12); });
  it('promo count matches Dataset numbers', () => expect(CARDS.filter(isPromo).length).toBe(248));
  it('edition letter', () => expect(editionLetter(byFile('Son_of_God_(F)'))).toBe('F'));
});
describe('readCornerCode', () => {
  it('keeps deck codes and strips zero padding', () => {
    expect(readCornerCode('081', 'UR+')).toBe('81');
    expect(readCornerCode(null, 'K10')).toBe('K10');
    expect(readCornerCode('P', null)).toBe(null);
  });
});
describe('typeAgrees', () => {
  it('maps Enhancement to GE and EE', () => { expect(typeAgrees('Enhancement', byFile('210-A-Royal-Priesthood-R'))).toBe(true); expect(typeAgrees('unknown', byFile('210-A-Royal-Priesthood-R'))).toBe(false); });
});
