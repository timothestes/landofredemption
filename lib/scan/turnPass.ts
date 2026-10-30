import sharp from 'sharp';
import { rotationFor } from './crop';
import type { DeckGroup, DeckOutput } from './deckSchema';
import { DECK_ARM, DECK_MODE, recognize, type RecognizeMode, type RecognizeResult } from './recognize';

// Deck photos taken with the phone held across the layout come in a quarter turn off: every card lies sideways. Cropping
// each group re-reads overlapping strips and doubles cards, so the whole photo is turned upright and read again. Server only.

/** Cards in sideways groups of one direction, as a share of the photo's cards, for the photo to count as turned. */
export const TURN_SHARE = 0.75;
/** ...and at least this many of them: a sideways Reserve row (10 cards, 15 in Type 2) is not a turned photo. */
export const TURN_MIN_CARDS = 20;
/** The re-read is not started with less than this left before the deadline: a full read takes 45 to 70 s. */
export const TURN_MIN_REMAINING_MS = 60_000;

export type Turn = 0 | 90 | 180 | 270;

/** Clockwise degrees that turn the photo upright when nearly all its cards lie one way; 0 otherwise. Group 0 takes no part. */
export function wholePhotoTurn(groups: DeckGroup[]): Turn {
  const real = groups.filter(g => g.id !== 0);
  const total = real.reduce((n, g) => n + g.cardCount, 0);
  for (const o of ['rotated_cw', 'rotated_ccw', 'upside_down'] as const) {
    const cards = real.filter(g => g.orientation === o).reduce((n, g) => n + g.cardCount, 0);
    if (cards >= TURN_MIN_CARDS && cards >= TURN_SHARE * total) return rotationFor(o);
  }
  return 0;
}

/** The scan JPEG turned clockwise by `deg`, re-encoded as encodeForScan does; a quarter turn swaps the sides. */
export async function turnJpeg(jpeg: Buffer, deg: Turn): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(jpeg).rotate(deg).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

export interface TurnPassDeps { recognize?: typeof recognize; now?: () => number }

export interface TurnPassResult {
  /** Clockwise degrees the photo was turned before `output` was read; 0 when the first read stands. */
  rotation: Turn;
  output: DeckOutput;
  jpeg: Buffer;
  width: number;
  height: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  calls: number;
  failure: { code: string; detail?: unknown } | null;
}

/** Re-reads a turned photo upright before a hard deadline; any failure keeps the first read, and a billed call is still counted. */
export async function runTurnPass(jpeg: Buffer, first: DeckOutput, image: { width: number; height: number }, deadline: number, deps: TurnPassDeps = {}): Promise<TurnPassResult> {
  const rec = deps.recognize ?? recognize;
  const now = deps.now ?? Date.now;
  const kept: TurnPassResult = { rotation: 0, output: first, jpeg, ...image, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, calls: 0, failure: null };
  const turn = wholePhotoTurn(first.groups);
  if (turn === 0) return kept;
  const started = now();
  if (deadline - started < TURN_MIN_REMAINING_MS) return { ...kept, failure: { code: 'no_time' } };

  const turned = await turnJpeg(jpeg, turn);
  // Ends by the deadline: a retry only when a full second attempt (2 s sleep + timeoutMs) still fits.
  const remaining = deadline - now();
  const timeoutMs = Math.min(DECK_MODE.timeoutMs ?? remaining, remaining);
  const mode: RecognizeMode<DeckOutput> = { ...DECK_MODE, timeoutMs, retryWithinMs: Math.min(DECK_MODE.retryWithinMs, Math.max(0, remaining - 2_000 - timeoutMs)) };
  const r: RecognizeResult<DeckOutput> = await rec(turned.jpeg, DECK_ARM, {}, mode);
  const billed = {
    usage: { inputTokens: r.usage?.inputTokens ?? 0, outputTokens: r.usage?.outputTokens ?? 0 },
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : 0,
    latencyMs: now() - started,
    calls: r.attempts,
  };
  // tsconfig is strict:false, so `ok` does not narrow the union; `'code' in r` does.
  if ('code' in r) return { ...kept, ...billed, failure: { code: r.code, ...(r.detail !== undefined ? { detail: r.detail } : {}) } };
  // Groups with no cards still help: the crop pass re-reads groups the read listed short.
  if (r.output.groups.length === 0 && r.output.cards.length === 0) return { ...kept, ...billed, failure: { code: 'empty_read' } };
  return { rotation: turn, output: r.output, ...turned, ...billed, failure: null };
}
