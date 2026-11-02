// Server-only: do not import from "use client" files.
// scan_events writes, both through the service-role client. scan_reserve() is
// executable by service_role only (migration 122), so the caller passes the user id
// canScan verified and the source it decided; authenticated has no write grant at all.

export type ReserveResult =
  | { ok: true; id: string }
  | { ok: false; cap: string; limit: number; resetsAt: string };

/** Throws on an RPC error or a malformed reply: a reserve failure is never swallowed. */
export async function reserveScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { rpc: (fn: string, args?: any) => any },
  userId: string,
  source: 'player' | 'eval',
): Promise<ReserveResult> {
  const { data, error } = await admin.rpc('scan_reserve', { p_user: userId, p_source: source });
  if (error) throw new Error(`scan_reserve failed: ${error.message}`);
  if (data?.ok === true && typeof data.id === 'string') return { ok: true, id: data.id };
  if (data?.ok === false && typeof data.cap === 'string') {
    return { ok: false, cap: data.cap, limit: Number(data.limit), resetsAt: String(data.resets_at) };
  }
  throw new Error('scan_reserve returned an unexpected shape');
}

/** What the upload looked like and what each stage took, stored as scan_events.photo (migration 125). No image is kept. */
export interface PhotoFacts {
  bytes: number;
  /** EXIF-oriented size of the upload, its EXIF orientation tag (1 when none) and format. */
  width: number;
  height: number;
  orientation: number;
  format: string;
  /** The photo's size before the client resized it, when the client said. */
  original?: { width: number; height: number };
  /** The size the model read. */
  tier: { width: number; height: number };
  /** Deck mode: clockwise degrees the turn pass turned the photo (0 when it stood), and the crop pass's groups. */
  turn?: number;
  crops?: { cropped: number[]; failed: number[]; skipped: number[]; merged: number[] };
  /** Milliseconds: the encode, each model stage, and request start to finish. */
  ms: { encode: number; read?: number; turn?: number; crop?: number; ab?: number; total: number };
}

export interface FinishPatch {
  status: 'done' | 'failed';
  model?: string;
  attempts: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  photoQuality?: string;
  detections?: unknown[];
  mode?: 'collection' | 'deck';
  photo?: PhotoFacts;
}

/**
 * One UPDATE of the reserved row. Never throws: a failed write is logged and the
 * player still gets their scan (the row stays 'pending' and still counts toward caps).
 */
export async function finishScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: { from: (table: string) => any },
  id: string,
  patch: FinishPatch,
): Promise<void> {
  const row: Record<string, unknown> = { status: patch.status, attempts: patch.attempts, latency_ms: patch.latencyMs };
  if (patch.model !== undefined) row.model = patch.model;
  if (patch.inputTokens !== undefined) row.input_tokens = patch.inputTokens;
  if (patch.outputTokens !== undefined) row.output_tokens = patch.outputTokens;
  if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
  if (patch.photoQuality !== undefined) row.photo_quality = patch.photoQuality;
  if (patch.detections !== undefined) row.detections = patch.detections;
  if (patch.mode !== undefined) row.mode = patch.mode;
  if (patch.photo !== undefined) row.photo = patch.photo;
  try {
    const { error } = await admin.from('scan_events').update(row).eq('id', id);
    if (error) console.error(`[scan] finish ${id} failed:`, { error: error.message, ...spend(patch) });
  } catch (e) {
    console.error(`[scan] finish ${id} threw:`, { error: e, ...spend(patch) });
  }
}

/** What a lost finish write would have recorded, so the spend can be reconstructed from logs. */
function spend(p: FinishPatch) {
  return { status: p.status, costUsd: p.costUsd, inputTokens: p.inputTokens, outputTokens: p.outputTokens };
}
