/**
 * The scanner's matcher: one transcribed card (ScanDetection) to an identity,
 * then to one printing, through ordered filters and a price collapse.
 * Pure: no I/O. Prices are passed in; an unpriced printing is absent.
 */

import type { CardData } from '@/lib/cards/lookup';
import type { ScanDetection } from './schema';
import { getScanIndex, type ScanIdentity } from './stemIndex';
import { cueFor as tableCueFor, creditAgrees, normalizeCaption, normalizeCredit, type PrintingCue } from './cues';
import {
  brigadeAgrees, cardKey, cornerCode, editionLetter, isAB, isLegacyRare, isPromo, isUrPlus,
  nicknameOf, normalizeAbility, normalizeTitle, readCornerCode, refsOf, statsAgree, typeAgrees,
} from './vocab';

export type PriceMap = Record<string, number>;

export interface Candidate {
  key: string;
  name: string;
  set: string;
  officialSet: string;
  imgFile: string;
  legality: string;
  price: number | null;
}

export type NameReason = 'exact' | 'fuzzy' | 'reference' | 'none';

export type PrintingReason =
  | 'only' | 'default' | 'print_number' | 'ur_plus' | 'legacy_rare' | 'reference' | 'stats'
  | 'illustrator' | 'copyright_year' | 'caption' | 'edition_letter' | 'ability_end' | 'promo_text'
  | 'frame' | 'equivalent' | 'printing_ambiguous' | 'identity_ambiguous' | 'reference_missing'
  | 'reference_ambiguous' | 'none';

export interface MatchResult {
  status: 'matched' | 'check' | 'not_found';
  nameReason: NameReason;
  printingReason: PrintingReason;
  identityKey?: string;
  stem?: string;
  chosen?: Candidate;
  candidates: Candidate[];
  /** Set when the filters left exactly a card and its AB twin: the frame comparison (abCompare.ts) may settle it. */
  abPair?: { original: Candidate; ab: Candidate };
  identityCandidates?: string[];
  scores: { matchScore: number; runnerUpScore: number; agreeingFields: string[] };
  fuzzyFrom?: string;
  /** Up to 5 nearest stems (normalized, OSA distance ratio, ascending); set when the fuzzy search ran, absent on exact hits. */
  near?: { stem: string; d: number }[];
  note?: string;
}

export const PRICE_DELTA_FLOOR = 2.0;

const FUZZY_MAX = 0.2;
const FUZZY_SHORT_TITLE = 8;

type Selection = Pick<MatchResult, 'status' | 'printingReason' | 'chosen' | 'candidates' | 'abPair'>;

/** Per-printing cue lookup; the generated table unless a test injects one. */
export type CueLookup = (cardKey: string) => PrintingCue | undefined;

const candidate = (c: CardData, prices: PriceMap): Candidate => {
  const key = cardKey(c);
  return { key, name: c.name, set: c.set, officialSet: c.officialSet, imgFile: c.imgFile, legality: c.legality, price: prices[key] ?? null };
};

// ---------------------------------------------------------------------------
// Identity scoring

interface Scored { id: ScanIdentity; score: number; fields: string[] }

function scoreIdentity(id: ScanIdentity, det: ScanDetection): Scored {
  let score = 0;
  const fields: string[] = [];
  const add = (n: number, f: string) => { score += n; fields.push(f); };

  if (refsOf(det.reference).some(r => id.refs.has(r))) add(8, 'reference');
  if (id.cards.some(c => statsAgree(det, c))) add(4, 'stats');
  const code = readCornerCode(det.printNumber, det.rarityCode);
  if (code && id.cards.some(c => cornerCode(c) === code)) add(3, 'print_number');

  const ident = normalizeTitle(det.identifier);
  if (ident) {
    if (id.cards.some(c => normalizeTitle(c.identifier) === ident)) add(2, 'identifier');
    else if (id.cards.some(c => { const ci = normalizeTitle(c.identifier); return !!ci && (ci.includes(ident) || ident.includes(ci)); })) add(1, 'identifier~');
  }
  if (id.cards.some(c => brigadeAgrees(det.brigade, c))) add(1, 'brigade');

  const words = normalizeAbility(det.abilityStart).split(' ').filter(Boolean);
  const six = words.slice(0, 6).join(' '), four = words.slice(0, 4).join(' ');
  if (words.length >= 6 && id.cards.some(c => normalizeAbility(c.specialAbility).includes(six))) add(0.75, 'ability6');
  else if (words.length >= 3 && id.cards.some(c => normalizeAbility(c.specialAbility).includes(four))) add(0.5, 'ability');
  else if (!words.length && id.cards.every(c => !normalizeAbility(c.specialAbility))) add(0.5, 'vanilla');

  if (id.cards.some(c => typeAgrees(det.type, c))) add(0.25, 'type');

  if (id.lostSoul) {
    const read = normalizeTitle(det.nickname), own = nicknameOf(id.cards[0]);
    if (read && own === read) add(2, 'nickname');
    else if (read && own) add(-2, 'nickname!');
    else if (!read && !own) add(0.5, 'no_nickname');
    if (/token/i.test(det.title ?? '') !== id.token) add(-3, 'token!');
  }
  return { id, score, fields };
}

