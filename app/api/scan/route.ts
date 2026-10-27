import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { canScanForSession } from '@/lib/scan/gate';
import { encodeForScan, ScanImageError } from '@/lib/scan/image';
import { loadPriceMap } from '@/lib/scan/prices';
import { recognize, DEFAULT_ARM, type Arm } from '@/lib/scan/recognize';
import { matchDetection } from '@/lib/scan/match';
import { capDetection } from '@/lib/scan/schema';
import { reserveScan, finishScan, type FinishPatch } from '@/lib/scan/events';

// POST /api/scan: one photo in, matched detections out.
// Spec: docs/superpowers/specs/2026-10-26-card-scanner-design.md, "POST /api/scan" and "Reserve first, then call".
// Order: gate → body → reserve → encode → prices → recognize → match → finish.

export const runtime = 'nodejs';
export const maxDuration = 90;

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

/** A superuser's arm override: a JSON object of known keys with known values, merged onto the default. null if invalid. */
function parseArm(raw: string): Required<Arm> | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const arm: Record<string, unknown> = { ...DEFAULT_ARM };
  for (const [k, val] of Object.entries(v)) {
    const allowed = (ARM_VALUES as Record<string, readonly string[]>)[k];
    if (!allowed || typeof val !== 'string' || !allowed.includes(val)) return null;
    arm[k] = val;
  }
  return arm as Required<Arm>;
}

export async function POST(req: Request) {
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

  const { data: su, error: suError } = await supabase.rpc('is_superuser');
  const superuser = !suError && su === true;
  let arm: Required<Arm> = DEFAULT_ARM;
  let source: 'player' | 'eval' = 'player';
  if (superuser) {
    const rawArm = form.get('arm');
    if (typeof rawArm === 'string' && rawArm.length > 0) {
      const parsed = parseArm(rawArm);
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

  // From here every exit finishes the reserved row.
  const finish = (patch: FinishPatch) => {
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
  let spent: Omit<FinishPatch, 'status'> = { model: arm.model, attempts: 0, latencyMs: 0 };
  try {
    let jpeg: Buffer;
    try {
      ({ jpeg } = await encodeForScan(Buffer.from(await photo.arrayBuffer()), arm.tier));
    } catch (e) {
      if (!(e instanceof ScanImageError)) throw e;
      await finish({ status: 'failed', attempts: 0, latencyMs: 0 });
      return e.code === 'too_large'
        ? fail(413, 'too_large', 'The photo has too many pixels.')
        : fail(415, 'undecodable', 'That file is not a photo the scanner can read.');
    }

    const prices = await loadPriceMap();

    let r;
    try {
      r = await recognize(jpeg, arm);
    } catch (e) {
      console.error('[scan] recognizer threw:', e);
      await finish({ status: 'failed', model: arm.model, attempts: 0, latencyMs: 0 });
      return fail(502, 'recognizer_failed', 'The scanner could not read that photo.');
    }

    spent = {
      model: r.ok === false ? arm.model : r.model, attempts: r.attempts, latencyMs: r.latencyMs,
      inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens, costUsd: r.costUsd,
    };

    if (r.ok === false) {
      console.error('[scan] recognizer failed', { scanId, code: r.code, detail: r.detail });
      await finish({ status: 'failed', ...spent }); // billed failures keep their tokens and cost
      if (r.code === 'recognizer_failed') return fail(502, r.code, 'The scanner could not read that photo.');
      return fail(503, r.code, 'The scanner is busy. Try again shortly.', {
        retryAfter: r.retryAfterSeconds ?? DEFAULT_RETRY_AFTER[r.code],
      });
    }

    const detections = r.output.cards.map((card, i) => {
      const read = capDetection(card);
      const m = matchDetection(read, prices);
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
      status: 'done', model: r.model, attempts: r.attempts, latencyMs: r.latencyMs,
      inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: r.costUsd,
      photoQuality: r.output.photoQuality,
      detections: detections.map(({ candidates: _candidates, ...stored }) => stored),
    });

    return NextResponse.json({
      scanId,
      photoQuality: r.output.photoQuality,
      detections,
      usage: { model: r.model, latencyMs: r.latencyMs, attempts: r.attempts, ...(superuser ? { costUsd: r.costUsd } : {}) },
    });
  } catch (e) {
    // Unexpected (price load, sharp internals): never leave the row pending.
    console.error('[scan] unexpected failure:', e);
    await finish({ status: 'failed', ...spent });
    return fail(500, 'internal', 'Something went wrong.');
  }
}
