import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { canScanForSession } from '@/lib/scan/gate';
import { encodeForScan, ScanImageError, type ScanImage } from '@/lib/scan/image';
import { loadPriceMap } from '@/lib/scan/prices';
import { recognize, DEFAULT_ARM, DECK_ARM, DECK_MODE, type Arm } from '@/lib/scan/recognize';
import { matchDetection } from '@/lib/scan/match';
import { settleAbPairs } from '@/lib/scan/abCompare';
import { capDetection } from '@/lib/scan/schema';
import { DECK_DETECTION_CAP } from '@/lib/scan/deckSchema';
import { runCropPass } from '@/lib/scan/cropPass';
import { inferSidewaysRows } from '@/lib/scan/crop';
import { runTurnPass } from '@/lib/scan/turnPass';
import { deckReadToDetection, classifyDeckRead, type DeckDetection } from '@/lib/scan/deckClassify';
import { reserveScan, finishScan, type FinishPatch, type PhotoFacts } from '@/lib/scan/events';
import { COMMIT_LIMITS } from '@/app/collection/scan/lib/commitCore';

// POST /api/scan: one photo in, matched detections out.
// Spec: docs/superpowers/specs/2026-10-26-card-scanner-design.md, "POST /api/scan" and "Reserve first, then call".
// Order: gate → body → reserve → encode → prices → recognize → match → AB frame comparison → finish.
// mode=deck swaps the recognizer mode and arm, re-reads a turned photo upright and sideways or truncated groups from crops, classifies each read into a deck row, and skips the AB pass.

export const runtime = 'nodejs';
export const maxDuration = 150;

// Deck mode's crop pass ends by requestStart + this: 10 s under maxDuration for classify, match and finish.
const CROP_DEADLINE_MS = 140_000;

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const ARM_VALUES = {
  model: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  effort: ['low', 'medium', 'high'],
  tier: ['high', 'low'],
  thinking: ['default', 'off'],
} as const;
// Retry-After when Anthropic gives none.
const DEFAULT_RETRY_AFTER: Record<string, number> = { upstream_rate_limit: 30, upstream_overloaded: 30, billing_error: 3600 };

function fail(status: number, code: string, message: string, extra: { resetsAt?: string; limit?: number; retryAfter?: number } = {}) {
  const { retryAfter, ...rest } = extra;
  return NextResponse.json(
    { code, message, ...rest },
    { status, headers: retryAfter !== undefined ? { 'Retry-After': String(retryAfter) } : undefined },
  );
}

/** A superuser's arm override: a JSON object of known keys with known values, merged onto the mode's base arm. null if invalid. */
function parseArm(raw: string, base: Required<Arm>): Required<Arm> | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const arm: Record<string, unknown> = { ...base };
  for (const [k, val] of Object.entries(v)) {
    const allowed = (ARM_VALUES as Record<string, readonly string[]>)[k];
    if (!allowed || typeof val !== 'string' || !allowed.includes(val)) return null;
    arm[k] = val;
  }
  return arm as Required<Arm>;
}

/** The photo's size before the client resized it, from the originalWidth/originalHeight fields; null unless both are sane. */
function originalSize(form: FormData): { width: number; height: number } | null {
  const dim = (k: string) => {
    const v = form.get(k);
    const n = typeof v === 'string' ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null;
  };
  const width = dim('originalWidth');
  const height = dim('originalHeight');
  return width && height ? { width, height } : null;
}

