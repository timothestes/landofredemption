/**
 * Vocabulary for the card scanner: normalization of what a model transcribes,
 * the printing predicates the matcher selects with, and the printed corner
 * code. Pure: no I/O. Card data comes only from `@/lib/cards/lookup`.
 */

import { CARDS, type CardData } from '@/lib/cards/lookup';
import abMap from '@/lib/cards/generated/abMap.json';

/** The key `collection_cards` and `card_prices` use. */
export const cardKey = (c: CardData): string => `${c.name}|${c.set}|${c.imgFile}`;

/** Lowercase, apostrophes removed, every other non-alphanumeric run one space. */
export function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[‘’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const BOOK_NUMBER: Record<string, string> = {
  i: '1', ii: '2', iii: '3', '1st': '1', '2nd': '2', '3rd': '3', first: '1', second: '2', third: '3',
};

export function normalizeRef(s: string | null | undefined): string {
  if (!s) return '';
  let r = s.toLowerCase().replace(/[–—]/g, '-').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  r = r.replace(/^(iii|ii|i|1st|2nd|3rd|first|second|third) /, (_m, g: string) => BOOK_NUMBER[g] + ' ');
  r = r.replace(/^psalms /, 'psalm ').replace(/^song of songs/, 'song of solomon').replace(/^revelations /, 'revelation ');
  return r.replace(/[^a-z0-9:,-]/g, '');
}

/** Every reference a card carries: "James 4:6 (Proverbs 3:34)" is two. */
export function refsOf(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\s*[/;()]\s*/)
    .map(part => normalizeRef(part.replace(/\b(good|evil)\b/gi, '')))
    .filter(r => /\d/.test(r));
}

/** An ability line without its leading GE:/EE:/STAR:/Gospel: marker. */
export function normalizeAbility(s: string | null | undefined): string {
  return normalizeTitle((s ?? '').replace(/^\s*(ge|ee|star|gospel)\s*:\s*/i, ''));
}

const PROMO_RARITIES = new Set(['Promo', 'National', 'Seasonal', 'Regional', 'State', 'Local', 'District', 'Winner', 'National, Winner']);

export const isPromo = (c: CardData): boolean =>
  /^Pmo/.test(c.set) || /^Promo/.test(c.officialSet) || PROMO_RARITIES.has(c.rarity);
export const isAB = (c: CardData): boolean => /\(AB\)$/.test(c.set);
export const isLegacyRare = (c: CardData): boolean => c.rarity === 'Legacy Rare';
export const isUrPlus = (c: CardData): boolean => /-UR\+$|-UR-Plus$/.test(c.imgFile);
export const isLostSoul = (c: CardData): boolean => c.type.toLowerCase().includes('lost soul');

/** The code printed on the card, from the file name alone. */
function ownCornerCode(c: CardData): string | null {
  const f = c.imgFile;
  const ii = /^(\d+)_/.exec(f);
  if (ii) return String(Number(ii[1]));
  const deck = /^([KL]\d+)-/.exec(f);
  if (deck) return deck[1];
  const n = /^(?:LR|N)?(\d+)-/.exec(f.replace(/^(?:[A-Za-z]+_)+/, ''));
  return n ? String(Number(n[1])) : null;
}

// An original with no number of its own borrows its AB twin's. abMap is
// "AB name|set" -> "original name|set".
const BORROWED_CODE: Map<string, string> = (() => {
  const byNameSet = new Map<string, CardData>();
  for (const c of CARDS) byNameSet.set(`${c.name}|${c.set}`, c);
  const borrowed = new Map<string, string>();
  for (const [abKey, origKey] of Object.entries(abMap as Record<string, string>)) {
    const ab = byNameSet.get(abKey);
    const orig = byNameSet.get(origKey);
    if (!ab || !orig || ownCornerCode(orig)) continue;
    const code = ownCornerCode(ab);
    if (code) borrowed.set(origKey, code);
  }
  return borrowed;
})();

export function cornerCode(c: CardData): string | null {
  return ownCornerCode(c) ?? BORROWED_CODE.get(`${c.name}|${c.set}`) ?? null;
}

export function editionLetter(c: CardData): 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | null {
  const m = /_\(([A-H])\)$/.exec(c.imgFile);
  return m ? (m[1] as 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H') : null;
}

/** The quoted word in the identifier or name, e.g. the Nickname in `"Old Man"`. */
export function nicknameOf(c: CardData): string {
  const m = /["“”]([^"“”]+)["“”]/.exec(c.identifier || '') ?? /["“”]([^"“”]+)["“”]/.exec(c.name || '');
  return m ? normalizeTitle(m[1]) : '';
}

export function typeAgrees(read: string | null, c: CardData): boolean {
  if (!read || read === 'unknown') return false;
  const t = c.type.toLowerCase();
  const d = read.toLowerCase();
  if (d === 'enhancement') return /\b(ge|ee)\b/.test(t);
  if (d === 'token') return /token/.test(t);
  return t.includes(d);
}

export function brigadeAgrees(read: string | null, c: CardData): boolean {
  if (!read || !c.brigade) return false;
  const words = new Set(read.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  return c.brigade.toLowerCase().split(/[^a-z]+/).filter(Boolean).some(t => words.has(t));
}

/** Normalized stems that are one card spelled two ways; the matcher unions them. */
export const SPELLING_VARIANT_STEMS: [string, string][] = [
  ['wizard', 'wizards'],
  ['elisabeth', 'elizabeth'],
  ['judgements', 'judgments'],
];

/** The corner code as transcribed: a K/L deck code, else the print number's first digit run without padding ("81/200" gives 81). */
export function readCornerCode(printNumber: string | null, rarityCode: string | null): string | null {
  const kl = /\b([KL])\s?(\d{1,3})\b/.exec(`${printNumber ?? ''} ${rarityCode ?? ''}`);
  if (kl) return kl[1] + Number(kl[2]);
  const digits = /\d+/.exec(printNumber ?? '')?.[0] ?? '';
  const n = digits ? String(Number(digits)) : null;
  return n && n !== '0' ? n : null;
}

// ---------------------------------------------------------------------------
// Stats

/** The values in one stat field: "7" is one; a dual card's "4 (0)", "3(10)" or "4/11" are two. */
const statTokens = (v: string | null | undefined): string[] => (v ?? '').split(/[\s/()]+/).filter(Boolean);

/**
 * The printed strength/toughness pairs, in order. A plain card has one. A card printing two stat lines stores both in each
 * field, so it has two: `4 (0)` / `0 (4)` on a GE/EE, `3(10)` / `2(10)` on a two-sided Hero, `4/11` / `3/10` slash-joined.
 * 264 of 5,693 printings use a dual or non-numeric form.
 */
export function statPairs(strength: string | null | undefined, toughness: string | null | undefined): [string, string][] {
  const s = statTokens(strength), t = statTokens(toughness);
  return Array.from({ length: Math.min(s.length, t.length) }, (_, i): [string, string] => [s[i], t[i]]);
}

/** The read's stats equal one of the card's printed pairs: the model reads one pair from the top-left box, and a dual card has two. */
export function statsAgree(read: { strength: string | null; toughness: string | null }, c: CardData): boolean {
  const have = statPairs(c.strength, c.toughness);
  return statPairs(read.strength, read.toughness).some(([s, t]) => have.some(([cs, ct]) => cs === s && ct === t));
}
