// Card scanner commit and undo, storage-agnostic. The server actions in
// app/collection/actions.ts wire these to Supabase; tests use in-memory fakes.
// No "use server": this module exports types and sync functions.
import type { ClientOutcome, CommitPayload } from './outcomes';

export type CommitResult =
  | { ok: true; commitId: string; added: number; scanIds: string[] }
  | { ok: false; code: 'unauthorized' | 'bad_request' | 'in_progress' | 'commit_failed' | 'already_committed' };
export type UndoResult =
  | { ok: true; removed: number }
  | { ok: false; code: 'unauthorized' | 'not_found' | 'superseded' | 'partial' | 'undo_failed' };

export interface StoredScan {
  id: string;
  user_id: string;
  status: string;
  detections: Array<{ id: string; status: string; nameReason: string; printingReason: string; scores: unknown }> | null;
  commit_id: string | null;
}
export interface CommitRow {
  commit_id: string;
  user_id: string;
  created_at: string;
  deltas: Record<string, number>;
  result: (CommitResult & { undoneAt?: string; removed?: number }) | null;
}
export interface CommitDeps {
  userId: string;
  loadScans(ids: string[]): Promise<StoredScan[]>;
  /** false on conflict (the commit id already exists). Must be atomic. */
  insertCommit(row: { commit_id: string; user_id: string; deltas: Record<string, number> }): Promise<boolean>;
  getCommit(id: string): Promise<CommitRow | null>;
  deleteCommit(id: string): Promise<void>;
  /**
   * Atomically set scan_events.commit_id = commitId on the caller's scans in
   * scanIds whose commit_id is null, equals commitId, or is one of undoneIds.
   * Returns how many rows were claimed.
   */
  claimScans(commitId: string, scanIds: string[], undoneIds: string[]): Promise<number>;
  /** Set commit_id back to null on the caller's scans claimed by commitId. */
  releaseScans(commitId: string): Promise<void>;
  merge(rows: { card_name: string; card_set: string; card_img_file: string; quantity: number }[]): Promise<boolean>;
  writeOutcomes(scanId: string, outcomes: unknown[], commitId: string): Promise<void>;
  storeResult(id: string, result: CommitResult): Promise<void>;
}
export interface UndoDeps {
  userId: string;
  getCommit(id: string): Promise<CommitRow | null>;
  hasLaterCommit(userId: string, createdAt: string): Promise<boolean>;
  /** Conditional on result.undoneAt being null; false if already claimed. */
  claimUndo(id: string, result: CommitRow['result']): Promise<boolean>;
  currentQuantities(keys: string[]): Promise<Record<string, number>>;
  /** qty 0 deletes the row. */
  setQuantity(key: string, qty: number): Promise<void>;
}

export const COMMIT_LIMITS = { rows: 500, qty: 99, scans: 200, detectionsPerScan: 150 };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KEY_LENGTH = 300;
const knownKey = (k: unknown, isKnownKey: (k: string) => boolean): k is string =>
  typeof k === 'string' && k.length <= MAX_KEY_LENGTH && isKnownKey(k);
