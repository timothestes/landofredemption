// Server-only: do not import from "use client" files.
// scan_events writes. Reserve goes through the user's own client (scan_reserve()
// reads auth.uid()); finish goes through the service-role client because
// authenticated has no UPDATE grant on scan_events (migration 122).

export type ReserveResult =
  | { ok: true; id: string }
  | { ok: false; cap: string; limit: number; resetsAt: string };

/** Throws on an RPC error or a malformed reply: a reserve failure is never swallowed. */
export async function reserveScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { rpc: (fn: string, args?: any) => any },
  source: 'player' | 'eval',
): Promise<ReserveResult> {
  const { data, error } = await supabase.rpc('scan_reserve', { p_source: source });
  if (error) throw new Error(`scan_reserve failed: ${error.message}`);
  if (data?.ok === true && typeof data.id === 'string') return { ok: true, id: data.id };
  if (data?.ok === false && typeof data.cap === 'string') {
    return { ok: false, cap: data.cap, limit: Number(data.limit), resetsAt: String(data.resets_at) };
  }
  throw new Error('scan_reserve returned an unexpected shape');
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
  try {
    const { error } = await admin.from('scan_events').update(row).eq('id', id);
    if (error) console.error(`[scan] finish ${id} failed:`, error.message);
  } catch (e) {
    console.error(`[scan] finish ${id} threw:`, e);
  }
}
