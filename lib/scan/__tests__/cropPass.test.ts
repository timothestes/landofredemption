import { describe, it, expect, vi } from 'vitest';
import {
  runCropPass, cropCallTiming, CROP_ARM, CROP_MODE, CROP_PREFIX, CROP_CONCURRENCY, MAX_CROP_GROUPS, CROP_CALL_TIMEOUT_MS,
  MIN_CROP_REMAINING_MS, type CropPassDeps,
} from '../cropPass';
import { DECK_ARM, DECK_MODE, type recognize } from '../recognize';
import { DECK_INSTRUCTION, type Box, type DeckGroup, type DeckOutput, type DeckRead } from '../deckSchema';

const read = (p: Partial<DeckRead>): DeckRead => ({
  title: 'X', strength: null, toughness: null, type: 'unknown', brigade: null, reference: null,
  group: 1, position: 1, titleBox: null, confidence: 'high', ...p,
});
const grp = (id: number, p: Partial<DeckGroup> = {}): DeckGroup => ({ id, orientation: 'upright', bbox: [0.2, 0.2, 0.4, 0.8], cardCount: 1, ...p });
const g1 = grp(1);
const okResult = (cards: DeckRead[], p: Record<string, unknown> = {}) => ({
  ok: true, output: { photoQuality: 'ok', groups: [g1], cards }, model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.003, latencyMs: 50, attempts: 1, ...p,
});
const crop = async () => Buffer.alloc(1);
const IMAGE = { width: 1000, height: 1000 };
const JPEG = Buffer.alloc(1);
/** A deadline a minute out on the real clock: never reached in these tests. */
const soon = () => Date.now() + 60_000;

/** A sideways group: the only kind that is cropped. */
const side = (id: number, p: Partial<DeckGroup> = {}) => grp(id, { orientation: 'rotated_ccw', ...p });
/** A group that needs a crop: seen sideways. */
const needy = (id: number) => side(id);
/** An upright group: never cropped. */
const fine = (id: number) => grp(id);