export async function POST(req: Request) {
  const requestStart = Date.now();
  const supabase = await createClient();
  const { user, allowed } = await canScanForSession(supabase);
  if (!user) return fail(401, 'unauthorized', 'Sign in to scan cards.');
  if (!allowed) return fail(403, 'forbidden', 'The scanner is not open to this account yet.');

  // Body only after the gate.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'bad_request', 'Expected multipart/form-data.');
  }
  const photo = form.get('photo');
  if (!(photo instanceof File)) return fail(400, 'bad_request', 'A photo file is required.');
  if (photo.size > MAX_PHOTO_BYTES) return fail(413, 'too_large', 'The photo is over 3 MB.');
  const rawMode = form.get('mode');
  if (rawMode !== null && rawMode !== 'collection' && rawMode !== 'deck') return fail(400, 'bad_request', 'mode must be collection or deck.');
  const mode: 'collection' | 'deck' = rawMode === 'deck' ? 'deck' : 'collection';

  const { data: su, error: suError } = await supabase.rpc('is_superuser');
  const superuser = !suError && su === true;
  // Collection scans rely on the column default: migration 124 (mode) may not be on prod yet, so only deck scans write it.
  const dbMode = mode === 'deck' ? { mode } : {};
  let arm: Required<Arm> = mode === 'deck' ? DECK_ARM : DEFAULT_ARM;
  let source: 'player' | 'eval' = 'player';
  if (superuser) {
    const rawArm = form.get('arm');
    if (typeof rawArm === 'string' && rawArm.length > 0) {
      const parsed = parseArm(rawArm, arm);
      if (!parsed) return fail(400, 'bad_request', 'arm must be a JSON object of model, effort, tier, thinking.');
      arm = parsed;
      source = 'eval'; // an arm override is an experiment: never a player row
    }
    if (form.get('source') === 'eval') source = 'eval';
  }

  let reserved;
  try {
    // Service role only (migration 122): the gate above is what admits the user.
    reserved = await reserveScan(getSupabaseAdmin(), user.id, source);
  } catch (e) {
    console.error('[scan] reserve failed:', e);
    return fail(503, 'reserve_failed', 'The scanner could not start. Try again shortly.');
  }
  if (reserved.ok === false) {
    const { cap, limit, resetsAt } = reserved;
    if (cap.startsWith('cap_user_')) return fail(429, cap, 'Scan limit reached.', { resetsAt, limit });
    const seconds = Math.max(1, Math.ceil((Date.parse(resetsAt) - Date.now()) / 1000));
    return fail(503, cap, 'The scanner is paused.', { resetsAt, limit, retryAfter: Number.isFinite(seconds) ? seconds : 3600 });
  }
  const scanId = reserved.id;

  // What the upload looked like and what each stage took (scan_events.photo), from the moment the photo is decoded.
  let facts: PhotoFacts | undefined;
  // From here every exit finishes the reserved row, with the photo facts gathered so far.
  const finish = (patch: FinishPatch) => {
    if (facts) {
      facts.ms.total = Date.now() - requestStart;
      patch = { ...patch, photo: facts };
    }
    let admin;
    try {
      admin = getSupabaseAdmin();
    } catch (e) {
      console.error(`[scan] finish ${scanId}: no admin client:`, e);
      return Promise.resolve();
    }
    return finishScan(admin, scanId, patch);
  };

  // What the recognizer billed, so even an unexpected throw after it records the spend.
  let spent: Omit<FinishPatch, 'status'> = { model: arm.model, attempts: 0, latencyMs: 0, ...dbMode };
  try {
    const upload = Buffer.from(await photo.arrayBuffer());
    let jpeg: Buffer;
    let width: number;
    let height: number;
    let source: ScanImage['source'];
    const encodeStart = Date.now();
    try {
      ({ jpeg, width, height, source } = await encodeForScan(upload, arm.tier));
    } catch (e) {
      if (!(e instanceof ScanImageError)) throw e;
      await finish({ status: 'failed', attempts: 0, latencyMs: 0, ...dbMode });
      return e.code === 'too_large'
        ? fail(413, 'too_large', 'The photo has too many pixels.')
        : fail(415, 'undecodable', 'That file is not a photo the scanner can read.');
    }
    const original = originalSize(form);
    facts = {
      bytes: photo.size, width: source.width, height: source.height, orientation: source.orientation, format: source.format,
      ...(original ? { original } : {}),
      tier: { width, height },
      ms: { encode: Date.now() - encodeStart, total: 0 },
    };

    const prices = await loadPriceMap();

    let r;
    try {
      r = mode === 'deck' ? await recognize(jpeg, arm, {}, DECK_MODE) : await recognize(jpeg, arm);
    } catch (e) {
      console.error('[scan] recognizer threw:', e);
      await finish({ status: 'failed', model: arm.model, attempts: 0, latencyMs: 0, ...dbMode });
      return fail(502, 'recognizer_failed', 'The scanner could not read that photo.');
    }

    spent = {
      model: r.ok === false ? arm.model : r.model, attempts: r.attempts, latencyMs: r.latencyMs,
      inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens, costUsd: r.costUsd, ...dbMode,
    };
    facts.ms.read = r.latencyMs;

    if (r.ok === false) {
      console.error('[scan] recognizer failed', { scanId, code: r.code, detail: r.detail });
      await finish({ status: 'failed', ...spent }); // billed failures keep their tokens and cost
      if (r.code === 'too_many_cards') return fail(422, r.code, 'Too many cards for one photo.');
      if (r.code === 'recognizer_failed') return fail(502, r.code, 'The scanner could not read that photo.');
      return fail(503, r.code, 'The scanner is busy. Try again shortly.', {
        retryAfter: r.retryAfterSeconds ?? DEFAULT_RETRY_AFTER[r.code],
      });
    }

    if (mode === 'deck' && 'groups' in r.output) {
      // A photo turned a quarter off is read again upright; from here on the image, groups and boxes are the turned ones.
      const tp = await runTurnPass(upload, r.output, { width, height }, requestStart + CROP_DEADLINE_MS);
      if (tp.failure) console.error('[scan] turn failed', { scanId, ...tp.failure });
      ({ width, height } = tp);
      facts.turn = tp.rotation;
      facts.ms.turn = tp.latencyMs;
      const out = { ...tp.output, groups: inferSidewaysRows(tp.output.groups, width, height) };
      // Crops are cut from the upload, turned as the read was, not from the JPEG the model read.
      const cp = await runCropPass({ upload, turn: tp.rotation }, out, { width, height }, requestStart + CROP_DEADLINE_MS);
      for (const { group, code, detail } of cp.failures) console.error('[scan] crop failed', { scanId, group, code, detail });
      facts.crops = { cropped: cp.cropped, failed: cp.failed, skipped: cp.skipped, merged: cp.merged };
      facts.ms.crop = cp.latencyMs;
      const usage = {
        inputTokens: r.usage.inputTokens + tp.usage.inputTokens + cp.usage.inputTokens,
        outputTokens: r.usage.outputTokens + tp.usage.outputTokens + cp.usage.outputTokens,
      };
      const costUsd = r.costUsd + tp.costUsd + cp.costUsd;
      const latencyMs = r.latencyMs + tp.latencyMs + cp.latencyMs;
      const attempts = r.attempts + tp.calls + cp.calls;
      spent = { ...spent, ...usage, costUsd, latencyMs, attempts };
      const reads = cp.cards.slice(0, DECK_DETECTION_CAP);
      const detections: DeckDetection[] = reads.map((deckRead, i) => {
        const read = capDetection(deckReadToDetection(deckRead));
        const m = matchDetection(read, prices);
        const c = classifyDeckRead(deckRead, m);
        return {
          id: `${scanId}:${i}`,
          group: deckRead.group,
          position: deckRead.position,
          titleBox: deckRead.titleBox,
          read,
          status: m.status,
          nameReason: m.nameReason,
          printingReason: m.printingReason,
          chosenKey: m.chosen?.key ?? null,
          kind: c.kind,
          deckKey: c.key,
          ...(c.identityCandidates ? { identityCandidates: c.identityCandidates } : {}),
          ...(m.near ? { near: m.near } : {}),
          scores: m.scores,
          candidates: m.candidates,
        };
      });
      await finish({
        status: 'done', model: r.model, attempts, latencyMs,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd,
        photoQuality: out.photoQuality, ...dbMode,
        detections: detections.map(({ candidates: _candidates, ...stored }) => stored),
      });
      return NextResponse.json({
        scanId,
        mode,
        photoQuality: out.photoQuality,
        rotation: tp.rotation,
        imageSize: { width, height },
        groups: out.groups.filter(g => !cp.merged.includes(g.id)),
        detections,
        crops: { cropped: cp.cropped, failed: cp.failed, skipped: cp.skipped, merged: cp.merged },
        usage: { model: r.model, latencyMs, attempts, ...(superuser ? { costUsd } : {}) },
      });
    }

    // Capped at what a commit accepts per scan, so a dense photo can always be added.
    const reads = r.output.cards.slice(0, COMMIT_LIMITS.detectionsPerScan).map(capDetection);
    const ab = await settleAbPairs(jpeg, reads, reads.map((read) => matchDetection(read, prices)), arm);
    if (ab.detail) console.error('[scan] AB comparison failed', { scanId, detail: ab.detail });
    facts.ms.ab = ab.latencyMs;
    const usage = { inputTokens: r.usage.inputTokens + ab.usage.inputTokens, outputTokens: r.usage.outputTokens + ab.usage.outputTokens };
    const costUsd = r.costUsd + ab.costUsd;
    const latencyMs = r.latencyMs + ab.latencyMs;
    spent = { ...spent, ...usage, costUsd, latencyMs };

    const detections = ab.matches.map((m, i) => {
      const read = reads[i];
      return {
        id: `${scanId}:${i}`,
        grid: read.grid,
        orientation: read.orientation,
        read,
        status: m.status,
        nameReason: m.nameReason,
        printingReason: m.printingReason,
        chosenKey: m.chosen?.key ?? null,
        scores: m.scores,
        candidates: m.candidates,
      };
    });

    await finish({
      status: 'done', model: r.model, attempts: r.attempts, latencyMs,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd,
      photoQuality: r.output.photoQuality, ...dbMode,
      detections: detections.map(({ candidates: _candidates, ...stored }) => stored),
    });

    return NextResponse.json({
      scanId,
      mode,
      photoQuality: r.output.photoQuality,
      detections,
      usage: { model: r.model, latencyMs, attempts: r.attempts, ...(superuser ? { costUsd } : {}) },
    });
  } catch (e) {
    // Unexpected (price load, sharp internals): never leave the row pending.
    console.error('[scan] unexpected failure:', e);
    await finish({ status: 'failed', ...spent });
    return fail(500, 'internal', 'Something went wrong.');
  }
}
