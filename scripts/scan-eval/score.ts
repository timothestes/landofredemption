/**
 * E0 scorer: labels.json against run.ts outputs. Identity-level multiset
 * scoring per photo, pair classes, printing level on correct pairs, a
 * per-bucket summary. Pure apart from the loaders and main().
 *
 *   npx tsx scripts/scan-eval/score.ts --labels scripts/scan-eval/labels.json \
 *     --outputs scripts/scan-eval/outputs/<arm>/ [--photos scripts/scan-eval/photos] \
 *     [--prices prices.json] [--rematch]
 *
 * --rematch ignores the route's match fields and re-runs matchDetection on
 * each `read` (E1: score a matcher change on saved outputs for free). It
 * requires --prices: a full card_prices dump as JSON Record<cardKey, number>.
 * Prices harvested from returned candidates miss unpriced and unreturned
 * printings, which would let the collapse hide a silent_wrong_price.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CARDS, type CardData } from '@/lib/cards/lookup';
import { capDetection, type ScanDetection } from '@/lib/scan/schema';
import { getScanIndex } from '@/lib/scan/stemIndex';
import { cardKey } from '@/lib/scan/vocab';
import { matchDetection, PRICE_DELTA_FLOOR, type Candidate, type MatchResult, type PriceMap } from '@/lib/scan/match';

// ---------------------------------------------------------------------------
// Types

export interface LabelCard {
  printing: string;
  setVisible: boolean;
  inFrame: 'full' | 'partial';
  grid?: { row: number; col: number };
}

export interface LabelPhoto {
  file: string;
  bucket: string;
  tags: string[];
  otherGame: boolean;
  cards: LabelCard[];
}

export type ScoredDetection = ScanDetection & { match: MatchResult };

export interface Prediction {
  file: string;
  detections: ScoredDetection[];
  error?: string;
  truncated?: boolean;
  photoQuality?: string;
  latencyMs?: number;
  costUsd?: number;
}

export const PAIR_CLASSES = [
  'matched_correct', 'matched_wrong', 'check_top1', 'check_in_candidates', 'check_miss', 'not_found_miss', 'hallucination', 'missed',
] as const;
export type PairClass = (typeof PAIR_CLASSES)[number];

export interface Pair {
  class: PairClass;
  label?: LabelCard;
  /** Index into the prediction's detections. */
  row?: number;
  /** Printing level, on correct-identity pairs only. */
  printing?: 'correct' | 'wrong' | 'defensible' | 'not_defensible';
  silentWrongPrice?: boolean;
  /** A Matched row on another printing with either price missing: the price check is blind to it. */
  wrongPrintingUnpriced?: boolean;
}

interface PrintingTally { setVisiblePairs: number; setVisibleCorrect: number; defensible: number; notDefensible: number }

export interface PhotoScore {
  file: string;
  bucket: string;
  otherGame: boolean;
  /** Set when the photo is left out of accuracy (harness rules). */
  excluded?: 'error' | 'truncated' | 'missing';
  error?: string;
  tp: number;
  fp: number;
  fn: number;
  /** Full cards labeled (the singles top-1 denominator). */
  labeledFull: number;
  byClass: Record<PairClass, number>;
  pairs: Pair[];
  /** matched_wrong rows: a Matched row naming the wrong card. */
  silentWrong: number;
  silentWrongPrice: number;
  wrongPrintingUnpriced: number;
  hardFail: boolean;
  printing: PrintingTally;
  grid: { checked: number; matched: number };
  photoQuality?: string;
  latencyMs?: number;
  costUsd?: number;
}

export interface Tally {
  photos: number;
  scored: number;
  errors: number;
  truncated: number;
  missing: number;
  tp: number;
  fp: number;
  fn: number;
  recall: number | null;
  precision: number | null;
  silentWrong: number;
  silentWrongPrice: number;
  wrongPrintingUnpriced: number;
  hardFails: number;
  noCards: number;
  byClass: Record<PairClass, number>;
  printing: PrintingTally;
  grid: { checked: number; matched: number };
  latency: { n: number; p50: number | null; p95: number | null };
  costUsd: number;
}