const rank = (ids: ScanIdentity[], det: ScanDetection) => ids.map(i => scoreIdentity(i, det)).sort((a, b) => b.score - a.score);

// ---------------------------------------------------------------------------
// Printing filters. Each returns the survivors it supports (or the input
// unchanged) and, when exactly one remains by its own decision, that reason.

/** `provisional`: Check this with that card as the provisional choice; `ambiguous`: Check this among `cards`, cheapest priced provisional. */
interface Step { cards: CardData[]; decided?: PrintingReason; provisional?: CardData; ambiguous?: boolean }

/**
 * Keep the cards a cue agrees with plus the cards with no cue entry (neutral);
 * drop only known disagreement. Nothing agreeing leaves the input; one survivor decides.
 */
function keepAgreeing(cards: CardData[], agrees: (c: CardData) => boolean, unknown: (c: CardData) => boolean, reason: PrintingReason): Step {
  if (!cards.some(agrees)) return { cards };
  const kept = cards.filter(c => agrees(c) || unknown(c));
  return kept.length === 1 ? { cards: kept, decided: reason } : { cards: kept };
}

/** True when every dropped card is the AB twin of a kept one: the filter would only split one card from its twin. */
function onlySplitsAbTwins(kept: CardData[], dropped: CardData[]): boolean {
  const { abTwinKey } = getScanIndex();
  const keptKeys = new Set(kept.map(cardKey));
  return dropped.length > 0 && dropped.every(d => { const t = abTwinKey(cardKey(d)); return !!t && keptKeys.has(t); });
}

/** Keep `hits` when they are a non-empty strict subset; one survivor decides with `reason`. */
function narrow(cards: CardData[], hits: CardData[], reason: PrintingReason): Step {
  if (!hits.length || hits.length >= cards.length) return { cards };
  return hits.length === 1 ? { cards: hits, decided: reason } : { cards: hits };
}

function filterUrPlus(cards: CardData[], det: ScanDetection): Step {
  if (!/UR\+/.test(det.rarityCode ?? '')) return { cards };
  const hits = cards.filter(isUrPlus);
  if (hits.length === 1) return { cards: hits, decided: 'ur_plus' };
  return hits.length > 1 ? { cards: hits } : { cards };
}

function filterLegacyRare(cards: CardData[], det: ScanDetection): Step {
  if (!/^LR$/i.test((det.rarityCode ?? '').trim())) return { cards };
  const code = readCornerCode(det.printNumber, det.rarityCode);
  let hits = cards.filter(isLegacyRare);
  if (code && hits.some(c => cornerCode(c) === code)) hits = hits.filter(c => cornerCode(c) === code);
  if (hits.length === 1) return { cards: hits, decided: 'legacy_rare' };
  return hits.length > 1 ? { cards: hits } : { cards };
}

/** The corner code. A code shared by a card and its AB twin keeps both. */
function filterCornerCode(cards: CardData[], det: ScanDetection): Step {
  const code = readCornerCode(det.printNumber, det.rarityCode);
  if (!code) return { cards };
  const hits = cards.filter(c => cornerCode(c) === code);
  if (hits.length === 1) return { cards: hits, decided: 'print_number' };
  return hits.length > 1 ? { cards: hits } : { cards };
}

