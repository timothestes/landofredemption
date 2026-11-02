import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { wholePhotoTurn, turnJpeg, runTurnPass, TURN_MIN_REMAINING_MS, MAX_TURNS, type TurnPassDeps } from '../turnPass';
import { DECK_ARM, DECK_MODE, type recognize } from '../recognize';
import type { DeckGroup, DeckOutput, DeckRead } from '../deckSchema';

const grp = (id: number, orientation: DeckGroup['orientation'], cardCount: number): DeckGroup => ({ id, orientation, bbox: [0, 0, 1, 1], cardCount });
const read = (p: Partial<DeckRead> = {}): DeckRead => ({
  title: 'X', strength: null, toughness: null, type: 'unknown', brigade: null, reference: null, group: 1, position: 1, titleBox: null, confidence: 'high', ...p,
});
const out = (groups: DeckGroup[], cards: DeckRead[] = [read()]): DeckOutput => ({ photoQuality: 'ok', groups, cards });
const turnedPhoto = out([grp(1, 'rotated_cw', 30), grp(2, 'rotated_cw', 31)]);

describe('wholePhotoTurn', () => {
  it('turns a photo whose cards nearly all lie one way sideways', () => {
    expect(wholePhotoTurn([grp(1, 'rotated_cw', 20), grp(2, 'rotated_cw', 20), grp(3, 'rotated_cw', 21)])).toBe(270);
    expect(wholePhotoTurn([grp(1, 'rotated_ccw', 60)])).toBe(90);
    expect(wholePhotoTurn([grp(1, 'upside_down', 25), grp(2, 'upright', 5)])).toBe(180);
  });
  it('a sideways Reserve row, a mixed photo or a small one is not turned', () => {
    expect(wholePhotoTurn([grp(1, 'upright', 50), grp(2, 'rotated_ccw', 10)])).toBe(0);
    expect(wholePhotoTurn([grp(1, 'rotated_ccw', 35), grp(2, 'upright', 41)])).toBe(0);
    expect(wholePhotoTurn([grp(1, 'rotated_cw', 10), grp(2, 'rotated_cw', 9)])).toBe(0);
    expect(wholePhotoTurn([grp(1, 'rotated_cw', 30), grp(2, 'rotated_ccw', 30)])).toBe(0);
  });
  it('ignores group 0', () => expect(wholePhotoTurn([grp(0, 'upright', 500), grp(1, 'rotated_cw', 40)])).toBe(270));
});

describe('turnJpeg', () => {
  it('turns clockwise and swaps the sides on a quarter turn', async () => {
    const src = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const t = await turnJpeg(src, 90);
    expect([t.width, t.height]).toEqual([20, 40]);
    const m = await sharp(t.jpeg).metadata();
    expect([m.width, m.height, m.format]).toEqual([20, 40, 'jpeg']);
  });
});