export interface Summary {
  buckets: Record<string, Tally>;
  pooled: Tally;
  /** Photos in buckets starting "single" with a full card labeled (`expected`), of which `photos` were scored: top-1 = every full card found and no false card. */
  singles: { photos: number; expected: number; top1: number; matchedCorrect: number };
}

// ---------------------------------------------------------------------------
// Card lookups

let byKey: Map<string, CardData> | null = null;
const cardByKey = (key: string) => (byKey ??= new Map(CARDS.map(c => [cardKey(c), c]))).get(key);
const identityOfKey = (key: string | null | undefined): string | null => {
  const c = key ? cardByKey(key) : undefined;
  return c ? getScanIndex().identityOf(c).key : null;
};

const toCandidate = (c: CardData, prices: PriceMap): Candidate => {
  const key = cardKey(c);
  return { key, name: c.name, set: c.set, officialSet: c.officialSet, imgFile: c.imgFile, legality: c.legality, price: prices[key] ?? null };
};

// ---------------------------------------------------------------------------
// Labels

const isGrid = (g: any) => !!g && typeof g === 'object' && Number.isInteger(g.row) && Number.isInteger(g.col) && g.row >= 1 && g.col >= 1;

/** Validate parsed labels.json. Extra fields are dropped; every problem is listed in one throw. */
export function loadLabelsFrom(json: unknown): LabelPhoto[] {
  if (!Array.isArray(json)) throw new Error('labels: expected a JSON array of photos');
  const problems: string[] = [];
  const unknownKeys: string[] = [];
  const unlabeled = new Map<string, number>();
  const noSetVisible = new Set<string>();
  const seen = new Set<string>();
  const out: LabelPhoto[] = [];

  json.forEach((p: any, i) => {
    const where = typeof p?.file === 'string' ? p.file : `photo #${i}`;
    if (!p || typeof p !== 'object') { problems.push(`${where}: not an object`); return; }
    if (typeof p.file !== 'string' || !p.file) problems.push(`${where}: file must be a string`);
    else if (seen.has(p.file)) problems.push(`${where}: duplicate file`);
    else seen.add(p.file);
    if (typeof p.bucket !== 'string' || !p.bucket) problems.push(`${where}: bucket must be a string`);
    if (!Array.isArray(p.tags) || p.tags.some((t: unknown) => typeof t !== 'string')) problems.push(`${where}: tags must be an array of strings`);
    if (typeof p.otherGame !== 'boolean') problems.push(`${where}: otherGame must be true or false`);
    if (!Array.isArray(p.cards)) { problems.push(`${where}: cards must be an array`); return; }

    const cards: LabelCard[] = [];
    p.cards.forEach((c: any, j: number) => {
      const at = `${where} card ${j + 1}`;
      if (!c || typeof c !== 'object') { problems.push(`${at}: not an object`); return; }
      if (c.printing == null) unlabeled.set(where, (unlabeled.get(where) ?? 0) + 1);
      else if (typeof c.printing !== 'string') problems.push(`${at}: printing must be a string`);
      else if (!cardByKey(c.printing)) unknownKeys.push(`${at}: ${c.printing}`);
      if (typeof c.setVisible !== 'boolean') noSetVisible.add(where);
      if (c.inFrame !== 'full' && c.inFrame !== 'partial') problems.push(`${at}: inFrame must be "full" or "partial"`);
      if (c.grid !== undefined && c.grid !== null && !isGrid(c.grid)) problems.push(`${at}: grid must be { row, col } integers from 1`);
      cards.push({ printing: c.printing, setVisible: c.setVisible, inFrame: c.inFrame, ...(isGrid(c.grid) ? { grid: { row: c.grid.row, col: c.grid.col } } : {}) });
    });
    out.push({ file: p.file, bucket: p.bucket, tags: p.tags, otherGame: p.otherGame, cards });
  });

  if (unlabeled.size) {
    const n = [...unlabeled.values()].reduce((a, b) => a + b, 0);
    problems.push(`${n} card(s) have printing: null (unlabeled; set the card in hand, or delete the row if no card is there) in: ${[...unlabeled.keys()].join(', ')}`);
  }
  if (unknownKeys.length) problems.push(`${unknownKeys.length} printing(s) are not CARDS keys (name|set|imgFile):\n    ${unknownKeys.join('\n    ')}`);
  if (noSetVisible.size) problems.push(`setVisible must be true or false on every card in: ${[...noSetVisible].join(', ')}`);
  if (problems.length) throw new Error(`labels invalid:\n  ${problems.join('\n  ')}`);
  return out;
}