function filterReference(cards: CardData[], det: ScanDetection): Step {
  const read = refsOf(det.reference);
  if (!read.length) return { cards };
  const hits = cards.filter(c => refsOf(c.reference).some(r => read.includes(r)));
  if (onlySplitsAbTwins(hits, cards.filter(c => !hits.includes(c)))) return { cards };
  return narrow(cards, hits, 'reference');
}

function filterStats(cards: CardData[], det: ScanDetection): Step {
  if (!det.strength || !det.toughness || cards.length < 2) return { cards };
  return narrow(cards, cards.filter(c => statsAgree(det, c)), 'stats');
}

function filterCredit(cards: CardData[], det: ScanDetection, cueFor: CueLookup): Step {
  const read = normalizeCredit(det.illustrator);
  if (!read || cards.length < 2) return { cards };
  const credit = (c: CardData) => normalizeCredit(cueFor(cardKey(c))?.illustrator);
  if (cards.filter(credit).length < 2) return { cards };
  return keepAgreeing(cards, c => { const k = credit(c); return !!k && creditAgrees(read, k); }, c => !cueFor(cardKey(c)), 'illustrator');
}

/** A single survivor whose printed year equals the read one wins even if the others print none (a missing entry is not "none"). */
function filterYear(cards: CardData[], det: ScanDetection, cueFor: CueLookup): Step {
  const year = det.copyrightYear;
  const yearOf = (c: CardData) => cueFor(cardKey(c))?.year;
  if (!year || cards.length < 2 || !cards.some(yearOf)) return { cards };
  return keepAgreeing(cards, c => yearOf(c) === year, c => !cueFor(cardKey(c)), 'copyright_year');
}

function filterEditionLetter(cards: CardData[], det: ScanDetection): Step {
  const letter = (det.rarityCode ?? '').trim().toUpperCase();
  if (!/^[A-H]$/.test(letter) || !cards.some(editionLetter)) return { cards };
  const hits = cards.filter(c => editionLetter(c) === letter);
  if (hits.length === 1) return { cards: hits, decided: 'edition_letter' };
  return hits.length > 1 ? { cards: hits } : { cards };
}

function filterAbilityTail(cards: CardData[], det: ScanDetection): Step {
  const tail = normalizeAbility(det.abilityEnd).split(' ').filter(Boolean).slice(-3).join(' ');
  if (tail.split(' ').length < 2) return { cards };
  const hits = cards.filter(c => normalizeAbility(c.specialAbility).endsWith(tail));
  if (onlySplitsAbTwins(hits, cards.filter(c => !hits.includes(c)))) return { cards };
  return narrow(cards, hits, 'ability_end');
}

const PROMO_WORDS = /promo|^p$|national|regional|state|seasonal|winner|tournament|district|local|gift set|place/i;
const EVENT_WORDS = ['national', 'state', 'regional', 'local', 'district', 'seasonal', 'gift set', 'participant', 'worker', 'fundraiser', 'winner'];
const PRINTED_EVENT_WORDS = ['local', 'seasonal', 'state', 'regional', 'district', 'winner', 'gift set'];

const placementIn = (t: string) => (/\b(1st|first)\b/.test(t) ? '1st' : /\b(2nd|second)\b/.test(t) ? '2nd' : /\b(3rd|third)\b/.test(t) ? '3rd' : null);
const yearIn = (t: string) => /\b(20\d\d)\b/.exec(t)?.[1] ?? null;

/** Among several promos, a printed caption agreeing with exactly one decides (a promo with no cue entry keeps it open). */
function byCaption(promos: CardData[], read: string, cueFor: CueLookup): Step {
  const caption = (c: CardData) => normalizeCaption(cueFor(cardKey(c))?.caption);
  const readCap = normalizeCaption(read);
  if (promos.filter(caption).length < 2 || !readCap) return { cards: promos };
  return keepAgreeing(promos, c => { const cap = caption(c); return cap.length >= 3 && (readCap === cap || readCap.includes(cap) || cap.includes(readCap)); }, c => !cueFor(cardKey(c)), 'caption');
}