const OUTCOME_FIELDS = ['id', 'finalKey', 'printingChanged', 'nameChanged', 'removed', 'removedAs', 'unresolved'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function validOutcome(o: unknown, scanId: string): o is ClientOutcome {
  if (!isObj(o)) return false;
  const keys = Object.keys(o);
  if (keys.length !== OUTCOME_FIELDS.length || !OUTCOME_FIELDS.every(f => Object.prototype.hasOwnProperty.call(o, f))) return false;
  return typeof o.id === 'string' && o.id.startsWith(`${scanId}:`)
    && (o.finalKey === null || typeof o.finalKey === 'string')
    && typeof o.printingChanged === 'boolean'
    && typeof o.nameChanged === 'boolean'
    && typeof o.removed === 'boolean'
    && (o.removedAs === null || o.removedAs === 'wrong' || o.removedAs === 'unwanted')
    && typeof o.unresolved === 'boolean';
}

/** Returns a clean copy of the payload, or null if anything is off. */
export function validateCommitInput(
  commitId: unknown, payload: unknown, isKnownKey: (k: string) => boolean,
): CommitPayload | null {
  if (typeof commitId !== 'string' || !UUID.test(commitId)) return null;
  if (!isObj(payload)) return null;
  const { rows, outcomesByScanId } = payload;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > COMMIT_LIMITS.rows) return null;
  if (!isObj(outcomesByScanId)) return null;

  const cleanRows: CommitPayload['rows'] = [];
  for (const r of rows) {
    if (!isObj(r) || !knownKey(r.key, isKnownKey)) return null;
    if (typeof r.qty !== 'number' || !Number.isInteger(r.qty) || r.qty < 1 || r.qty > COMMIT_LIMITS.qty) return null;
    cleanRows.push({ key: r.key, qty: r.qty });
  }

  const scanIds = Object.keys(outcomesByScanId);
  if (scanIds.length > COMMIT_LIMITS.scans) return null;
  const cleanOutcomes: Record<string, ClientOutcome[]> = {};
  const finalKeys = new Set<string>();
  for (const scanId of scanIds) {
    if (!UUID.test(scanId)) return null;
    const list = outcomesByScanId[scanId];
    if (!Array.isArray(list) || list.length > COMMIT_LIMITS.detectionsPerScan) return null;
    const clean: ClientOutcome[] = [];
    for (const o of list) {
      if (!validOutcome(o, scanId)) return null;
      if (o.finalKey !== null && !knownKey(o.finalKey, isKnownKey)) return null;
      clean.push({
        id: o.id, finalKey: o.finalKey, printingChanged: o.printingChanged, nameChanged: o.nameChanged,
        removed: o.removed, removedAs: o.removedAs, unresolved: o.unresolved,
      });
      if (o.finalKey !== null) finalKeys.add(o.finalKey);
    }
    cleanOutcomes[scanId] = clean;
  }
  if (!cleanRows.every(r => finalKeys.has(r.key))) return null;
  return { rows: cleanRows, outcomesByScanId: cleanOutcomes };
}

/** R4: every scan is the caller's, done, and its outcome ids are exactly its detection ids. */
function scansMatch(userId: string, scans: StoredScan[], p: CommitPayload): boolean {
  const byId = new Map(scans.map(s => [s.id, s]));
  for (const [scanId, outcomes] of Object.entries(p.outcomesByScanId)) {
    const s = byId.get(scanId);
    if (!s || s.user_id !== userId || s.status !== 'done') return false;
    const stored = (s.detections ?? []).map(d => d.id).sort();
    const sent = outcomes.map(o => o.id).sort();
    if (stored.length !== sent.length || stored.some((id, i) => id !== sent[i])) return false;
  }
  return true;
}

export function splitKey(key: string) {
  const [card_name, card_set, card_img_file] = key.split('|');
  return { card_name, card_set, card_img_file };
}

