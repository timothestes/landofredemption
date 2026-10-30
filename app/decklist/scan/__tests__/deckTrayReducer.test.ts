import { describe, expect, it } from 'vitest';
import {
  deckTrayReducer, initialDeckTray, restoreDeckTray, STORAGE_KEY, trayRows, zoneOf,
  type DeckTrayAction,
} from '../lib/deckTrayReducer';
import type { DeckTrayState } from '../types';
import { deckResponse, rep } from './fixtures';

const run = (s: DeckTrayState, ...as: DeckTrayAction[]) => as.reduce(deckTrayReducer, s);
const U = 'u1';
const withPhoto = (id: string, resp = deckResponse('s1', [])) =>
  run(initialDeckTray(U), { type: 'photoAdded', photoId: id }, { type: 'photoStarted', photoId: id, at: 1 }, { type: 'photoDone', photoId: id, response: resp });

describe('deckTrayReducer', () => {
  it('numbers photos and stores groups; photoDone appends one entry per detection', () => {
    const s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 1, key: 'A' }, { group: 1, key: 'B' }]));
    expect(s.photos[0]).toMatchObject({ n: 1, status: 'done', scanId: 's1', groups: [{ id: 1 }] });
    expect(s.entries.map(e => e.entryId)).toEqual(['s1:0', 's1:1', 's1:2']);
    expect(s.entries[0]).toMatchObject({ kind: 'matched', key: 'A', original: { kind: 'matched', key: 'A' }, removed: false });
    const rows = trayRows(s);
    expect(rows.map(r => [r.key, r.quantity])).toEqual([['A', 2], ['B', 1]]);
    expect(rows[0].groupKey).toBe('p1:1');
    expect(rows[0].shares).toEqual({ 'p1:1': 2 });
  });

  it('stores the long edge of the image the scanner read', () => {
    expect(withPhoto('p1').photos[0].longEdge).toBe(2048);
    expect(withPhoto('p1', { ...deckResponse('s1', []), imageSize: { width: 768, height: 1024 } }).photos[0].longEdge).toBe(1024);
  });

  it('sets default zones on the first photoDone that reaches 2 groups, only for groups without a zone', () => {
    const resp = deckResponse(
      's1',
      [...rep(50, { group: 1, key: 'A' }), ...rep(10, { group: 2, key: 'B' })],
      [{ id: 1 }, { id: 2 }],
    );
    const s = withPhoto('p1', resp);
    expect(s.groupZones).toEqual({ 'p1:1': 'main', 'p1:2': 'reserve' });
    // a later photo does not touch it, and a manual choice survives
    const s2 = run(s, { type: 'setGroupZone', groupKey: 'p1:2', zone: 'main' },
      { type: 'photoAdded', photoId: 'p2' }, { type: 'photoDone', photoId: 'p2', response: deckResponse('s2', [{ group: 1, key: 'C' }]) });
    expect(s2.groupZones['p1:2']).toBe('main');
    expect(s2.groupZones['p2:1']).toBeUndefined();
  });

  it('setCard turns every entry of the row into matched with the new key and re-merges', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 1, key: 'B', kind: 'which' }, { group: 1, key: 'B', kind: 'which' }]));
    const rk = trayRows(s).find(r => r.kind === 'which')!.rowKey;
    s = run(s, { type: 'setCard', rowKey: rk, key: 'A' });
    expect(s.entries.every(e => e.kind === 'matched' && e.key === 'A')).toBe(true);
    expect(trayRows(s).map(r => [r.key, r.quantity])).toEqual([['A', 3]]);
    expect(s.entries[1].original).toEqual({ kind: 'which', key: 'B' });
  });

  it('setCard with candidates stores them on every patched entry', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'B', kind: 'read_as' }, { group: 1, key: 'B', kind: 'read_as' }]));
    const cands = [{ key: 'A', name: 'Alpha', set: 'X', officialSet: 'Xs', imgFile: 'a', legality: 'Rotation', price: null }];
    s = run(s, { type: 'setCard', rowKey: trayRows(s)[0].rowKey, key: 'A', candidates: cands });
    expect(s.entries.map(e => e.candidates)).toEqual([cands, cands]);
  });

  it('setCardOne corrects only the first read of an unread x3 row, keeping its original, removing nothing', () => {
    let s = withPhoto('p1', deckResponse('s1', rep(3, { group: 1, key: null, kind: 'unread' })));
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:1', zone: 'reserve' });
    const rk = trayRows(s)[0].rowKey;
    const cands = [{ key: 'A', name: 'Alpha', set: 'X', officialSet: 'Xs', imgFile: 'a', legality: 'Rotation', price: null }];
    s = run(s, { type: 'setCardOne', rowKey: rk, key: 'A', candidates: cands });
    expect(trayRows(s).map(r => [r.kind, r.key, r.quantity, r.zone])).toEqual([['matched', 'A', 1, 'reserve'], ['unread', null, 2, 'reserve']]);
    expect(s.entries[0]).toMatchObject({ entryId: 's1:0', photoId: 'p1', group: 1, kind: 'matched', key: 'A', candidates: cands, original: { kind: 'unread', key: null } });
    expect(s.entries.some(e => e.removed)).toBe(false);
    expect(s.entries).toHaveLength(3);
  });

  it('addCard with candidates stores them on the added entry', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'B' }]));
    const cands = [{ key: 'A', name: 'Alpha', set: 'X', officialSet: 'Xs', imgFile: 'a', legality: 'Rotation', price: null }];
    s = run(s, { type: 'addCard', groupKey: 'p1:1', key: 'A', candidates: cands });
    expect(s.entries[1]).toMatchObject({ key: 'A', candidates: cands, original: null });
  });

  it('setQty adds entries copying the first entry, ids by addSeq, clamped to 0..99', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A', title: 'Alpha', type: 'Hero' }]));
    const rk = trayRows(s)[0].rowKey;
    s = run(s, { type: 'setQty', rowKey: rk, qty: 3 });
    expect(s.entries.slice(1).map(e => e.entryId)).toEqual(['s1:add:0', 's1:add:1']);
    expect(s.entries[1]).toMatchObject({ photoId: 'p1', group: 1, kind: 'matched', key: 'A', title: 'Alpha', type: 'Hero', original: null });
    expect(trayRows(s)[0].quantity).toBe(3);
    s = run(s, { type: 'setQty', rowKey: rk, qty: 1 });
    expect(trayRows(s)[0].quantity).toBe(1);
    expect(s.entries.map(e => e.removed)).toEqual([false, true, true]);
    expect(trayRows(run(s, { type: 'setQty', rowKey: rk, qty: 500 }))[0].quantity).toBe(99);
    expect(trayRows(run(s, { type: 'setQty', rowKey: rk, qty: 0 }))).toEqual([]);
  });

  it('setQty on a which row keeps one row (added entries copy identityCandidates)', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A', kind: 'which', identityCandidates: ['A', 'B'] }]));
    s = run(s, { type: 'setQty', rowKey: trayRows(s)[0].rowKey, qty: 3 });
    const rows = trayRows(s);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
    expect(s.entries[2].identityCandidates).toEqual(['A', 'B']);
  });

  it('setQty with a non-finite qty is a no-op', () => {
    const s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }]));
    expect(run(s, { type: 'setQty', rowKey: trayRows(s)[0].rowKey, qty: NaN })).toBe(s);
  });

  it('removeRow marks the entries removed and undoRemove restores exactly those', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 1, key: 'A' }, { group: 1, key: 'B' }]));
    const rk = trayRows(s)[0].rowKey;
    s = run(s, { type: 'removeRow', rowKey: rk });
    expect(s.lastRemoved).toEqual({ entryIds: ['s1:0', 's1:1'] });
    expect(trayRows(s).map(r => r.key)).toEqual(['B']);
    s = run(s, { type: 'undoRemove' });
    expect(s.lastRemoved).toBeNull();
    expect(trayRows(s).map(r => [r.key, r.quantity])).toEqual([['A', 2], ['B', 1]]);
  });

  it('moveRow sets a row-level zone; setGroupZone sets the group zone', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 1, key: 'B' }]));
    s = run(s, { type: 'moveRow', rowKey: trayRows(s)[0].rowKey, zone: 'reserve' });
    expect(trayRows(s).map(r => [r.key, r.zone])).toEqual([['B', 'main'], ['A', 'reserve']]);
    const row = trayRows(s).find(r => r.key === 'A')!;
    expect(zoneOf(s, row)).toBe('reserve');
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:1', zone: 'reserve' });
    expect(s.groupZones['p1:1']).toBe('reserve');
    expect(zoneOf(s, trayRows(s).find(r => r.key === 'B')!)).toBe('reserve');
  });

  it('main-only cards (Lost Souls, Dominants) stay main even in a Reserve group', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'D', type: 'Good Dominant' }, { group: 1, key: 'L', kind: 'lost_soul' }]));
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:1', zone: 'reserve' });
    expect(trayRows(s).every(r => r.zone === 'main' && zoneOf(s, r) === 'main')).toBe(true);
  });

  it('addCard adds one matched entry in that group', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }], [{ id: 1 }, { id: 2 }]));
    s = run(s, { type: 'addCard', groupKey: 'p1:2', key: 'Z' });
    expect(s.entries[1]).toMatchObject({ photoId: 'p1', group: 2, kind: 'matched', key: 'Z', original: null });
    expect(trayRows(s).find(r => r.key === 'Z')!.groupKey).toBe('p1:2');
  });

  it('photoRemoved drops the photo, its entries and its group zones', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }]));
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:1', zone: 'reserve' },
      { type: 'photoAdded', photoId: 'p2' }, { type: 'photoDone', photoId: 'p2', response: deckResponse('s2', [{ group: 1, key: 'B' }]) },
      { type: 'setGroupZone', groupKey: 'p2:1', zone: 'reserve' }, { type: 'photoRemoved', photoId: 'p1' });
    expect(s.photos.map(p => p.photoId)).toEqual(['p2']);
    expect(s.entries.map(e => e.entryId)).toEqual(['s2:0']);
    expect(s.groupZones).toEqual({ 'p2:1': 'reserve' });
    // indexes shifted, ids did not: shares keep the photo id
    expect(trayRows(s)[0].shares).toEqual({ 'p2:1': 1 });
  });

  it('quantity added to a merged row lands in its first group', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 2, key: 'A' }], [{ id: 1 }, { id: 2 }]));
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:1', zone: 'main' }, { type: 'setGroupZone', groupKey: 'p1:2', zone: 'main' });
    s = run(s, { type: 'setQty', rowKey: trayRows(s)[0].rowKey, qty: 3 });
    expect(s.entries[2].group).toBe(1);
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:2', zone: 'reserve' });
    expect(trayRows(s).map(r => [r.zone, r.quantity])).toEqual([['main', 2], ['reserve', 1]]);
  });

  it('a card split across a main and a Reserve group is two derived rows', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 2, key: 'A' }], [{ id: 1 }, { id: 2 }]));
    s = run(s, { type: 'setGroupZone', groupKey: 'p1:2', zone: 'reserve' });
    const rows = trayRows(s);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.rowKey)).size).toBe(2);
    expect(rows.map(r => [r.zone, r.groupKey])).toEqual([['main', 'p1:1'], ['reserve', 'p1:2']]);
    // actions address the right half
    s = run(s, { type: 'removeRow', rowKey: rows[1].rowKey });
    expect(trayRows(s).map(r => r.zone)).toEqual(['main']);
  });

  it('keeps the photo status transitions: retry, busy, failure', () => {
    let s = run(initialDeckTray(U), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' });
    expect(s.photos.map(p => p.n)).toEqual([1, 2]);
    s = run(s, { type: 'photoStarted', photoId: 'p1', at: 5 }, { type: 'photoFailed', photoId: 'p1', error: { status: 429, body: { code: 'busy' } as never } });
    expect(s.photos[0].status).toBe('failed');
    s = run(s, { type: 'photoRetry', photoId: 'p1', busy: true });
    expect(s.photos[0]).toMatchObject({ status: 'queued', busy: true });
  });

  it('saving / saved / saveFailed move the phase', () => {
    let s = run(initialDeckTray(U), { type: 'saving' });
    expect(s.phase).toBe('saving');
    expect(run(s, { type: 'saveFailed' }).phase).toBe('editing');
    expect(run(s, { type: 'saved', deckId: 'd1' })).toMatchObject({ phase: 'saved', savedDeckId: 'd1' });
  });

  it('records Lost Soul picks and the skip', () => {
    let s = run(initialDeckTray(U), { type: 'setLostSoulPicks', picks: [{ key: 'L', qty: 2 }] });
    expect(s.lostSoulPicks).toEqual([{ key: 'L', qty: 2 }]);
    s = run(s, { type: 'skipLostSouls' });
    expect(s).toMatchObject({ lostSoulPicks: [], lostSoulsSkipped: true });
  });
});