export function loadLabels(file: string): LabelPhoto[] {
  return loadLabelsFrom(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// ---------------------------------------------------------------------------
// Scoring

const zeroClasses = (): Record<PairClass, number> => Object.fromEntries(PAIR_CLASSES.map(c => [c, 0])) as Record<PairClass, number>;
const zeroPrinting = (): PrintingTally => ({ setVisiblePairs: 0, setVisibleCorrect: 0, defensible: 0, notDefensible: 0 });
const sameCell = (a?: { row: number; col: number }, b?: { row: number; col: number }) => !!a && !!b && a.row === b.row && a.col === b.col;

/** The identity a Matched/Check row asserts: its identityKey, else its chosen printing's. Null when it asserts none. */
function topIdentity(m: MatchResult): string | null {
  if (m.status === 'not_found') return null;
  return m.identityKey ?? identityOfKey(m.chosen?.key);
}

/**
 * One photo. Position-free identity multiset: tp = min(labeled, predicted)
 * per identity over Matched/Check rows; fn = full labels left over; fp =
 * asserting rows left over (plus identity-less Check rows nothing pairs
 * with). Leftovers pair by grid cell when both carry one, then in order.
 */
export function scorePhoto(label: LabelPhoto, pred: Prediction | undefined, prices: PriceMap): PhotoScore {
  const s: PhotoScore = {
    file: label.file, bucket: label.bucket, otherGame: label.otherGame,
    tp: 0, fp: 0, fn: 0, labeledFull: label.cards.filter(c => c.inFrame === 'full').length,
    byClass: zeroClasses(), pairs: [], silentWrong: 0, silentWrongPrice: 0, wrongPrintingUnpriced: 0, hardFail: false,
    printing: zeroPrinting(), grid: { checked: 0, matched: 0 },
    photoQuality: pred?.photoQuality, latencyMs: pred?.latencyMs, costUsd: pred?.costUsd,
  };
  if (!pred) return { ...s, excluded: 'missing' };
  if (pred.truncated) return { ...s, excluded: 'truncated' };
  if (pred.error) return { ...s, excluded: 'error', error: pred.error };

  const rows = pred.detections;
  s.hardFail = label.otherGame && rows.some(d => d.match.status !== 'not_found');

  // Full labels first everywhere, so a partial card never takes a tp a full one could have.
  const labs = label.cards.map((c, i) => ({ i, c, id: identityOfKey(c.printing) }))
    .sort((a, b) => Number(a.c.inFrame === 'partial') - Number(b.c.inFrame === 'partial'));
  const preds = rows.map((d, i) => ({ i, d, id: topIdentity(d.match) }));
  const usedL = new Set<number>(), usedP = new Set<number>();

  const gridOf = (r: number) => rows[r].grid;
  const add = (pair: Pair) => {
    s.pairs.push(pair);
    s.byClass[pair.class]++;
    if (pair.label?.grid && pair.row !== undefined) { s.grid.checked++; if (sameCell(pair.label.grid, gridOf(pair.row))) s.grid.matched++; }
  };

  // 1. Correct-identity pairs (tp). Within an identity prefer the same grid
  //    cell, then the same printing, then Matched over Check, then order.
  const tpPasses: ((l: typeof labs[number], p: typeof preds[number]) => boolean)[] = [
    (l, p) => sameCell(l.c.grid, p.d.grid),
    (l, p) => p.d.match.chosen?.key === l.c.printing,
    (_l, p) => p.d.match.status === 'matched',
    () => true,
  ];
  for (const ok of tpPasses) for (const l of labs) {
    if (usedL.has(l.i) || !l.id) continue;
    const p = preds.find(x => !usedP.has(x.i) && x.id === l.id && ok(l, x));
    if (!p) continue;
    usedL.add(l.i); usedP.add(p.i);
    s.tp++;
    add({ class: p.d.match.status === 'matched' ? 'matched_correct' : 'check_top1', label: l.c, row: p.i, ...printingLevel(l.c, p.d.match, prices) });
  }

  // 2. Leftovers. Every remaining row pairs with a remaining label (full
  //    ones first), by grid cell, then in order.
  const leftL = labs.filter(l => !usedL.has(l.i));
  // Asserting rows pair first (Matched, Check with an identity, identity-less
  // Check), not_found rows last, so the class never depends on row order.
  const rank = (p: typeof preds[number]) => (p.d.match.status === 'matched' ? 0 : p.d.match.status === 'not_found' ? 3 : p.id ? 1 : 2);
  const leftP = preds.filter(p => !usedP.has(p.i)).sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  const wrongPair = (l: typeof labs[number], p: typeof preds[number]): PairClass => {
    const m = p.d.match;
    if (m.status === 'not_found') return 'not_found_miss';
    if (m.status === 'matched') return 'matched_wrong';
    return l.id && m.candidates.some(c => identityOfKey(c.key) === l.id) ? 'check_in_candidates' : 'check_miss';
  };
  const pairedL = new Set<number>(), pairedP = new Set<number>();
  for (const byGrid of [true, false]) for (const l of leftL) {
    if (pairedL.has(l.i)) continue;
    const p = leftP.find(x => !pairedP.has(x.i) && (!byGrid || sameCell(l.c.grid, x.d.grid)));
    if (!p) continue;
    pairedL.add(l.i); pairedP.add(p.i);
    add({ class: wrongPair(l, p), label: l.c, row: p.i });
  }
  for (const p of leftP) {
    if (p.d.match.status === 'not_found') continue;
    // A row asserting an identity that is not the label's is a false card
    // whether or not it paired; an identity-less Check row only when it
    // stands for nothing that was there.
    if (p.id || !pairedP.has(p.i)) s.fp++;
    if (!pairedP.has(p.i)) add({ class: 'hallucination', row: p.i });
  }
  for (const l of leftL) {
    if (l.c.inFrame === 'partial') continue;
    s.fn++;
    if (!pairedL.has(l.i)) add({ class: 'missed', label: l.c });
  }

  // Silent wrong: a Matched row outside a tp pair naming a card not labeled
  // on this photo (matched_wrong, and Matched hallucinations of absent cards,
  // other-game and non-card photos included). A duplicate of a present card
  // stays fp only.
  const present = new Set(labs.map(l => l.id).filter(Boolean));
  s.silentWrong = preds.filter(p => !usedP.has(p.i) && p.d.match.status === 'matched' && !present.has(p.id)).length;
  for (const p of s.pairs) {
    if (p.silentWrongPrice) s.silentWrongPrice++;
    if (p.wrongPrintingUnpriced) s.wrongPrintingUnpriced++;
    if (!p.printing) continue;
    if (p.label!.setVisible) { s.printing.setVisiblePairs++; if (p.printing === 'correct') s.printing.setVisibleCorrect++; }
    else if (p.printing === 'defensible') s.printing.defensible++;
    else s.printing.notDefensible++;
  }
  return s;
}

/**
 * Printing level on a correct-identity pair. setVisible: correct iff the
 * chosen key is the labeled one. Otherwise defensible unless a Matched row
 * chose a different printing that the collapse rule would not have merged
 * with the true one (price delta at or above the floor, or another legality).
 * silent_wrong_price: a Matched row whose price differs from the true
 * printing's by the floor or more; unpriced on either side is not flagged
 * there but counted as wrong_printing_unpriced.
 */
function printingLevel(c: LabelCard, m: MatchResult, prices: PriceMap): Pick<Pair, 'printing' | 'silentWrongPrice' | 'wrongPrintingUnpriced'> {
  const chosenKey = m.chosen?.key;
  const truePrice = prices[c.printing], chosenPrice = chosenKey ? prices[chosenKey] : undefined;
  const wrongMatched = m.status === 'matched' && chosenKey !== c.printing;
  const silentWrongPrice = wrongMatched
    && truePrice !== undefined && chosenPrice !== undefined && Math.abs(chosenPrice - truePrice) >= PRICE_DELTA_FLOOR;
  const wrongPrintingUnpriced = wrongMatched && (truePrice === undefined || chosenPrice === undefined);
  if (c.setVisible) return { printing: chosenKey === c.printing ? 'correct' : 'wrong', silentWrongPrice, wrongPrintingUnpriced };
  const otherLegality = !!chosenKey && cardByKey(chosenKey)?.legality !== cardByKey(c.printing)?.legality;
  const ok = m.status !== 'matched' || chosenKey === c.printing || (silentWrongPrice === false && otherLegality === false);
  return { printing: ok ? 'defensible' : 'not_defensible', silentWrongPrice, wrongPrintingUnpriced };
}

// ---------------------------------------------------------------------------
// Summary

const pct = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] : null);
const ratio = (a: number, b: number) => (b ? a / b : null);

