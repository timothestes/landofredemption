import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { getScanIndex } from '@/lib/scan/stemIndex';
import { cardKey } from '@/lib/scan/vocab';
import type { DeckDetection, DeckScanResponse } from '@/lib/scan/deckClassify';
import { scoreDeckPhoto, type DeckLabel } from '@/scripts/scan-eval/deckScore';

const idx = getScanIndex();
const pick = CARDS.filter(c => !idx.identityOf(c).lostSoul && !idx.identityOf(c).token);
const A = pick[0];
const stem = (c: (typeof CARDS)[number]) => idx.identityOf(c).normalizedStem;
const B = pick.find(c => stem(c) !== stem(A))!;
const C = pick.find(c => ![A, B].some(x => stem(x) === stem(c)))!;

let n = 0;
const det = (group: number, kind: DeckDetection['kind'], card?: (typeof CARDS)[number]): DeckDetection =>
  ({ id: `d${n++}`, group, position: 0, titleBox: null, kind, deckKey: card ? cardKey(card) : null } as unknown as DeckDetection);

const mkResp = (detections: DeckDetection[], cardCounts = [3]): DeckScanResponse => ({
  scanId: 's', mode: 'deck', photoQuality: 'good',
  groups: cardCounts.map((c, i) => ({ id: i + 1, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: c })),
  detections, usage: { model: 'm', latencyMs: 1200, attempts: 1, costUsd: 0.05 },
} as unknown as DeckScanResponse);

const label: DeckLabel = { photo: 'p.jpg', cards: [{ name: A.name, qty: 2 }, { name: B.name, qty: 1 }], lostSouls: 0, reserveSize: 0, unreadable: 0 };
const resp = () => mkResp([det(1, 'matched', A), det(1, 'which', A), det(1, 'matched', B)]);

describe('scoreDeckPhoto', () => {
  it('perfect read scores 1/1 with nothing invented', () => {
    const s = scoreDeckPhoto(label, resp());
    expect([s.precision, s.recall, s.invented]).toEqual([1, 1, 0]);
    expect(s.costUsd).toBe(0.05);
    expect(s.latencyMs).toBe(1200);
  });
  it('another printing or identity with the labeled name stem counts as a hit', () => {
    const plain = CARDS.find(c => c.name === "Lot's Wife")!;
    const fom = CARDS.find(c => c.name === "Lot's Wife (FoM)")!;
    expect(idx.identityOf(plain).key).not.toBe(idx.identityOf(fom).key);
    const s = scoreDeckPhoto({ ...label, cards: [{ name: plain.name, qty: 1 }] }, mkResp([det(1, 'which', fom)]));
    expect([s.precision, s.recall, s.invented]).toEqual([1, 1, 0]);
  });
  it('an invented card counts and lowers precision', () => {
    const r = resp();
    r.detections.push(det(1, 'matched', C));
    const s = scoreDeckPhoto(label, r);
    expect(s.invented).toBe(1);
    expect(s.precision).toBeLessThan(1);
  });
  it('unreadable cards are already outside cards, so they do not shrink the recall denominator again', () => {
    const r = resp();
    r.detections.pop();
    // cards lists 3 readable copies; 2 found. unreadable counts cards not in the list at all.
    expect(scoreDeckPhoto(label, r).recall).toBeCloseTo(2 / 3, 6);
    expect(scoreDeckPhoto({ ...label, unreadable: 1 }, r).recall).toBeCloseTo(2 / 3, 6);
  });
  it('Lost Soul error counts placeholders and matched Lost Souls', () => {
    const ls = CARDS.find(c => idx.identityOf(c).lostSoul)!;
    const r = resp();
    for (let i = 0; i < 5; i++) r.detections.push(det(1, 'lost_soul'));
    r.detections.push(det(1, 'matched', ls));
    expect(scoreDeckPhoto({ ...label, lostSouls: 7 }, r).lostSoulError).toBe(1);
    expect(scoreDeckPhoto({ ...label, lostSouls: 6 }, r).precision).toBe(1);
  });
  it('reserve default right when no reserve and none chosen', () => {
    expect(scoreDeckPhoto({ ...label, reserveSize: 0 }, resp()).reserveDefaultRight).toBe(true);
    expect(scoreDeckPhoto({ ...label, reserveSize: 5 }, resp()).reserveDefaultRight).toBe(false);
  });
  it('groupCountError sums |cardCount - detections|', () => {
    expect(scoreDeckPhoto(label, mkResp(resp().detections, [5])).groupCountError).toBe(2);
  });
});
