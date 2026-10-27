import { describe, expect, it, vi } from 'vitest';
import type { ClientOutcome, CommitPayload } from '../lib/outcomes';
import {
  runCommit, runUndo, validateCommitInput,
  type CommitDeps, type CommitRow, type StoredScan, type UndoDeps,
} from '../lib/commitCore';

const U = 'uuuuuuuu-0000-4000-8000-000000000001';
const OTHER = 'uuuuuuuu-0000-4000-8000-000000000002';
const S1 = '11111111-2222-4333-8444-555555555555';
const S2 = '22222222-2222-4333-8444-555555555555';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const C2 = 'cccccccc-0000-4000-8000-000000000002';
const KA = 'Moses|Pi|Moses (Pi)';
const KB = 'Aaron|Pi|Aaron (Pi)';

const tick = () => new Promise(r => setTimeout(r, 0));

const outcome = (id: string, finalKey: string | null, extra: Partial<ClientOutcome> = {}): ClientOutcome => ({
  id, finalKey, printingChanged: false, nameChanged: false, removed: false, removedAs: null, unresolved: false, ...extra,
});

const storedDet = (id: string, n = 0) => ({
  id, status: n ? 'check' : 'matched', nameReason: 'exact', printingReason: n ? 'printing_ambiguous' : 'only', scores: { s: n },
});

function scan(id: string, n: number, user = U, status = 'done'): StoredScan {
  return { id, user_id: user, status, detections: Array.from({ length: n }, (_, i) => storedDet(`${id}:${i}`, i)) };
}

/** In-memory store. insertCommit is atomic (single synchronous check-and-set). */
function makeWorld(scans: StoredScan[], userId = U) {
  const commits = new Map<string, CommitRow>();
  const collection = new Map<string, number>();
  const outcomes = new Map<string, { outcomes: unknown[]; commitId: string }>();
  let clock = 0;
  let mergeOk = true;
  const merge = vi.fn(async (rows: { card_name: string; card_set: string; card_img_file: string; quantity: number }[]) => {
    await tick();
    if (!mergeOk) return false;
    for (const r of rows) {
      const k = `${r.card_name}|${r.card_set}|${r.card_img_file}`;
      collection.set(k, (collection.get(k) ?? 0) + r.quantity);
    }
    return true;
  });
  const deps: CommitDeps = {
    userId,
    loadScans: async ids => scans.filter(s => ids.includes(s.id)),
    insertCommit: async row => {
      if (commits.has(row.commit_id)) return false;
      commits.set(row.commit_id, { ...row, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString(), result: null });
      return true;
    },
    getCommit: async id => commits.get(id) ?? null,
    deleteCommit: async id => { commits.delete(id); },
    merge,
    writeOutcomes: async (scanId, o, commitId) => { outcomes.set(scanId, { outcomes: o, commitId }); },
    storeResult: async (id, result) => { commits.get(id)!.result = result; },
  };
  const setQuantity = vi.fn(async (key: string, qty: number) => {
    if (qty === 0) collection.delete(key); else collection.set(key, qty);
  });
  const undoDeps: UndoDeps = {
    userId,
    getCommit: async id => commits.get(id) ?? null,
    hasLaterCommit: async (uid, createdAt) => [...commits.values()].some(c => c.user_id === uid && c.created_at > createdAt),
    claimUndo: async (id, result) => {
      const c = commits.get(id);
      if (!c || c.result?.undoneAt) return false;
      c.result = result;
      return true;
    },
    currentQuantities: async keys => Object.fromEntries(keys.map(k => [k, collection.get(k) ?? 0])),
    setQuantity,
  };
  return { deps, undoDeps, commits, collection, outcomes, merge, setQuantity, failMerge: () => { mergeOk = false; }, fixMerge: () => { mergeOk = true; } };
}

const payload = (): CommitPayload => ({
  rows: [{ key: KA, qty: 2 }, { key: KB, qty: 1 }],
  outcomesByScanId: {
    [S1]: [outcome(`${S1}:0`, KA), outcome(`${S1}:1`, KA, { printingChanged: true })],
    [S2]: [outcome(`${S2}:0`, KB), outcome(`${S2}:1`, null, { removed: true, removedAs: 'wrong' })],
  },
});