function promoScore(c: CardData, t: string): number {
  const h = `${c.name} ${c.rarity} ${c.officialSet}`.toLowerCase();
  const name = c.name.toLowerCase();
  const place = placementIn(t), year = yearIn(t);
  let sc = 0;
  if (place) sc += h.includes(`${place} place`) ? 3 : /\b(1st|2nd|3rd) place\b/.test(h) ? -3 : 0;
  if (year) sc += h.includes(year) ? 2 : /\b20\d\d\b/.test(h) ? -2 : 0;
  for (const w of EVENT_WORDS) if (t.includes(w) && h.includes(w === 'national' ? 'nat' : w)) sc += 1;
  for (const w of PRINTED_EVENT_WORDS) if (name.includes(w) && !t.includes(w)) sc -= 1;
  if (/special promo/.test(t) && /worker/.test(h)) sc += 1;
  return sc;
}

/** A strict top wins; a tie at a positive top keeps the tied top; otherwise every promo stays. */
function byPromoScore(promos: CardData[], t: string): CardData[] {
  const scored = promos.map(c => ({ c, sc: promoScore(c, t) })).sort((a, b) => b.sc - a.sc);
  if (scored[0].sc > scored[1].sc) return [scored[0].c];
  return scored[0].sc > 0 ? scored.filter(x => x.sc === scored[0].sc).map(x => x.c) : promos;
}

/** A placement or year in the text that contradicts the only promo printing's name. */
function contradicts(promo: CardData, t: string): boolean {
  const h = promo.name.toLowerCase();
  const place = placementIn(t);
  const year = yearIn(t);
  return !!(place && /\b(1st|2nd|3rd) place\b/.test(h) && !h.includes(`${place} place`))
    || !!(year && /\b20\d\d\b/.test(h) && !h.includes(year));
}

function filterPromoText(cards: CardData[], det: ScanDetection, cueFor: CueLookup): Step {
  const read = [det.promoText, det.rarityCode].filter(Boolean).join(' ');
  if (!read || !PROMO_WORDS.test(read)) return { cards };
  let promos = cards.filter(isPromo);
  if (!promos.length) return { cards };
  const t = read.toLowerCase();
  // Caption and scoring need printed promo text; a bare "P" in the corner only keeps the promos.
  if (det.promoText && promos.length > 1) {
    const cap = byCaption(promos, read, cueFor);
    if (cap.decided) return cap;
    promos = byPromoScore(cap.cards, t);
    // A read placement or year that still leaves several promos is the picker's call, never a price collapse.
    if (promos.length > 1 && (placementIn(t) || yearIn(t))) return { cards: promos, ambiguous: true };
  }
  if (promos.length === 1) {
    if (contradicts(promos[0], t)) return { cards, decided: 'printing_ambiguous', provisional: promos[0] };
    return { cards: promos, decided: 'promo_text' };
  }
  return { cards: promos };
}

const FILTERS: ((cards: CardData[], det: ScanDetection, cueFor: CueLookup) => Step)[] = [
  filterUrPlus,
  filterLegacyRare,
  filterCornerCode,
  filterReference,
  filterStats,
  filterCredit,
  filterYear,
  filterEditionLetter,
  filterAbilityTail,
  filterPromoText,
];

const isSpecial = (c: CardData) => isPromo(c) || isAB(c) || isLegacyRare(c) || isUrPlus(c);

/** The cheapest priced survivor, else one with a corner code, else the first. */
function defaultOf(cards: CardData[], survivors: Candidate[]): Candidate {
  return survivors.filter(x => x.price != null).sort((a, b) => (a.price as number) - (b.price as number))[0]
    ?? survivors.find((_, i) => cornerCode(cards[i]))
    ?? survivors[0];
}

/** A card and its AB twin, and nothing else. */
function abPairOf(cards: CardData[], prices: PriceMap): MatchResult['abPair'] {
  if (cards.length !== 2) return undefined;
  const [x, y] = cards;
  if (getScanIndex().abTwinKey(cardKey(x)) !== cardKey(y) || isAB(x) === isAB(y)) return undefined;
  const [original, ab] = isAB(x) ? [y, x] : [x, y];
  return { original: candidate(original, prices), ab: candidate(ab, prices) };
}

function collapse(cards: CardData[], all: Candidate[], prices: PriceMap): Selection {
  const abPair = abPairOf(cards, prices);
  return abPair ? { ...collapseRules(cards, all, prices), abPair } : collapseRules(cards, all, prices);
}