export async function runCommit(deps: CommitDeps, commitId: string, p: CommitPayload): Promise<CommitResult> {
  const scanIds = Object.keys(p.outcomesByScanId);
  const deltas: Record<string, number> = {};
  for (const r of p.rows) deltas[r.key] = (deltas[r.key] ?? 0) + r.qty;

  let scans: StoredScan[];
  const undoneIds: string[] = [];
  try {
    scans = await deps.loadScans(scanIds);
    if (!scansMatch(deps.userId, scans, p)) return { ok: false, code: 'bad_request' };

    // Scans already claimed by another commit are claimable again only if that commit was undone.
    const foreign = [...new Set(scans.map(s => s.commit_id).filter((c): c is string => !!c && c !== commitId))];
    for (const cid of foreign) {
      const c = await deps.getCommit(cid);
      if (c && c.user_id === deps.userId && c.result?.undoneAt) undoneIds.push(cid);
    }

    const inserted = await deps.insertCommit({ commit_id: commitId, user_id: deps.userId, deltas });
    if (!inserted) {
      const existing = await deps.getCommit(commitId);
      if (!existing) return { ok: false, code: 'in_progress' }; // deleted by a failed merge between our two calls
      if (existing.user_id !== deps.userId) return { ok: false, code: 'bad_request' };
      if (existing.result) {
        const { undoneAt: _u, removed: _r, ...result } = existing.result;
        return result as CommitResult;
      }
      return { ok: false, code: 'in_progress' };
    }
  } catch (e) {
    console.error('[scan commit] before claim', e);
    return { ok: false, code: 'commit_failed' };
  }

  // Release before delete: scan_events.commit_id references scan_commits.
  const unwind = async (why: string) => {
    try {
      await deps.releaseScans(commitId);
      await deps.deleteCommit(commitId);
    } catch (e) { console.error('[scan commit] unwind after', why, e); }
  };

  // A scan adds its cards once: a fresh commit id cannot re-add scans another live commit holds.
  let claimed = 0;
  try {
    claimed = await deps.claimScans(commitId, scanIds, undoneIds);
  } catch (e) {
    console.error('[scan commit] claim scans', e);
    await unwind('claim error');
    return { ok: false, code: 'commit_failed' };
  }
  if (claimed < scanIds.length) {
    await unwind('partial claim');
    return { ok: false, code: 'already_committed' };
  }

  // R5: a failed merge must not leave a row that makes every retry "in progress".
  let merged = false;
  try {
    merged = await deps.merge(Object.entries(deltas).map(([key, quantity]) => ({ ...splitKey(key), quantity })));
  } catch (e) {
    console.error('[scan commit] merge threw', e);
  }
  if (!merged) {
    await unwind('failed merge');
    return { ok: false, code: 'commit_failed' };
  }

  const result: CommitResult = { ok: true, commitId, added: p.rows.reduce((n, r) => n + r.qty, 0), scanIds };
  try { await deps.storeResult(commitId, result); } catch (e) { console.error('[scan commit] store result', e); }

  // R3: outcomes carry the stored read alongside the player's correction.
  const byScan = new Map(scans.map(s => [s.id, new Map((s.detections ?? []).map(d => [d.id, d]))]));
  for (const scanId of scanIds) {
    const dets = byScan.get(scanId)!;
    const enriched = p.outcomesByScanId[scanId].map(o => {
      const d = dets.get(o.id)!;
      return { ...o, status: d.status, nameReason: d.nameReason, printingReason: d.printingReason, scores: d.scores };
    });
    try { await deps.writeOutcomes(scanId, enriched, commitId); } catch (e) { console.error('[scan commit] outcomes write', scanId, e); }
  }
  return result;
}

export async function runUndo(deps: UndoDeps, commitId: string): Promise<UndoResult> {
  let next: Record<string, number>;
  let removed: number;
  try {
    const c = await deps.getCommit(commitId);
    if (!c || c.user_id !== deps.userId || c.result?.ok !== true) return { ok: false, code: 'not_found' };
    if (c.result.undoneAt) return { ok: true, removed: c.result.removed ?? 0 };
    if (await deps.hasLaterCommit(deps.userId, c.created_at)) return { ok: false, code: 'superseded' };

    const keys = Object.keys(c.deltas);
    const current = await deps.currentQuantities(keys);
    next = {};
    removed = 0;
    for (const k of keys) {
      const cur = current[k] ?? 0;
      next[k] = Math.max(0, cur - c.deltas[k]);
      removed += cur - next[k];
    }

    const claimed = await deps.claimUndo(commitId, { ...c.result, undoneAt: new Date().toISOString(), removed });
    if (!claimed) {
      const again = await deps.getCommit(commitId);
      return { ok: true, removed: again?.result?.removed ?? 0 };
    }
  } catch (e) {
    console.error('[scan undo] before claim', e);
    return { ok: false, code: 'undo_failed' };
  }

  // R6: the claim is recorded; a failure here leaves some keys unrestored.
  try {
    for (const [k, q] of Object.entries(next)) await deps.setQuantity(k, q);
  } catch (e) {
    console.error('[scan undo] partial', commitId, e);
    return { ok: false, code: 'partial' };
  }
  return { ok: true, removed };
}