describe('restoreDeckTray', () => {
  it('has a per-user storage key', () => expect(STORAGE_KEY('x')).toBe('deck-scan-tray:v1:x'));

  it('marks reading photos lost_on_reload and keeps corrections', () => {
    let s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }, { group: 1, key: 'A' }]));
    s = run(s, { type: 'setQty', rowKey: trayRows(s)[0].rowKey, qty: 3 },
      { type: 'setGroupZone', groupKey: 'p1:1', zone: 'reserve' },
      { type: 'photoAdded', photoId: 'p2' }, { type: 'photoStarted', photoId: 'p2', at: 9 },
      { type: 'setLostSoulPicks', picks: [{ key: 'L', qty: 1 }] });
    const back = restoreDeckTray(JSON.stringify(s), U);
    expect(back.photos[1]).toMatchObject({ status: 'failed', error: { status: 0, body: { code: 'lost_on_reload' } } });
    expect(back.photos[0].status).toBe('done');
    expect(back.entries).toEqual(s.entries);
    expect(back.groupZones).toEqual({ 'p1:1': 'reserve' });
    expect(back.lostSoulPicks).toEqual([{ key: 'L', qty: 1 }]);
    expect(back.addSeq).toBe(1);
  });

  it('drops anything malformed or from another user', () => {
    const s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A' }]));
    expect(restoreDeckTray(JSON.stringify(s), 'other')).toEqual(initialDeckTray('other'));
    expect(restoreDeckTray('{not json', U)).toEqual(initialDeckTray(U));
    expect(restoreDeckTray(null, U)).toEqual(initialDeckTray(U));
    const bad = { ...s, entries: [...s.entries, { entryId: 5 }, null], photos: [...s.photos, { photoId: 7 }] };
    const back = restoreDeckTray(bad, U);
    expect(back.entries).toHaveLength(1);
    expect(back.photos).toHaveLength(1);
  });

  it('survives hostile restored state through trayRows and the next photoDone', () => {
    const s = withPhoto('p1', deckResponse('s1', [{ group: 1, key: 'A', kind: 'which', identityCandidates: ['A', 'B'] }, { group: 1, key: 'C' }]));
    const hostile = JSON.parse(JSON.stringify(s));
    hostile.entries[0].zone = 'x';
    hostile.entries[0].identityCandidates = 'nope';
    hostile.entries[1].candidates = 5;
    hostile.entries[1].near = 5;
    hostile.entries[1].zone = 'x';
    hostile.photos[0].groups = [null, { id: 1 }, { id: 1, orientation: 'upright', bbox: [0, 0, 1], cardCount: 1 }];
    const back = restoreDeckTray(hostile, U);
    expect(() => trayRows(back)).not.toThrow();
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].zone).toBeUndefined();
    expect(back.entries[0].candidates).toEqual([]);
    expect(back.photos[0].groups).toEqual([]);
    expect(() => run(back, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p2', response: deckResponse('s2', [{ group: 1, key: 'D' }, { group: 2, key: 'E' }], [{ id: 1 }, { id: 2 }]) })).not.toThrow();
  });

  it('reopens an interrupted save for editing', () => {
    const s = run(withPhoto('p1', deckResponse('s1', [])), { type: 'saving' });
    expect(restoreDeckTray(s, U).phase).toBe('editing');
  });
});
