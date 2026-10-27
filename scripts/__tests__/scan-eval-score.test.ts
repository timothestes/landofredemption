import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARDS } from '@/lib/cards/lookup';
import { cardKey } from '@/lib/scan/vocab';
import { PRICE_DELTA_FLOOR } from '@/lib/scan/match';
import {
  scorePhoto, summarize, labelsAsPredictions, emptyPredictions, loadLabelsFrom, recordToPrediction, readOutputs, markdown,
  type LabelPhoto, type Prediction,
} from '@/scripts/scan-eval/score';

const k = (n: string) => cardKey(CARDS.find(c => c.name === n)!);
const labels = [
  { file: 'a.jpg', bucket: 'single', tags: [], otherGame: false, cards: [{ printing: k('Captive Priest'), setVisible: true, inFrame: 'full' as const }] },
  { file: 'b.jpg', bucket: 'spread', tags: [], otherGame: false, cards: [{ printing: k('Captive Priest'), setVisible: false, inFrame: 'full' as const }, { printing: k('Son of God [L]'), setVisible: false, inFrame: 'partial' as const }] },
  { file: 'c.jpg', bucket: 'none', tags: [], otherGame: true, cards: [] },
];
describe('scorer self-tests', () => {
  it('labels as predictions score 100%', () => { const s = summarize(labels.map((l, i) => scorePhoto(l, labelsAsPredictions(labels)[i], {}))); expect(s.pooled.recall).toBe(1); expect(s.pooled.fp).toBe(0); expect(s.pooled.silentWrong).toBe(0); });
  it('empty predictions score zero recall and no false positives', () => { const s = summarize(labels.map((l, i) => scorePhoto(l, emptyPredictions(labels)[i], {}))); expect(s.pooled.recall).toBe(0); expect(s.pooled.fp).toBe(0); });
  it('a matched row on an other-game photo is a hard fail', () => { const p = labelsAsPredictions(labels)[0]; const s = scorePhoto(labels[2], { ...p, file: 'c.jpg' }, {}); expect(s.hardFail).toBe(true); });
  it('partial cards do not count as misses', () => { const p = labelsAsPredictions(labels)[1]; p.detections = p.detections.slice(0, 1); expect(scorePhoto(labels[1], p, {}).fn).toBe(0); });
  it('unknown printing keys are rejected on load', () => expect(() => loadLabelsFrom([{ ...labels[0], cards: [{ printing: 'No|Such|Key', setVisible: true, inFrame: 'full' }] }])).toThrow(/No\|Such\|Key/));
});

// Helpers for the focused tests: a prediction is built from a label of the
// cards the "model" claims, then its rows are edited.
const photo = (cards: LabelPhoto['cards'], extra: Partial<LabelPhoto> = {}): LabelPhoto => ({ file: 'x.jpg', bucket: 'spread', tags: [], otherGame: false, cards, ...extra });
const predOf = (cards: LabelPhoto['cards']): Prediction => labelsAsPredictions([photo(cards)])[0];
const full = (printing: string, setVisible = true, grid?: { row: number; col: number }) => ({ printing, setVisible, inFrame: 'full' as const, ...(grid ? { grid } : {}) });

