import { describe, expect, it } from 'vitest';
import { countedRows, initialTray, rehydrateTray, trayReducer, trayTotals, type TrayAction, type TrayState } from '../lib/trayReducer';
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
    expect(s.rows[0].detectionIds).toHaveLength(2);
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
    expect(trayTotals(s)).toEqual({ cards: 3, priced: 7, unpriced: 1, unresolved: 1 });
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
});