function tally(scores: PhotoScore[]): Tally {
  const t: Tally = {
    photos: scores.length, scored: 0, errors: 0, truncated: 0, missing: 0, tp: 0, fp: 0, fn: 0, recall: null, precision: null,
    silentWrong: 0, silentWrongPrice: 0, wrongPrintingUnpriced: 0, hardFails: 0, noCards: 0, byClass: zeroClasses(), printing: zeroPrinting(),
    grid: { checked: 0, matched: 0 }, latency: { n: 0, p50: null, p95: null }, costUsd: 0,
  };
  const lat: number[] = [];
  for (const s of scores) {
    if (typeof s.costUsd === 'number') t.costUsd += s.costUsd;
    if (s.excluded === 'error') { t.errors++; continue; }
    if (s.excluded === 'truncated') { t.truncated++; continue; }
    if (s.excluded === 'missing') { t.missing++; continue; }
    t.scored++;
    if (typeof s.latencyMs === 'number') lat.push(s.latencyMs);
    t.tp += s.tp; t.fp += s.fp; t.fn += s.fn;
    t.silentWrong += s.silentWrong; t.silentWrongPrice += s.silentWrongPrice; t.wrongPrintingUnpriced += s.wrongPrintingUnpriced;
    if (s.hardFail) t.hardFails++;
    if (s.photoQuality === 'no_cards') t.noCards++;
    for (const c of PAIR_CLASSES) t.byClass[c] += s.byClass[c];
    for (const k of Object.keys(t.printing) as (keyof PrintingTally)[]) t.printing[k] += s.printing[k];
    t.grid.checked += s.grid.checked; t.grid.matched += s.grid.matched;
  }
  t.recall = ratio(t.tp, t.tp + t.fn);
  t.precision = ratio(t.tp, t.tp + t.fp);
  lat.sort((a, b) => a - b);
  t.latency = { n: lat.length, p50: pct(lat, 0.5), p95: pct(lat, 0.95) };
  return t;
}