describe('multiset and pair classes', () => {
  it('two copies labeled, one predicted: tp 1, fn 1, the miss is classed', () => {
    const cp = k('Captive Priest');
    const s = scorePhoto(photo([full(cp), full(cp)]), predOf([full(cp)]), {});
    expect([s.tp, s.fn, s.fp]).toEqual([1, 1, 0]);
    expect(s.byClass.matched_correct).toBe(1);
    expect(s.byClass.missed).toBe(1);
  });
  it('two copies predicted, one labeled: tp 1, fp 1 (a hallucination)', () => {
    const cp = k('Captive Priest');
    const s = scorePhoto(photo([full(cp)]), predOf([full(cp), full(cp)]), {});
    expect([s.tp, s.fn, s.fp]).toEqual([1, 0, 1]);
    expect(s.byClass.hallucination).toBe(1);
  });
  it('a wrong identity on a Matched row is matched_wrong: fp 1, fn 1, a silent wrong', () => {
    const s = scorePhoto(photo([full(k('Captive Priest'))]), predOf([full(k('Son of God [L]'))]), {});
    expect([s.tp, s.fn, s.fp]).toEqual([0, 1, 1]);
    expect(s.byClass.matched_wrong).toBe(1);
    expect(s.silentWrong).toBe(1);
    expect(s.pairs[0].class).toBe('matched_wrong');
  });
  it('wrong-identity rows pair with leftover labels by grid cell', () => {
    const cp = k('Captive Priest'), sog = k('Son of God [L]');
    const pred = predOf([full(sog, true, { row: 1, col: 2 }), full(sog, true, { row: 1, col: 1 })]);
    pred.detections[0].match.status = 'not_found';
    const s = scorePhoto(photo([full(cp, true, { row: 1, col: 1 }), full(cp, true, { row: 1, col: 2 })]), pred, {});
    const byCell = Object.fromEntries(s.pairs.map(p => [`${p.label?.grid?.col}`, p.class]));
    expect(byCell).toEqual({ '1': 'matched_wrong', '2': 'not_found_miss' });
    expect(s.grid).toEqual({ checked: 2, matched: 2 });
  });
  it('a Check row: top-1 right is check_top1; wrong top-1 with the truth among candidates is check_in_candidates', () => {
    const cp = k('Captive Priest'), sog = k('Son of God [L]');
    const pred = predOf([full(cp)]);
    pred.detections[0].match.status = 'check';
    expect(scorePhoto(photo([full(cp)]), pred, {}).byClass.check_top1).toBe(1);

    const wrong = predOf([full(sog)]);
    const m = wrong.detections[0].match;
    m.status = 'check';
    m.candidates = [...m.candidates, { ...m.candidates[0], key: cp }];
    const s = scorePhoto(photo([full(cp)]), wrong, {});
    expect(s.byClass.check_in_candidates).toBe(1);
    expect(s.silentWrong).toBe(0);

    const miss = predOf([full(sog)]);
    miss.detections[0].match.status = 'check';
    expect(scorePhoto(photo([full(cp)]), miss, {}).byClass.check_miss).toBe(1);
  });
});

describe('printing level', () => {
  const L = k('Son of God [L]'), K = k('Son of God [K]');
  const chose = (key: string): Prediction => predOf([full(key)]);
  it('setVisible: correct only when chosenKey equals the labeled printing', () => {
    expect(scorePhoto(photo([full(L, true)]), chose(L), {}).printing).toMatchObject({ setVisiblePairs: 1, setVisibleCorrect: 1 });
    expect(scorePhoto(photo([full(L, true)]), chose(K), {}).printing).toMatchObject({ setVisiblePairs: 1, setVisibleCorrect: 0 });
  });
  it('silent_wrong_price at exactly PRICE_DELTA_FLOOR, not just below it', () => {
    const at = scorePhoto(photo([full(L, false)]), chose(K), { [L]: 1, [K]: 1 + PRICE_DELTA_FLOOR });
    expect(at.silentWrongPrice).toBe(1);
    expect(at.printing.defensible).toBe(0);
    const below = scorePhoto(photo([full(L, false)]), chose(K), { [L]: 1, [K]: 1 + PRICE_DELTA_FLOOR - 0.01 });
    expect(below.silentWrongPrice).toBe(0);
    expect(below.printing.defensible).toBe(1);
  });
  it('a Matched wrong printing with either price missing is wrong_printing_unpriced, not silent_wrong_price', () => {
    const one = (prices: Record<string, number>) => scorePhoto(photo([full(L, false)]), chose(K), prices);
    for (const prices of [{}, { [L]: 1 }, { [K]: 50 }]) expect([one(prices).wrongPrintingUnpriced, one(prices).silentWrongPrice], JSON.stringify(prices)).toEqual([1, 0]);
    expect(one({ [L]: 1, [K]: 50 }).wrongPrintingUnpriced).toBe(0);
    expect(scorePhoto(photo([full(L, false)]), chose(L), {}).wrongPrintingUnpriced).toBe(0);
    const check = chose(K); check.detections[0].match.status = 'check';
    expect(scorePhoto(photo([full(L, false)]), check, {}).wrongPrintingUnpriced).toBe(0);
    const sum = summarize([one({}), one({ [L]: 1 })]);
    expect(sum.pooled.wrongPrintingUnpriced).toBe(2);
    const md = markdown(sum);
    expect(md.split('\n')[0]).toMatch(/\| wrong printing unpriced \|/);
    expect(md).toMatch(/\*\*pooled\*\*(?: \| [^|]+){12} \| 2 \|/);
  });
  it('a Check row never flags silent_wrong_price', () => {
    const p = chose(K);
    p.detections[0].match.status = 'check';
    const s = scorePhoto(photo([full(L, false)]), p, { [L]: 1, [K]: 50 });
    expect([s.silentWrongPrice, s.tp, s.byClass.check_top1, s.printing.defensible]).toEqual([0, 1, 1, 1]);
  });
});