function stub(impl: (...args: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  return { fn, deps: { recognize: fn as unknown as typeof recognize, crop } satisfies CropPassDeps };
}

describe('runCropPass', () => {
  it('crops only the groups that need it, in id order, and caps at MAX_CROP_GROUPS', async () => {
    const groups = Array.from({ length: 16 }, (_, i) => (i % 8 === 0 ? fine(i + 1) : needy(i + 1)));
    const out: DeckOutput = { photoQuality: 'ok', groups, cards: [read({ group: 1, title: 'A' }), read({ group: 9, title: 'B' })] };
    const { fn, deps } = stub(async () => okResult([read({ title: 'C' })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    const needyIds = groups.filter(g => g.id !== 1 && g.id !== 9).map(g => g.id);
    expect(needyIds).toHaveLength(14);
    expect(res.cropped).toEqual(needyIds.slice(0, MAX_CROP_GROUPS));
    expect(res.skipped).toEqual(needyIds.slice(MAX_CROP_GROUPS));
    expect(fn).toHaveBeenCalledTimes(MAX_CROP_GROUPS);
  });

  it('crops an upright group the first pass listed under half of', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [grp(1, { cardCount: 10 }), grp(2, { cardCount: 4, bbox: [0.5, 0.2, 0.7, 0.8] })],
      cards: [read({ group: 1, title: 'A' }), ...['B', 'C', 'D'].map(title => read({ group: 2, title }))] };
    const { fn, deps } = stub(async () => okResult([read({ title: 'E' }), read({ title: 'F' })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.cropped).toEqual([1]);
    expect(res.cards.map(c => c.title)).toEqual(['E', 'F', 'B', 'C', 'D']);
  });

  it('a group nested in a cropped group is absorbed: not cropped, its reads dropped, listed in merged', async () => {
    const out: DeckOutput = { photoQuality: 'ok',
      groups: [side(8, { bbox: [0, 0.57, 0.31, 0.8] }), side(9, { bbox: [0, 0.57, 0.45, 1] })],
      cards: [read({ group: 8, title: 'A' }), read({ group: 9, title: 'B' })] };
    const { fn, deps } = stub(async () => okResult([read({ title: 'A' }), read({ title: 'B' })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.cropped).toEqual([9]);
    expect(res.merged).toEqual([8]);
    expect(res.cards.map(c => [c.group, c.title])).toEqual([[9, 'A'], [9, 'B']]);
  });

  it('a nested group keeps its reads when its container is not cropped or its crop fails', async () => {
    const groups = [side(8, { bbox: [0, 0.57, 0.31, 0.8] }), grp(9, { bbox: [0, 0.57, 0.45, 1] })];
    const cards = [read({ group: 8, title: 'A' }), read({ group: 9, title: 'B' })];
    const ok = stub(async () => okResult([read({ title: 'C' })]));
    const kept = await runCropPass(JPEG, { photoQuality: 'ok', groups, cards }, IMAGE, soon(), ok.deps);
    expect(kept.cropped).toEqual([8]);
    expect(kept.merged).toEqual([]);

    const failing = stub(async () => ({ ok: false, code: 'recognizer_failed', attempts: 1, latencyMs: 5 }));
    const both = [side(8, { bbox: [0, 0.57, 0.31, 0.8] }), side(9, { bbox: [0, 0.57, 0.45, 1] })];
    const res = await runCropPass(JPEG, { photoQuality: 'ok', groups: both, cards }, IMAGE, soon(), failing.deps);
    expect(failing.fn).toHaveBeenCalledTimes(1);
    expect(res.failed).toEqual([9]);
    expect(res.merged).toEqual([]);
    expect(res.cards).toEqual(cards);
  });

  it('group 0 is never cropped', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [grp(0, { cardCount: 5, orientation: 'rotated_cw' })], cards: [read({ group: 0, title: null })] };
    const { fn, deps } = stub(async () => okResult([]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(fn).not.toHaveBeenCalled();
    expect(res.cropped).toEqual([]);
    expect(res.skipped).toEqual([]);
    expect(res.cards).toEqual(out.cards);
  });

  it('runs at most four crops at a time', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: Array.from({ length: 9 }, (_, i) => needy(i + 1)), cards: [] };
    let inFlight = 0;
    let max = 0;
    const { deps } = stub(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise<void>(r => setTimeout(r, 5));
      inFlight--;
      return okResult([read({ title: 'C' })]);
    });
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(CROP_CONCURRENCY).toBe(4);
    expect(max).toBe(4);
    expect(res.cropped).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('replaces a cropped group’s reads, renumbers positions, keeps the other groups’ reads in order', async () => {
    const out: DeckOutput = {
      photoQuality: 'ok',
      groups: [fine(1), side(2, { cardCount: 3 }), fine(3)],
      cards: [read({ group: 1, title: 'A' }), read({ group: 2, title: null }), read({ group: 3, title: 'D' })],
    };
    const { deps } = stub(async () => okResult([read({ title: 'B1', position: 4 }), read({ title: 'B2', position: 9 }), read({ title: 'B3', position: 2 })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.cropped).toEqual([2]);
    expect(res.cards.map(c => [c.title, c.group, c.position])).toEqual([
      ['A', 1, 1], ['B1', 2, 1], ['B2', 2, 2], ['B3', 2, 3], ['D', 3, 1],
    ]);
  });

  it('a crop that returns no cards keeps the first-pass reads and is a failure', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [side(1, { cardCount: 2 }), fine(2)], cards: [read({ group: 1, title: null }), read({ group: 2, title: 'B' })] };
    const { deps } = stub(async () => okResult([]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.cards).toEqual(out.cards);
    expect(res.cropped).toEqual([]);
    expect(res.failed).toEqual([1]);
    expect(res.failures).toEqual([{ group: 1, code: 'empty_crop' }]);
    expect(res.costUsd).toBeCloseTo(0.003);
    expect(res.usage).toEqual({ inputTokens: 1000, outputTokens: 100 });
    expect(res.calls).toBe(1);
  });

  it('a repeated group id is cropped once and its reads are not duplicated', async () => {
    const out: DeckOutput = {
      photoQuality: 'ok',
      groups: [side(1, { cardCount: 2 }), side(1, { cardCount: 2 }), fine(2), fine(2)],
      cards: [read({ group: 1, title: 'A' }), read({ group: 2, title: 'D' })],
    };
    const { fn, deps } = stub(async () => okResult([read({ title: 'B1' }), read({ title: 'B2' })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(res.cropped).toEqual([1]);
    expect(res.cards.map(c => [c.title, c.group, c.position])).toEqual([['B1', 1, 1], ['B2', 1, 2], ['D', 2, 1]]);
  });

  it('a rotated group keeps every read', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [grp(1, { orientation: 'rotated_cw' })], cards: [read({ group: 1 })] };
    const outside: Box = [0.9, 0.1, 1, 0.2];
    const { deps } = stub(async () => okResult([read({ title: 'P', titleBox: outside }), read({ title: 'Q', titleBox: outside })]));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.cropped).toEqual([1]);
    expect(res.cards.map(c => c.title)).toEqual(['P', 'Q']);
    expect(res.cards.map(c => c.titleBox)).toEqual([null, null]); // the crop was turned, so its boxes are not in the photo's frame
  });

  it('a failed crop keeps the first-pass reads', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [side(1, { cardCount: 2 }), fine(2)], cards: [read({ group: 1, title: 'A' }), read({ group: 2, title: 'B' })] };
    const { deps } = stub(async () => ({ ok: false, code: 'recognizer_failed', detail: { message: 'unparseable output' }, latencyMs: 70, attempts: 2, usage: { inputTokens: 500, outputTokens: 50 }, costUsd: 0.0015 }));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.cards).toEqual(out.cards);
    expect(res.failed).toEqual([1]);
    expect(res.cropped).toEqual([]);
    expect(res.failures).toEqual([{ group: 1, code: 'recognizer_failed', detail: { message: 'unparseable output' } }]);
    expect(res.costUsd).toBeCloseTo(0.0015);
    expect(res.usage).toEqual({ inputTokens: 500, outputTokens: 50 });
    expect(res.calls).toBe(2);
  });

  it('a throw from crop is a failure, not a rejection', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [side(1, { cardCount: 2 }), needy(2)], cards: [read({ group: 1, title: 'A' })] };
    const { fn } = stub(async () => okResult([read({ title: 'Z' })]));
    const deps: CropPassDeps = {
      recognize: fn as unknown as typeof recognize,
      crop: async (_j, g) => { if (g.id === 1) throw new Error('bad extract'); return Buffer.alloc(1); },
    };
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.failed).toEqual([1]);
    expect(res.cropped).toEqual([2]);
    expect(res.failures[0].group).toBe(1);
    expect(res.failures[0].code).toBe('crop_failed');
    expect(res.cards.map(c => [c.title, c.group])).toEqual([['A', 1], ['Z', 2]]);
  });

  it('starts no crop once the deadline is too close, and never sends one under the minimum', async () => {
    // Four workers start at t=0 against a 70 s deadline; each recognize call advances the clock 20 s as it is made.
    // Groups 1-3 are sent with 70, 50 and 30 s left; group 4's crop finishes with 10 s left, so it is not sent;
    // groups 5-8 find 10 s left before cropping and are skipped.
    const out: DeckOutput = { photoQuality: 'ok', groups: Array.from({ length: 8 }, (_, i) => needy(i + 1)), cards: [] };
    let t = 0;
    const timeouts: number[] = [];
    const { fn } = stub(async (...args: unknown[]) => { timeouts.push((args[3] as typeof CROP_MODE).timeoutMs); t += 20_000; return okResult([read({ title: 'C' })]); });
    const crops = vi.fn(crop);
    const res = await runCropPass(JPEG, out, IMAGE, 70_000, { recognize: fn as unknown as typeof recognize, crop: crops, now: () => t });
    expect(res.cropped).toEqual([1, 2, 3]);
    expect(res.skipped).toEqual([4, 5, 6, 7, 8]);
    expect(crops).toHaveBeenCalledTimes(4);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(timeouts).toEqual([30_000, 30_000, 30_000]);
    expect(timeouts.every(ms => ms >= MIN_CROP_REMAINING_MS)).toBe(true);
    expect(res.latencyMs).toBe(60_000);
  });

  it('a group whose crop finishes under the minimum is skipped without a recognize call', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [needy(1)], cards: [read({ group: 1, title: null })] };
    let t = 0;
    const { fn } = stub(async () => okResult([read({ title: 'C' })]));
    const slowCrop = async () => { t = 20_000 - MIN_CROP_REMAINING_MS + 1; return Buffer.alloc(1); };
    const res = await runCropPass(JPEG, out, IMAGE, 20_000, { recognize: fn as unknown as typeof recognize, crop: slowCrop, now: () => t });
    expect(fn).not.toHaveBeenCalled();
    expect(res.skipped).toEqual([1]);
    expect(res.cropped).toEqual([]);
    expect(res.failed).toEqual([]);
    expect(res.cards).toEqual(out.cards);
  });

  it('a crop near the deadline gets a shortened timeout and no retry; under MIN_CROP_REMAINING_MS it is skipped', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [needy(1)], cards: [] };
    const { fn } = stub(async () => okResult([]));
    await runCropPass(JPEG, out, IMAGE, 20_000, { recognize: fn as unknown as typeof recognize, crop, now: () => 0 });
    const mode = fn.mock.calls[0][3] as typeof CROP_MODE;
    expect(mode).toMatchObject({ timeoutMs: 20_000, retryWithinMs: 0, instruction: CROP_MODE.instruction, schema: CROP_MODE.schema });

    fn.mockClear();
    const res = await runCropPass(JPEG, out, IMAGE, MIN_CROP_REMAINING_MS - 1, { recognize: fn as unknown as typeof recognize, crop, now: () => 0 });
    expect(MIN_CROP_REMAINING_MS).toBe(12_000);
    expect(fn).not.toHaveBeenCalled();
    expect(res.skipped).toEqual([1]);
  });

  it('cropCallTiming retries only when a full second attempt fits', () => {
    expect(cropCallTiming(140_000)).toEqual({ timeoutMs: 30_000, retryWithinMs: 15_000 });
    expect(cropCallTiming(50_000)).toEqual({ timeoutMs: 30_000, retryWithinMs: 15_000 });
    expect(cropCallTiming(40_000)).toEqual({ timeoutMs: 30_000, retryWithinMs: 8_000 });
    expect(cropCallTiming(20_000)).toEqual({ timeoutMs: 20_000, retryWithinMs: 0 });
    expect(cropCallTiming(5_000)).toEqual({ timeoutMs: 5_000, retryWithinMs: 0 });
  });

  it('sums usage, cost and calls across crops', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [needy(1), needy(2), needy(3)], cards: [] };
    const attempts = [1, 2, 1];
    let i = 0;
    const { deps } = stub(async () => okResult([], { attempts: attempts[i++] }));
    const res = await runCropPass(JPEG, out, IMAGE, soon(), deps);
    expect(res.calls).toBe(4);
    expect(res.usage).toEqual({ inputTokens: 3000, outputTokens: 300 });
    expect(res.costUsd).toBeCloseTo(0.009);
  });

  it('uses CROP_ARM at effort medium and a mode built on CROP_MODE with the prefix and 30 s timeout', async () => {
    const out: DeckOutput = { photoQuality: 'ok', groups: [needy(1)], cards: [] };
    const buf = Buffer.from([7]);
    const { fn } = stub(async () => okResult([]));
    await runCropPass(JPEG, out, IMAGE, soon(), { recognize: fn as unknown as typeof recognize, crop: async () => buf });
    const [jpeg, arm, rdeps, mode] = fn.mock.calls[0];
    expect(jpeg).toBe(buf);
    expect(arm).toEqual({ ...DECK_ARM, effort: 'medium' });
    expect(arm).toBe(CROP_ARM);
    expect(rdeps).toEqual({});
    expect(mode).toEqual({ ...CROP_MODE, timeoutMs: 30_000, retryWithinMs: 15_000 }); // a minute left: the base timing
    expect(CROP_MODE.instruction).toBe(CROP_PREFIX + DECK_INSTRUCTION);
    expect(CROP_MODE.timeoutMs).toBe(CROP_CALL_TIMEOUT_MS);
    expect(CROP_CALL_TIMEOUT_MS).toBe(30_000);
    expect(CROP_MODE.retryWithinMs).toBe(15_000);
    expect(CROP_MODE.schema).toBe(DECK_MODE.schema);
  });
});