describe('runTurnPass', () => {
  const IMAGE = { width: 40, height: 20 };
  const src = () => sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const ok = (o: DeckOutput) => ({ ok: true, output: o, model: 'claude-sonnet-5-5', usage: { inputTokens: 1000, outputTokens: 200 }, costUsd: 0.09, latencyMs: 40, attempts: 1 });
  const stub = (impl: (...a: unknown[]) => unknown) => { const fn = vi.fn(impl); return { fn, deps: { recognize: fn as unknown as typeof recognize } satisfies TurnPassDeps }; };
  const later = () => Date.now() + 120_000;

  it('re-reads a turned photo upright and returns the turned image and read', async () => {
    const upright = out([grp(1, 'upright', 61)], [read({ title: 'A' }), read({ title: 'B' })]);
    const { fn, deps } = stub(async () => ok(upright));
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, later(), deps);
    expect(fn).toHaveBeenCalledTimes(1);
    const [jpeg, arm, , mode] = fn.mock.calls[0] as [Buffer, unknown, unknown, typeof DECK_MODE];
    expect((await sharp(jpeg).metadata()).width).toBe(20);
    expect(arm).toEqual(DECK_ARM);
    expect(mode.instruction).toBe(DECK_MODE.instruction);
    expect(res.rotation).toBe(270);
    expect(res.output).toEqual(upright);
    expect([res.width, res.height]).toEqual([20, 40]);
    expect(res).toMatchObject({ calls: 1, costUsd: 0.09, usage: { inputTokens: 1000, outputTokens: 200 }, failure: null });
  });

  it('a re-read that is still turned (upside down) is turned once more from the original and read again', async () => {
    // Recorded on 20231121_094623: the first read said rotated_ccw, the 90° turn came back upside down with no cards.
    const upsideDown = out([grp(1, 'upside_down', 30), grp(2, 'upside_down', 30)], []);
    const upright = out([grp(1, 'upright', 61)], [read({ title: 'A' })]);
    const { fn, deps } = stub(async () => ok(upsideDown));
    fn.mockResolvedValueOnce(ok(upsideDown)).mockResolvedValueOnce(ok(upright));
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, later(), deps);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(res.rotation).toBe(90);
    expect(res.output).toEqual(upright);
    expect([res.width, res.height]).toEqual([20, 40]);
    expect(res).toMatchObject({ calls: 2, failure: null, usage: { inputTokens: 2000, outputTokens: 400 } });
    expect(res.costUsd).toBeCloseTo(0.18);
  });

  it(`turns at most ${MAX_TURNS} times`, async () => {
    const upsideDown = out([grp(1, 'upside_down', 61)], []);
    const { fn, deps } = stub(async () => ok(upsideDown));
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, later(), deps);
    expect(fn).toHaveBeenCalledTimes(MAX_TURNS);
    expect(res.rotation).toBe(90);
    expect(res.output).toEqual(upsideDown);
  });

  it('without time for a second turn, or when it fails, the first turned read stands', async () => {
    const upsideDown = out([grp(1, 'upside_down', 61)], [read()]);
    let t = 0;
    const slow = stub(async () => { t += 45_000; return ok(upsideDown); });
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, 100_000, { ...slow.deps, now: () => t });
    expect(slow.fn).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ rotation: 270, output: upsideDown, calls: 1, failure: { code: 'no_time' } });

    const failing = stub(async () => ok(upsideDown));
    failing.fn.mockResolvedValueOnce(ok(upsideDown)).mockResolvedValueOnce({ ok: false, code: 'recognizer_failed', attempts: 1, latencyMs: 5, costUsd: 0.01 });
    const res2 = await runTurnPass(await src(), turnedPhoto, IMAGE, later(), failing.deps);
    expect(res2).toMatchObject({ rotation: 270, output: upsideDown, calls: 2, failure: { code: 'recognizer_failed' } });
    expect(res2.costUsd).toBeCloseTo(0.1);
  });

  it('an upright photo makes no call', async () => {
    const { fn, deps } = stub(async () => ok(turnedPhoto));
    const first = out([grp(1, 'upright', 50), grp(2, 'rotated_ccw', 10)]);
    const jpeg = await src();
    const res = await runTurnPass(jpeg, first, IMAGE, later(), deps);
    expect(fn).not.toHaveBeenCalled();
    expect(res).toMatchObject({ rotation: 0, output: first, width: 40, height: 20, calls: 0, costUsd: 0, failure: null });
  });

  it('with too little time left it keeps the first read and makes no call', async () => {
    const { fn, deps } = stub(async () => ok(turnedPhoto));
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, Date.now() + TURN_MIN_REMAINING_MS - 1_000, deps);
    expect(fn).not.toHaveBeenCalled();
    expect(res).toMatchObject({ rotation: 0, output: turnedPhoto, failure: { code: 'no_time' } });
  });

  it('times the call to end by the deadline, retrying only when a second attempt fits', async () => {
    const { fn, deps } = stub(async () => ok(turnedPhoto));
    await runTurnPass(await src(), turnedPhoto, IMAGE, Date.now() + 70_000, deps);
    const mode = fn.mock.calls[0][3] as typeof DECK_MODE;
    expect(mode.timeoutMs).toBeLessThanOrEqual(70_000);
    expect(mode.timeoutMs).toBeGreaterThan(60_000);
    expect(mode.retryWithinMs).toBe(0);
  });

  it('a failed or empty re-read keeps the first read and still bills the call', async () => {
    const failing = stub(async () => ({ ok: false, code: 'recognizer_failed', attempts: 2, latencyMs: 9, usage: { inputTokens: 10, outputTokens: 0 }, costUsd: 0.01 }));
    const jpeg = await src();
    const res = await runTurnPass(jpeg, turnedPhoto, IMAGE, later(), failing.deps);
    expect(res).toMatchObject({ rotation: 0, output: turnedPhoto, width: 40, height: 20, calls: 2, costUsd: 0.01, failure: { code: 'recognizer_failed' } });

    const empty = stub(async () => ok(out([], [])));
    const res2 = await runTurnPass(jpeg, turnedPhoto, IMAGE, later(), empty.deps);
    expect(res2).toMatchObject({ rotation: 0, output: turnedPhoto, calls: 1, costUsd: 0.09, failure: { code: 'empty_read' } });
  });

  it('a re-read that lists groups but no cards is kept: the crop pass reads the groups', async () => {
    const groupsOnly = out([grp(1, 'upright', 30), grp(2, 'upright', 31)], []);
    const { deps } = stub(async () => ok(groupsOnly));
    const res = await runTurnPass(await src(), turnedPhoto, IMAGE, later(), deps);
    expect(res).toMatchObject({ rotation: 270, output: groupsOnly, failure: null });
  });
});
