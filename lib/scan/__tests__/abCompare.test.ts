import { describe, it, expect } from 'vitest';
import { settleAbPairs, MAX_AB_PAIRS } from '../abCompare';
import { DEFAULT_ARM } from '../recognize';
import type { Candidate, MatchResult } from '../match';
import type { ScanDetection } from '../schema';
const det = (title: string, col = 1): ScanDetection => ({ title, reference: null, nickname: null, abilityStart: null, abilityEnd: null, type: 'unknown', brigade: null, strength: null, toughness: null, identifier: null, printNumber: null, rarityCode: null, promoText: null, illustrator: null, copyrightYear: null, grid: { row: 1, col }, orientation: 'upright', confidence: 'high' });
const cand = (key: string, imgFile: string): Candidate => ({ key, name: key, set: key, officialSet: key, imgFile, legality: 'Classic', price: null });
const SCORES = { matchScore: 0, runnerUpScore: 0, agreeingFields: [] };
const paired = (n: number): MatchResult => {
  const original = cand(`O${n}`, `orig-${n}`), ab = cand(`A${n}`, `ab-${n}`);
  return { status: 'matched', nameReason: 'exact', printingReason: 'default', chosen: original, candidates: [original, ab], abPair: { original, ab }, scores: SCORES };
};
const plain: MatchResult = { status: 'matched', nameReason: 'exact', printingReason: 'only', chosen: cand('X', 'x'), candidates: [cand('X', 'x')], scores: SCORES };
const reply = (answers: { card: number; match: string }[], stop = 'end_turn') => ({
  model: 'claude-sonnet-5-5', stop_reason: stop, usage: { input_tokens: 5000, output_tokens: 300 },
  content: [{ type: 'text', text: JSON.stringify({ answers: answers.map(a => ({ ...a, photoLook: 'x', aLook: 'y', bLook: 'z' })) }) }],
});

describe('settleAbPairs', () => {
  it('makes no call when no match carries a pair', async () => {
    let calls = 0;
    const r = await settleAbPairs(Buffer.alloc(4), [det('X')], [plain], DEFAULT_ARM, { create: async () => { calls++; return reply([]); } });
    expect(calls).toBe(0); expect(r.asked).toBe(0); expect(r.matches[0]).toBe(plain); expect(r.costUsd).toBe(0);
  });

  it('sends the photo, then each pair with the original as A on even cards and as B on odd ones', async () => {
    let p: any;
    await settleAbPairs(Buffer.from('jpg'), [det('One'), det('X', 2), det('Two', 3)], [paired(1), plain, paired(2)], DEFAULT_ARM, { create: async (x: any) => { p = x; return reply([]); } });
    const content = p.messages[0].content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') } });
    const urls = content.filter((b: any) => b.source?.type === 'url').map((b: any) => b.source.url);
    expect(urls.map((u: string) => /card-images\/(.*)\.jpg/.exec(u)?.[1])).toEqual(['orig-1', 'ab-1', 'ab-2', 'orig-2']);
    expect(content[1].text).toContain('Card 1: row 1, column 1, titled "One"');
    expect(content[5].text).toContain('Card 2: row 1, column 3, titled "Two"');
    expect(p.output_config.format.type).toBe('json_schema');
  });

  it('books decided picks as frame and leaves unsure, missing and other rows alone', async () => {
    const ms = [paired(1), plain, paired(2), paired(3)];
    const r = await settleAbPairs(Buffer.alloc(4), [det('a'), det('x'), det('b'), det('c')], ms, DEFAULT_ARM, {
      create: async () => reply([{ card: 1, match: 'B' }, { card: 2, match: 'A' }, { card: 3, match: 'unsure' }]),
    });
    expect(r.asked).toBe(3);
    // card 1 (even query): B is the AB; card 2 (odd query): A is the AB
    expect(r.matches[0]).toMatchObject({ status: 'matched', printingReason: 'frame', chosen: { key: 'A1' } });
    expect(r.matches[1]).toBe(plain);
    expect(r.matches[2]).toMatchObject({ printingReason: 'frame', chosen: { key: 'A2' } });
    expect(r.matches[3]).toBe(ms[3]);
    expect(r.costUsd).toBeCloseTo(5000 * 2e-6 + 300 * 10e-6, 6);
  });

  it('turns a Check row it settles into Matched', async () => {
    const check = { ...paired(1), status: 'check' as const, printingReason: 'printing_ambiguous' as const };
    const r = await settleAbPairs(Buffer.alloc(4), [det('a')], [check], DEFAULT_ARM, { create: async () => reply([{ card: 1, match: 'A' }]) });
    expect(r.matches[0]).toMatchObject({ status: 'matched', printingReason: 'frame', chosen: { key: 'O1' } });
  });

  it('a thrown error leaves every match as it was, with no cost', async () => {
    const ms = [paired(1)];
    const r = await settleAbPairs(Buffer.alloc(4), [det('a')], ms, DEFAULT_ARM, { create: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } });
    expect(r.matches).toEqual(ms); expect(r.costUsd).toBe(0); expect(r.detail).toEqual({ status: 500, message: 'boom' });
  });

  it('a billed response that did not finish leaves matches alone but keeps its cost', async () => {
    const ms = [paired(1)];
    const r = await settleAbPairs(Buffer.alloc(4), [det('a')], ms, DEFAULT_ARM, { create: async () => reply([{ card: 1, match: 'B' }], 'max_tokens') });
    expect(r.matches).toEqual(ms); expect(r.costUsd).toBeGreaterThan(0); expect(r.detail?.stopReason).toBe('max_tokens');
  });

  it('ignores malformed output and out-of-range cards', async () => {
    const ms = [paired(1)];
    const bad = { ...reply([]), content: [{ type: 'text', text: '{"answers":[{"card":9,"match":"A"},{"card":1,"match":"C"}]}' }] };
    expect((await settleAbPairs(Buffer.alloc(4), [det('a')], ms, DEFAULT_ARM, { create: async () => bad })).matches).toEqual(ms);
    const junk = { ...reply([]), content: [{ type: 'text', text: 'not json' }] };
    expect((await settleAbPairs(Buffer.alloc(4), [det('a')], ms, DEFAULT_ARM, { create: async () => junk })).matches).toEqual(ms);
  });

  it(`asks about at most ${MAX_AB_PAIRS} pairs`, async () => {
    const n = MAX_AB_PAIRS + 3;
    let p: any;
    const r = await settleAbPairs(Buffer.alloc(4), Array.from({ length: n }, (_, i) => det(`c${i}`)), Array.from({ length: n }, (_, i) => paired(i)), DEFAULT_ARM, { create: async (x: any) => { p = x; return reply([]); } });
    expect(r.asked).toBe(MAX_AB_PAIRS);
    expect(p.messages[0].content.filter((b: any) => b.source?.type === 'url')).toHaveLength(2 * MAX_AB_PAIRS);
  });
});