export function summarize(scores: PhotoScore[]): Summary {
  const groups = new Map<string, PhotoScore[]>();
  for (const s of scores) groups.set(s.bucket, [...(groups.get(s.bucket) ?? []), s]);
  const expected = scores.filter(s => s.bucket.startsWith('single') && s.labeledFull > 0);
  const singles = expected.filter(s => !s.excluded);
  return {
    buckets: Object.fromEntries([...groups].map(([b, ss]) => [b, tally(ss)])),
    pooled: tally(scores),
    singles: {
      photos: singles.length,
      expected: expected.length,
      top1: singles.filter(s => s.fn === 0 && s.fp === 0).length,
      matchedCorrect: singles.filter(s => s.fn === 0 && s.fp === 0 && s.byClass.check_top1 === 0).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Self-test predictions

const EMPTY_READ: Omit<ScanDetection, 'grid'> = {
  title: null, reference: null, nickname: null, abilityStart: null, abilityEnd: null, type: 'unknown', brigade: null,
  strength: null, toughness: null, identifier: null, printNumber: null, rarityCode: null, promoText: null,
  illustrator: null, copyrightYear: null, orientation: 'upright', confidence: 'high',
};

/** Every labeled card as a Matched row on its exact printing: must score 100%. */
export function labelsAsPredictions(labels: LabelPhoto[]): Prediction[] {
  return labels.map(l => ({
    file: l.file,
    detections: l.cards.map(c => {
      const card = cardByKey(c.printing)!;
      const id = getScanIndex().identityOf(card);
      const chosen = toCandidate(card, {});
      return {
        ...EMPTY_READ, title: card.name, grid: c.grid ?? { row: 1, col: 1 },
        match: { status: 'matched', nameReason: 'exact', printingReason: 'only', identityKey: id.key, stem: id.stem, chosen, candidates: [chosen], scores: { matchScore: 0, runnerUpScore: 0, agreeingFields: [] } } as MatchResult,
      };
    }),
  }));
}

/** No rows on any photo: must score zero recall. */
export function emptyPredictions(labels: LabelPhoto[]): Prediction[] {
  return labels.map(l => ({ file: l.file, detections: [] }));
}

// ---------------------------------------------------------------------------
// run.ts records

const TRUNCATION = /max_tokens|truncat/i;
const isTruncated = (r: any) => r?.truncated === true || TRUNCATION.test(String(r?.stopReason ?? r?.usage?.stopReason ?? ''));

/**
 * A run.ts record to a Prediction. By default the route's own fields
 * (status, reasons, chosenKey, candidates) are scored: that is what the
 * player saw, priced at request time. `rematch` re-runs matchDetection on
 * the read with `prices`; records without a `status` (bare reads) are always
 * re-matched.
 */
export function recordToPrediction(rec: any, prices: PriceMap, rematch: boolean): Prediction {
  const usage = rec?.usage ?? {};
  const pred: Prediction = {
    file: String(rec?.file ?? ''),
    detections: [],
    photoQuality: typeof rec?.photoQuality === 'string' ? rec.photoQuality : undefined,
    latencyMs: typeof rec?.latencyMs === 'number' ? rec.latencyMs : undefined,
    costUsd: typeof usage.costUsd === 'number' ? usage.costUsd : undefined,
  };
  if (isTruncated(rec)) pred.truncated = true;
  if (typeof rec?.error === 'string') pred.error = rec.error;
  for (const d of Array.isArray(rec?.detections) ? rec.detections : []) {
    const read = d?.read && typeof d.read === 'object' ? d.read : d;
    const det = capDetection({ ...read, grid: d?.grid ?? read?.grid, orientation: d?.orientation ?? read?.orientation });
    pred.detections.push({ ...det, match: rematch || typeof d?.status !== 'string' ? matchDetection(det, prices) : routeMatch(d) });
  }
  return pred;
}

function routeMatch(d: any): MatchResult {
  const candidates: Candidate[] = Array.isArray(d.candidates) ? d.candidates : [];
  const chosenKey: string | null = typeof d.chosenKey === 'string' ? d.chosenKey : null;
  const card = chosenKey ? cardByKey(chosenKey) : undefined;
  const chosen = chosenKey ? candidates.find(c => c.key === chosenKey) ?? (card ? toCandidate(card, {}) : undefined) : undefined;
  return {
    status: d.status, nameReason: d.nameReason ?? 'none', printingReason: d.printingReason ?? 'none',
    identityKey: identityOfKey(chosenKey) ?? undefined, chosen, candidates,
    scores: d.scores ?? { matchScore: 0, runnerUpScore: 0, agreeingFields: [] },
  };
}

/**
 * A run.ts output directory: `<photo>.json` per success, `errors.jsonl` for
 * the rest. A later success wins over earlier error lines for the same file.
 * Without rematch, prices are harvested from every candidate the route
 * priced, with `extraPrices` on top. With rematch only `extraPrices` (a full
 * card_prices dump) is used, and it is required.
 */
export function readOutputs(dir: string, rematch: boolean, extraPrices: PriceMap = {}): { predictions: Map<string, Prediction>; prices: PriceMap } {
  if (rematch && !Object.keys(extraPrices).length) throw new Error('--rematch requires --prices <card_prices dump JSON: Record<cardKey, number>>');
  const records = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== 'score.json')
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter(r => r && typeof r.file === 'string');
  const prices: PriceMap = {};
  if (!rematch) for (const r of records) for (const d of r.detections ?? []) for (const c of d?.candidates ?? []) {
    if (typeof c?.key === 'string' && typeof c.price === 'number') prices[c.key] = c.price;
  }
  Object.assign(prices, extraPrices);

  const predictions = new Map<string, Prediction>();
  const errFile = path.join(dir, 'errors.jsonl');
  if (fs.existsSync(errFile)) {
    for (const line of fs.readFileSync(errFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      const body = e.body && typeof e.body === 'object' ? e.body : {};
      const pred: Prediction = { file: e.file, detections: [], error: typeof body.code === 'string' ? body.code : `http_${e.status}` };
      if (isTruncated(body)) pred.truncated = true;
      predictions.set(e.file, pred);
    }
  }
  for (const r of records) predictions.set(r.file, recordToPrediction(r, prices, rematch));
  return { predictions, prices };
}

// ---------------------------------------------------------------------------
// CLI

const fmtPct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}%`);
const fmtMs = (x: number | null) => (x === null ? '–' : `${(x / 1000).toFixed(1)}s`);

export function markdown(sum: Summary): string {
  const head = ['bucket', 'photos', 'scored', 'err', 'trunc', 'missing', 'tp', 'fp', 'fn', 'recall', 'precision', 'silent wrong', 'wrong price', 'wrong printing unpriced', 'hard fail', ...PAIR_CLASSES, 'set-visible correct', 'not defensible', 'grid', 'p50', 'p95', 'cost'];
  const row = (name: string, t: Tally) => [
    name, t.photos, t.scored, t.errors, t.truncated, t.missing, t.tp, t.fp, t.fn, fmtPct(t.recall), fmtPct(t.precision), t.silentWrong, t.silentWrongPrice, t.wrongPrintingUnpriced, t.hardFails,
    ...PAIR_CLASSES.map(c => t.byClass[c]),
    `${t.printing.setVisibleCorrect}/${t.printing.setVisiblePairs}`, t.printing.notDefensible, `${t.grid.matched}/${t.grid.checked}`,
    fmtMs(t.latency.p50), fmtMs(t.latency.p95), `$${t.costUsd.toFixed(3)}`,
  ].join(' | ');
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...Object.keys(sum.buckets).sort().map(b => `| ${row(b, sum.buckets[b])} |`),
    `| ${row('**pooled**', sum.pooled)} |`,
    '',
    `Singles identity top-1: ${sum.singles.top1} of ${sum.singles.photos} scored (${sum.singles.photos}/${sum.singles.expected} expected; all pairs Matched-correct: ${sum.singles.matchedCorrect}).`,
  ].join('\n');
}

function parseArgs(argv: string[]) {
  const f: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    if (a === '--rematch') { f.rematch = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    f[a.slice(2)] = v;
  }
  if (typeof f.labels !== 'string') throw new Error('--labels is required');
  if (typeof f.outputs !== 'string') throw new Error('--outputs is required');
  if (f.rematch === true && typeof f.prices !== 'string') throw new Error('--rematch requires --prices <card_prices dump JSON: Record<cardKey, number>>');
  return { labels: f.labels, outputs: f.outputs, photos: typeof f.photos === 'string' ? f.photos : null, prices: typeof f.prices === 'string' ? f.prices : null, rematch: f.rematch === true };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const labels = loadLabels(o.labels);
  const extra: PriceMap = o.prices ? JSON.parse(fs.readFileSync(o.prices, 'utf8')) : {};
  const { predictions, prices } = readOutputs(o.outputs, o.rematch, extra);

  const labeled = new Set(labels.map(l => l.file));
  const warn = (msg: string, files: string[]) => { if (files.length) console.warn(`${msg} (${files.length}): ${files.slice(0, 10).join(', ')}${files.length > 10 ? ', …' : ''}`); };
  warn('labeled photos with no output record', labels.filter(l => !predictions.has(l.file)).map(l => l.file));
  warn('output records with no label (not scored)', [...predictions.keys()].filter(f => !labeled.has(f)));
  if (o.photos) {
    const onDisk = new Set(fs.readdirSync(o.photos));
    warn('labeled photos missing from --photos', labels.filter(l => !onDisk.has(l.file)).map(l => l.file));
    warn('photos with no label', [...onDisk].filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f) && !labeled.has(f)));
  }

  const scores = labels.map(l => scorePhoto(l, predictions.get(l.file), prices));
  const summary = summarize(scores);
  console.log(markdown(summary));
  const out = path.join(o.outputs, 'score.json');
  fs.writeFileSync(out, JSON.stringify({ rematch: o.rematch, summary, photos: scores }, null, 2));
  console.log(`\nwrote ${out}`);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
