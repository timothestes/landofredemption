import { describe, expect, it } from 'vitest';
import { countedRows, initialTray, isEditable, rehydrateTray, trayReducer, trayTotals, type TrayAction, type TrayState } from '../lib/trayReducer';
import { buildCommitPayload } from '../lib/outcomes';
import { cand, det, resp } from './fixtures';

const run = (s: TrayState, ...as: TrayAction[]) => as.reduce(trayReducer, s);
const S2 = 'aaaaaaaa-2222-3333-4444-555555555555';

describe('trayReducer', () => {
  it('photoDone adds one row per detection in grid order', () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { row: 1, col: 0 }), det(2, { row: 0, col: 1 }), det(3, { row: 0, col: 0 })]) });
    expect(s.rows.map(r => r.rowId.split(':')[1])).toEqual(['3', '2', '1']);
    expect(s.rows.every(r => r.qty === 1)).toBe(true);
  });

  it('duplicate key from a later photo increments the earlier row', () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'X' })]) },
      { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'X', scan: S2 })], S2) });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].qty).toBe(2);
    expect(s.rows[0].sources).toHaveLength(2);
    expect(s.rows.some(r => r.photoId === 'p2')).toBe(false);
  });

  it('setKey via candidates marks printing, via search marks name, back to chosenKey clears', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'A' })]) });
    const rowId = s.rows[0].rowId;
    s = run(s, { type: 'setKey', rowId, key: 'B', via: 'candidates' });
    expect(s.rows[0].corrected).toBe('printing');
    s = run(s, { type: 'setKey', rowId, key: 'C', via: 'search', candidates: [cand('C', null)] });
    expect(s.rows[0].corrected).toBe('name');
    s = run(s, { type: 'setKey', rowId, key: 'A', via: 'candidates' });
    expect(s.rows[0].corrected).toBe('none');
  });

  it('photoDone during committing does not change rows', () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'A' })]) },
      { type: 'commitStarted', commitId: 'c1' });
    const after = run(s, { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'B', scan: S2 })], S2) });
    expect(after.rows).toBe(s.rows);
    expect(after.photos.find(p => p.photoId === 'p2')?.status).toBe('done');
  });

  it('photoDone after committed does not change rows', () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'A' })]) },
      { type: 'commitStarted', commitId: 'c1' },
      { type: 'commitDone', commitId: 'c1', added: 1, scanIds: ['x'] });
    const after = run(s, { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'A', scan: S2 })], S2) });
    expect(after.rows).toBe(s.rows);
    expect(after.rows[0].qty).toBe(1);
  });

  it('not_found resolved by search counts and is name-corrected', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: null })]) });
    expect(countedRows(s)).toHaveLength(0);
    s = run(s, { type: 'setKey', rowId: s.rows[0].rowId, key: 'Z', via: 'search', candidates: [cand('Z', 1)] });
    expect(countedRows(s)).toHaveLength(1);
    expect(s.rows[0].corrected).toBe('name');
  });

  it('trayTotals counts unpriced and unresolved', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([
        det(1, { chosenKey: 'A' }), det(2, { chosenKey: 'B', candidates: [cand('B', null)] }), det(3, { chosenKey: null })]) });
    s = run(s, { type: 'setQty', rowId: s.rows[0].rowId, qty: 2 });
    expect(trayTotals(s)).toEqual({ cards: 3, rows: 2, priced: 7, unpriced: 1, unresolved: 1, toCheck: 0 });
    // A search pick made before the price map loaded is priced from the map at render.
    expect(trayTotals(s, k => (k === 'B' ? 2 : null))).toMatchObject({ priced: 9, unpriced: 0 });
  });

  it('a Check read never merges into another row, and counts as to-check until the player picks', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'X' })]) },
      { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'X', status: 'check', printingReason: 'printing_ambiguous', scan: S2 })], S2) });
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].qty).toBe(1);
    expect(trayTotals(s).toCheck).toBe(1);
    // Confirming our own guess in the picker settles it.
    s = run(s, { type: 'setKey', rowId: s.rows[1].rowId, key: 'X', via: 'candidates' });
    expect(trayTotals(s).toCheck).toBe(0);
    expect(s.rows[1].corrected).toBe('none');
  });

  it('two Check reads with the same guess stay separate rows', () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'X', status: 'check' })]) },
      { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'X', status: 'check', scan: S2 })], S2) });
    expect(s.rows).toHaveLength(2);
  });

  it('a removed row can be restored', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1)]) });
    s = run(s, { type: 'removeRow', rowId: s.rows[0].rowId, as: 'wrong' });
    expect(countedRows(s)).toHaveLength(0);
    s = run(s, { type: 'restoreRow', rowId: s.rows[0].rowId });
    expect(countedRows(s)).toHaveLength(1);
  });

  it('a failed commit that may have saved keeps its id and locks the tray; a certain failure frees it', () => {
    const base = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1)]) }, { type: 'commitStarted', commitId: 'c1' });
    const unsure = run(base, { type: 'commitFailed', nothingSaved: false });
    expect(unsure.pendingCommitId).toBe('c1');
    expect(isEditable(unsure)).toBe(false);
    const sure = run(base, { type: 'commitFailed', nothingSaved: true });
    expect(sure.pendingCommitId).toBeNull();
    expect(isEditable(sure)).toBe(true);
  });

  it('rehydrate of a tray saved in an older row shape starts fresh', () => {
    const old = JSON.stringify({ userId: 'u', photos: [], rows: [{ rowId: 'r', key: 'A', qty: 1 }], phase: 'editing' });
    expect(rehydrateTray(old, 'u').rows).toEqual([]);
  });

  it('setQty clamps to 1..99', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1)]) });
    const rowId = s.rows[0].rowId;
    expect(run(s, { type: 'setQty', rowId, qty: 0 }).rows[0].qty).toBe(1);
    expect(run(s, { type: 'setQty', rowId, qty: 500 }).rows[0].qty).toBe(99);
  });

  it('removeRow excludes from countedRows', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1)]) });
    s = run(s, { type: 'removeRow', rowId: s.rows[0].rowId, as: 'wrong' });
    expect(countedRows(s)).toHaveLength(0);
  });

  it('rehydrate marks in-flight photos failed and keeps pendingCommitId', () => {
    let s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoStarted', photoId: 'p2', at: 1 }, { type: 'commitStarted', commitId: 'c1' });
    const r = rehydrateTray(JSON.parse(JSON.stringify(s)), 'u');
    expect(r.photos.map(p => p.status)).toEqual(['failed', 'failed']);
    expect(r.photos[1].error).toEqual({ status: 0, body: { code: 'lost_on_reload' } });
    expect(r.photos.map(p => p.n)).toEqual([1, 2]);
    expect(r.pendingCommitId).toBe('c1');
  });

  it("rehydrate of another user's state returns an empty tray", () => {
    const s = run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' });
    expect(rehydrateTray(JSON.stringify(s), 'other')).toEqual(initialTray('other'));
    expect(rehydrateTray(null, 'u')).toEqual(initialTray('u'));
  });

  const merged = () => run(initialTray('u'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
    { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'X' })]) },
    { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'X', scan: S2 })], S2) });

  it('removing the first photo keeps a merged row for the second', () => {
    const s = trayReducer(merged(), { type: 'photoRemoved', photoId: 'p1' });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ photoId: 'p2', qty: 1 });
    expect(s.rows[0].sources.map(x => x.id)).toEqual([`${S2}:1`]);
    expect(s.rows[0].detection.id).toBe(`${S2}:1`);
  });

  it('removing the second photo decrements qty and drops its ids from outcomes', () => {
    const s = trayReducer(merged(), { type: 'photoRemoved', photoId: 'p2' });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].qty).toBe(1);
    expect(buildCommitPayload(s).outcomesByScanId[S2]).toBeUndefined();
    expect(trayReducer(trayReducer(merged(), { type: 'photoRemoved', photoId: 'p2' }), { type: 'photoRemoved', photoId: 'p1' }).rows).toHaveLength(0);
  });

  it('busy wait marks the photo queued-busy until it starts again, and a reload drops the flag', () => {
    const run = (...as: TrayAction[]) => as.reduce(trayReducer, initialTray('u'));
    const s = run({ type: 'photoAdded', photoId: 'p1' }, { type: 'photoStarted', photoId: 'p1', at: 1 },
      { type: 'photoRetry', photoId: 'p1', busy: true });
    expect(s.photos[0]).toMatchObject({ status: 'queued', busy: true });
    expect(trayReducer(s, { type: 'photoStarted', photoId: 'p1', at: 2 }).photos[0].busy).toBeUndefined();
    expect(rehydrateTray(JSON.stringify(s), 'u').photos[0]).toMatchObject({ status: 'failed', busy: undefined });
  });
});