function collapseRules(cards: CardData[], all: Candidate[], prices: PriceMap): Selection {
  let removed = false;
  if (!cards.every(isPromo)) {
    const standard = cards.filter(c => !isSpecial(c));
    if (standard.length && standard.length < cards.length) { removed = true; cards = standard; }
  }
  // Dropping non-Rotation printings is a removal too: a lone survivor is the default, one tap from the rest.
  const rotation = cards.filter(c => c.legality === 'Rotation');
  if (rotation.length && rotation.length < cards.length) { removed = true; cards = rotation; }

  const survivors = cards.map(c => candidate(c, prices));
  if (cards.length === 1) return { status: 'matched', printingReason: removed ? 'default' : 'only', chosen: survivors[0], candidates: all };

  const ps = survivors.filter(x => x.price != null).map(x => x.price as number);
  const span = ps.length ? Math.max(...ps) - Math.min(...ps) : 0;
  const legalities = new Set(cards.map(c => c.legality));
  const chosen = defaultOf(cards, survivors);
  if (span < PRICE_DELTA_FLOOR && legalities.size === 1) return { status: 'matched', printingReason: 'equivalent', chosen, candidates: all };
  return { status: 'check', printingReason: 'printing_ambiguous', chosen, candidates: survivors };
}

export function selectPrinting(identity: ScanIdentity, det: ScanDetection, prices: PriceMap, opts: { cueFor?: CueLookup } = {}): Selection {
  const cueFor = opts.cueFor ?? tableCueFor;
  const all = identity.cards.map(c => candidate(c, prices));
  let cards = identity.cards;
  for (const filter of FILTERS) {
    const step = filter(cards, det, cueFor);
    if (step.ambiguous) { const survivors = step.cards.map(c => candidate(c, prices)); return { status: 'check', printingReason: 'printing_ambiguous', chosen: defaultOf(step.cards, survivors), candidates: survivors }; }
    if (step.provisional) return { status: 'check', printingReason: 'printing_ambiguous', chosen: candidate(step.provisional, prices), candidates: step.cards.map(c => candidate(c, prices)) };
    if (step.decided) return { status: 'matched', printingReason: step.decided, chosen: candidate(step.cards[0], prices), candidates: all };
    cards = step.cards;
  }
  return collapse(cards, all, prices);
}