describe('runCommit', () => {
  it('commits once and returns added', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    const r = await runCommit(w.deps, C1, payload());
    expect(r).toEqual({ ok: true, commitId: C1, added: 3, scanIds: [S1, S2] });
    expect(w.collection.get(KA)).toBe(2);
    expect(w.collection.get(KB)).toBe(1);
    expect(w.commits.get(C1)!.deltas).toEqual({ [KA]: 2, [KB]: 1 });
    expect(w.commits.get(C1)!.result).toEqual(r);
  });

  it('replays a completed commit', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    const a = await runCommit(w.deps, C1, payload());
    const b = await runCommit(w.deps, C1, payload());
    expect(b).toEqual(a);
    expect(w.merge).toHaveBeenCalledTimes(1);
    expect(w.collection.get(KA)).toBe(2);
  });

  it('two concurrent commits add once', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    const [a, b] = await Promise.all([runCommit(w.deps, C1, payload()), runCommit(w.deps, C1, payload())]);
    expect(w.merge).toHaveBeenCalledTimes(1);
    const results = [a, b];
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => (r as { code?: string }).code === 'in_progress')).toHaveLength(1);
    const c = await runCommit(w.deps, C1, payload());
    expect(c).toEqual(results.find(r => r.ok));
    expect(w.collection.get(KA)).toBe(2);
  });

  it('refuses a scan owned by another user', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2, OTHER)]);
    expect(await runCommit(w.deps, C1, payload())).toEqual({ ok: false, code: 'bad_request' });
    expect(w.merge).not.toHaveBeenCalled();
    expect(w.commits.size).toBe(0);
  });

  it('refuses a scan that is not done or is missing', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2, U, 'pending')]);
    expect(await runCommit(w.deps, C1, payload())).toEqual({ ok: false, code: 'bad_request' });
    const w2 = makeWorld([scan(S1, 2)]);
    expect(await runCommit(w2.deps, C1, payload())).toEqual({ ok: false, code: 'bad_request' });
  });

  it('refuses outcomes that do not cover the stored detections', async () => {
    const w = makeWorld([scan(S1, 3), scan(S2, 2)]);
    expect(await runCommit(w.deps, C1, payload())).toEqual({ ok: false, code: 'bad_request' });
    const p = payload();
    p.outcomesByScanId[S1] = [outcome(`${S1}:0`, KA), outcome(`${S1}:0`, KA)];
    const w2 = makeWorld([scan(S1, 2), scan(S2, 2)]);
    expect(await runCommit(w2.deps, C1, p)).toEqual({ ok: false, code: 'bad_request' });
    expect(w.merge).not.toHaveBeenCalled();
    expect(w2.merge).not.toHaveBeenCalled();
  });

  it('refuses a commit id that belongs to another user', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    w.commits.set(C1, { commit_id: C1, user_id: OTHER, created_at: 'x', deltas: {}, result: null });
    expect(await runCommit(w.deps, C1, payload())).toEqual({ ok: false, code: 'bad_request' });
  });

  it('merge failure deletes the commit row so a retry proceeds', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    w.failMerge();
    expect(await runCommit(w.deps, C1, payload())).toEqual({ ok: false, code: 'commit_failed' });
    expect(w.commits.has(C1)).toBe(false);
    w.fixMerge();
    const r = await runCommit(w.deps, C1, payload());
    expect(r.ok).toBe(true);
    expect(w.collection.get(KA)).toBe(2);
  });

  it('enriches outcomes with stored status, reasons and scores', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    const p = payload();
    await runCommit(w.deps, C1, p);
    const s1 = w.outcomes.get(S1)!;
    expect(s1.commitId).toBe(C1);
    expect(s1.outcomes).toEqual([
      { ...p.outcomesByScanId[S1][0], status: 'matched', nameReason: 'exact', printingReason: 'only', scores: { s: 0 } },
      { ...p.outcomesByScanId[S1][1], status: 'check', nameReason: 'exact', printingReason: 'printing_ambiguous', scores: { s: 1 } },
    ]);
    expect((w.outcomes.get(S2)!.outcomes[1] as ClientOutcome).removedAs).toBe('wrong');
  });

  it('an outcome write error is not fatal', async () => {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    w.deps.writeOutcomes = async () => { throw new Error('boom'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await runCommit(w.deps, C1, payload())).ok).toBe(true);
    err.mockRestore();
  });
});