describe('harness rules', () => {
  const cp = k('Captive Priest');
  it('an error record is counted in errors, never as a miss', () => {
    const s = scorePhoto(photo([full(cp)]), { file: 'x.jpg', detections: [], error: 'upstream_rate_limit' }, {});
    expect(s.excluded).toBe('error');
    const sum = summarize([s]);
    expect(sum.pooled.errors).toBe(1);
    expect(sum.pooled.fn).toBe(0);
    expect(sum.pooled.recall).toBeNull();
  });
  it('a truncated record is excluded from accuracy', () => {
    const s = scorePhoto(photo([full(cp)]), { file: 'x.jpg', detections: [], truncated: true }, {});
    const sum = summarize([s, scorePhoto(photo([full(cp)]), predOf([full(cp)]), {})]);
    expect(sum.pooled.truncated).toBe(1);
    expect([sum.pooled.tp, sum.pooled.fn, sum.pooled.recall]).toEqual([1, 0, 1]);
  });
  it('singles top-1 is pooled over photos', () => {
    const single = (p: string) => photo([full(cp)], { bucket: 'single', file: p });
    const sum = summarize([
      scorePhoto(single('1.jpg'), predOf([full(cp)]), {}),
      scorePhoto(single('2.jpg'), emptyPredictions([single('2.jpg')])[0], {}),
      scorePhoto(photo([], { bucket: 'single', file: '3.jpg' }), emptyPredictions([photo([])])[0], {}),
    ]);
    expect(sum.singles).toMatchObject({ photos: 2, top1: 1 });
  });
});

describe('labels loader', () => {
  it('ignores extra fields and lists every unlabeled card and unknown key', () => {
    const ok = loadLabelsFrom([{ ...labels[0], _draft: 'x', cards: [{ ...labels[0].cards[0], status: 'matched', titleRead: 'Captive Priest' }] }]);
    expect(ok[0].cards[0]).toEqual(labels[0].cards[0]);
    const bad = () => loadLabelsFrom([
      { ...labels[0], file: 'p.jpg', cards: [{ printing: null, setVisible: null, inFrame: 'full' }] },
      { ...labels[0], file: 'q.jpg', cards: [{ printing: 'A|B|C', setVisible: true, inFrame: 'full' }, { printing: 'D|E|F', setVisible: true, inFrame: 'full' }] },
    ]);
    expect(bad).toThrow(/printing: null.*p\.jpg/s);
    expect(bad).toThrow(/A\|B\|C/);
    expect(bad).toThrow(/D\|E\|F/);
    expect(bad).toThrow(/setVisible.*p\.jpg/s);
  });
});