// ---------------------------------------------------------------------------
// Stem lookup

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
function osa(a: string, b: string): number {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => { const row = new Array<number>(m + 1).fill(0); row[0] = i; return row; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}

const numeralTokens = (s: string) => s.split(' ').filter(t => /^\d+$|^[ivx]+$/.test(t)).sort().join(',');

function titleVariants(raw: string): string[] {
  const out = [normalizeTitle(raw)];
  const stripped = raw.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
  if (stripped !== raw) out.push(normalizeTitle(stripped));
  if (raw.includes('/')) for (const half of raw.split('/')) out.push(normalizeTitle(half));
  return [...new Set(out.filter(Boolean))];
}

type StemHit = { ids: ScanIdentity[]; nameReason: 'exact' | 'fuzzy'; fuzzyFrom?: string; near?: { stem: string; d: number }[] } | { note: string; near: { stem: string; d: number }[] };

function lookupStem(rawTitle: string, title: string, det: ScanDetection): StemHit {
  const { byStem, stems } = getScanIndex();
  for (const v of titleVariants(rawTitle)) { const ids = byStem.get(v); if (ids) return { ids, nameReason: 'exact' }; }

  const near: { s: string; d: number }[] = [];
  for (const s of stems) {
    const len = Math.max(title.length, s.length);
    if (Math.abs(title.length - s.length) / len > FUZZY_MAX) continue;
    const d = osa(title, s) / len;
    if (d <= FUZZY_MAX) near.push({ s, d });
  }
  near.sort((a, b) => a.d - b.d);
  const nearest = near.slice(0, 5).map(x => ({ stem: x.s, d: x.d }));
  const read = refsOf(det.reference);
  const ok = near.filter(x => numeralTokens(x.s) === numeralTokens(title)
    && (title.length >= FUZZY_SHORT_TITLE || read.some(r => byStem.get(x.s)!.some(id => id.refs.has(r)))));
  if (ok.length && !(ok.length > 1 && ok[1].d === ok[0].d)) return { ids: byStem.get(ok[0].s)!, nameReason: 'fuzzy', fuzzyFrom: ok[0].s, near: nearest };
  return {
    near: nearest,
    note: ok.length ? `fuzzy tie: ${ok.slice(0, 3).map(x => x.s).join(' / ')}`
      : near.length ? `fuzzy rejected: ${near.slice(0, 3).map(x => `${x.s}@${x.d.toFixed(2)}`).join(' / ')}`
      : 'no stem',
  };
}

// ---------------------------------------------------------------------------
// The matcher

const NO_SCORES = { matchScore: 0, runnerUpScore: 0, agreeingFields: [] as string[] };
const notFound = (note: string, near?: { stem: string; d: number }[]): MatchResult => ({ status: 'not_found', nameReason: 'none', printingReason: 'none', candidates: [], scores: NO_SCORES, note, ...(near && { near }) });
const scoresOf = (ranked: Scored[]) => ({ matchScore: ranked[0].score, runnerUpScore: ranked[1]?.score ?? 0, agreeingFields: ranked[0].fields });
const cardsOf = (ranked: Scored[], prices: PriceMap) => ranked.flatMap(x => x.id.cards.map(c => candidate(c, prices)));

function matchLostSoul(title: string, det: ScanDetection, prices: PriceMap): MatchResult | null {
  const read = refsOf(det.reference);
  if (!read.length) return { status: 'check', nameReason: 'reference', printingReason: 'reference_missing', candidates: [], scores: NO_SCORES, note: 'lost soul without reference' };
  const { lostSoulByRef } = getScanIndex();
  const ids = [...new Set(read.flatMap(r => lostSoulByRef.get(r) ?? []))];
  if (!ids.length) return /^lost souls?$/.test(title) ? notFound(`lost soul reference ${det.reference} matches nothing`) : null;
  const ranked = rank(ids, det);
  if (ranked.length === 1 || ranked[0].score > ranked[1].score) {
    const id = ranked[0].id;
    return { ...selectPrinting(id, det, prices), nameReason: 'reference', identityKey: id.key, stem: id.stem, scores: scoresOf(ranked) };
  }
  const tied = ranked.filter(x => x.score === ranked[0].score);
  return { status: 'check', nameReason: 'reference', printingReason: 'reference_ambiguous', identityCandidates: tied.map(x => x.id.key), candidates: cardsOf(tied, prices), scores: scoresOf(ranked) };
}

export function matchDetection(det: ScanDetection, prices: PriceMap): MatchResult {
  const title = normalizeTitle(det.title);
  if (!title) return notFound('no title');

  if (title.startsWith('lost soul') || det.type === 'Lost Soul') {
    const ls = matchLostSoul(title, det, prices);
    if (ls) return ls;
  }

  const hit = lookupStem(det.title!, title, det);
  if ('note' in hit) return notFound(hit.note, hit.near);
  const { ids, nameReason, fuzzyFrom, near } = hit;

  const ranked = rank(ids, det);
  const scores = scoresOf(ranked);
  let id: ScanIdentity;
  if (ranked.length === 1) id = ranked[0].id;
  else {
    const stem = ids[0].stem;
    const strongAbility = ranked.filter(x => x.fields.includes('ability6'));
    const winner = ranked[0];
    if (winner.score > ranked[1].score) {
      if (winner.fields.includes('reference') && !winner.fields.includes('ability6') && strongAbility.length) {
        const both = [winner, ...strongAbility];
        return { status: 'check', nameReason, printingReason: 'identity_ambiguous', stem, identityCandidates: both.map(x => x.id.key), candidates: cardsOf(both, prices), scores, fuzzyFrom, near, note: 'reference and ability text disagree' };
      }
      id = winner.id;
    } else {
      const tied = ranked.filter(x => x.score === winner.score);
      return { status: 'check', nameReason, printingReason: 'identity_ambiguous', stem, identityCandidates: tied.map(x => x.id.key), candidates: cardsOf(tied, prices), scores, fuzzyFrom, near };
    }
  }
  return { ...selectPrinting(id, det, prices), nameReason, identityKey: id.key, stem: id.stem, scores, fuzzyFrom, near };
}