describe('runUndo', () => {
  async function committed(pre: Record<string, number> = {}) {
    const w = makeWorld([scan(S1, 2), scan(S2, 2)]);
    for (const [k, v] of Object.entries(pre)) w.collection.set(k, v);
    await runCommit(w.deps, C1, payload());
    return w;
  }

  it('undo subtracts deltas', async () => {
    const w = await committed({ [KA]: 4 });
    expect(w.collection.get(KA)).toBe(6);
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: true, removed: 3 });
    expect(w.collection.get(KA)).toBe(4);
    expect(w.collection.has(KB)).toBe(false);
    expect(w.commits.get(C1)!.result!.undoneAt).toBeTruthy();
  });

  it('undo twice subtracts once', async () => {
    const w = await committed({ [KA]: 4 });
    await runUndo(w.undoDeps, C1);
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: true, removed: 3 });
    expect(w.collection.get(KA)).toBe(4);
    expect(w.setQuantity).toHaveBeenCalledTimes(2);
  });

  it('concurrent undos subtract once', async () => {
    const w = await committed({ [KA]: 4 });
    const [a, b] = await Promise.all([runUndo(w.undoDeps, C1), runUndo(w.undoDeps, C1)]);
    expect(a).toEqual({ ok: true, removed: 3 });
    expect(b).toEqual({ ok: true, removed: 3 });
    expect(w.collection.get(KA)).toBe(4);
    expect(w.setQuantity).toHaveBeenCalledTimes(2);
  });

  it('undo clamps at zero and deletes', async () => {
    const w = await committed();
    w.collection.set(KA, 1); // player hand-edited down from 2
    w.commits.get(C1)!.deltas = { [KA]: 3 };
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: true, removed: 1 });
    expect(w.setQuantity).toHaveBeenCalledWith(KA, 0);
    expect(w.collection.has(KA)).toBe(false);
  });

  it('undo refused after a later commit', async () => {
    const w = await committed();
    await runCommit(w.deps, C2, payload());
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: false, code: 'superseded' });
    expect(w.collection.get(KA)).toBe(4);
  });

  it('undo of a missing, foreign or unfinished commit is not_found', async () => {
    const w = await committed();
    expect(await runUndo(w.undoDeps, C2)).toEqual({ ok: false, code: 'not_found' });
    expect(await runUndo({ ...w.undoDeps, userId: OTHER }, C1)).toEqual({ ok: false, code: 'not_found' });
    w.commits.get(C1)!.result = null;
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: false, code: 'not_found' });
  });

  it('a write failure after the claim is partial', async () => {
    const w = await committed();
    w.undoDeps.setQuantity = async () => { throw new Error('boom'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runUndo(w.undoDeps, C1)).toEqual({ ok: false, code: 'partial' });
    err.mockRestore();
  });
});

describe('validateCommitInput', () => {
  const known = (k: string) => k === KA || k === KB;
  const ok = () => payload();

  it('accepts a well-formed payload', () => {
    expect(validateCommitInput(C1, ok(), known)).toEqual(ok());
  });

  it('validator rejects unknown keys, qty 0 and 100, bad commitId, extra outcome fields', () => {
    expect(validateCommitInput('not-a-uuid', ok(), known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), rows: [{ key: 'Nope|X|Y', qty: 1 }] }, known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), rows: [{ key: KA, qty: 0 }] }, known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), rows: [{ key: KA, qty: 100 }] }, known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), rows: [{ key: KA, qty: 1.5 }] }, known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), rows: [] }, known)).toBeNull();
    const extra = ok();
    (extra.outcomesByScanId[S1][0] as unknown as Record<string, unknown>).evil = 1;
    expect(validateCommitInput(C1, extra, known)).toBeNull();
  });

  it('rejects outcome ids from another scan, bad types, non-uuid scan keys and uncovered rows', () => {
    const wrongScan = ok();
    wrongScan.outcomesByScanId[S1][0].id = `${S2}:0`;
    expect(validateCommitInput(C1, wrongScan, known)).toBeNull();
    const badType = ok();
    (badType.outcomesByScanId[S1][0] as unknown as Record<string, unknown>).removedAs = 'maybe';
    expect(validateCommitInput(C1, badType, known)).toBeNull();
    const missing = ok();
    delete (missing.outcomesByScanId[S1][0] as unknown as Record<string, unknown>).unresolved;
    expect(validateCommitInput(C1, missing, known)).toBeNull();
    expect(validateCommitInput(C1, { ...ok(), outcomesByScanId: { nope: [] } }, known)).toBeNull();
    const uncovered = ok();
    uncovered.outcomesByScanId[S2][0].finalKey = KA;
    expect(validateCommitInput(C1, uncovered, known)).toBeNull();
    const tooMany = ok();
    tooMany.outcomesByScanId[S1] = Array.from({ length: 41 }, (_, i) => outcome(`${S1}:${i}`, KA));
    expect(validateCommitInput(C1, tooMany, known)).toBeNull();
  });
});