describe('route records', () => {
  const cp = k('Captive Priest');
  const cand = { key: cp, name: 'Captive Priest', set: 'FoM', officialSet: 'x', imgFile: '098-Captive-Priest', legality: 'Rotation', price: 0.5 };
  const det = { id: 'd1', grid: { row: 1, col: 1 }, orientation: 'upright', read: { title: 'Captive Priest', type: 'Hero', confidence: 'high' }, status: 'matched', nameReason: 'exact', printingReason: 'only', chosenKey: cp, scores: { matchScore: 9, runnerUpScore: 0, agreeingFields: [] }, candidates: [cand] };
  const rec = { scanId: 's', photoQuality: 'ok', detections: [det], usage: { model: 'm', costUsd: 0.01 }, file: 'a.jpg', status: 200, latencyMs: 4000, attempts: 1 };
  it('uses the route fields, and derives identity from chosenKey', () => {
    const p = recordToPrediction(rec, {}, false);
    expect(p.detections[0].match.status).toBe('matched');
    expect(p.detections[0].match.identityKey).toBeTruthy();
    expect([p.latencyMs, p.costUsd]).toEqual([4000, 0.01]);
    expect(scorePhoto(labels[0], p, {}).byClass.matched_correct).toBe(1);
  });
  it('re-matches the read when asked', () => {
    const p = recordToPrediction({ ...rec, detections: [{ ...det, status: 'not_found', chosenKey: null, candidates: [] }] }, {}, true);
    expect(p.detections[0].match.status).not.toBe('not_found');
  });
  it('reads a run.ts output directory: json records, errors.jsonl, harvested prices', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
    fs.writeFileSync(path.join(dir, 'a.jpg.json'), JSON.stringify(rec));
    fs.writeFileSync(path.join(dir, 'score.json'), '{}');
    fs.writeFileSync(path.join(dir, 'errors.jsonl'), JSON.stringify({ file: 'b.jpg', status: 503, body: { code: 'upstream_overloaded' } }) + '\n' + JSON.stringify({ file: 'a.jpg', status: 429, body: { code: 'upstream_rate_limit' } }) + '\n');
    const { predictions, prices } = readOutputs(dir, false);
    expect(predictions.get('a.jpg')?.error).toBeUndefined();
    expect(predictions.get('b.jpg')?.error).toBe('upstream_overloaded');
    expect(prices[cp]).toBe(0.5);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('fix round 1', () => {
  const cp = k('Captive Priest'), sog = k('Son of God [L]');
  const nf = (p: Prediction, i: number) => { p.detections[i].match.status = 'not_found'; return p; };
  it('silent wrong does not depend on row order (R9a)', () => {
    const a = scorePhoto(photo([full(cp)]), nf(predOf([full(sog), full(sog)]), 0), {});
    const b = scorePhoto(photo([full(cp)]), nf(predOf([full(sog), full(sog)]), 1), {});
    expect([a.silentWrong, b.silentWrong]).toEqual([1, 1]);
    expect(a.byClass.matched_wrong).toBe(1);
    expect(b.byClass.matched_wrong).toBe(1);
  });
  it('a Matched extra of an absent card on a single is silent wrong', () => {
    const s = scorePhoto(photo([full(cp)], { bucket: 'single' }), predOf([full(cp), full(sog)]), {});
    expect([s.tp, s.fp, s.silentWrong]).toEqual([1, 1, 1]);
  });
  it('a duplicate Matched of a present card is fp but not silent', () => {
    const s = scorePhoto(photo([full(cp)]), predOf([full(cp), full(cp)]), {});
    expect([s.fp, s.silentWrong]).toEqual([1, 0]);
  });
  it('a Matched row on an other-game photo and on a non-card photo is silent wrong', () => {
    expect(scorePhoto(photo([], { otherGame: true }), predOf([full(sog)]), {}).silentWrong).toBe(1);
    expect(scorePhoto(photo([], { bucket: 'none' }), predOf([full(sog)]), {}).silentWrong).toBe(1);
  });
  it('a Check row naming an absent card is not silent', () => {
    const p = predOf([full(sog)]);
    p.detections[0].match.status = 'check';
    expect(scorePhoto(photo([]), p, {}).silentWrong).toBe(0);
  });
  it('tp takes the full label before a partial one of the same identity', () => {
    const s = scorePhoto(photo([{ printing: cp, setVisible: true, inFrame: 'partial' }, full(cp)]), predOf([full(cp)]), {});
    expect([s.tp, s.fn]).toEqual([1, 0]);
  });
  it('--rematch refuses to run without a full price dump', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
    expect(() => readOutputs(dir, true)).toThrow(/--prices/);
    expect(() => readOutputs(dir, true, { [cp]: 1 })).not.toThrow();
    fs.rmSync(dir, { recursive: true });
  });
  it('the table has a missing column and the singles line shows scored/expected', () => {
    const single = (f: string) => photo([full(cp)], { bucket: 'single', file: f });
    const sum = summarize([scorePhoto(single('1.jpg'), predOf([full(cp)]), {}), scorePhoto(single('2.jpg'), undefined, {})]);
    expect(sum.singles).toMatchObject({ photos: 1, expected: 2, top1: 1 });
    const md = markdown(sum);
    expect(md.split('\n')[0]).toMatch(/\| missing \|/);
    expect(md).toMatch(/1 of 1 scored \(1\/2 expected/);
  });
});
