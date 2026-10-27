import { describe, expect, it } from 'vitest';
import { buildCommitPayload } from '../lib/outcomes';
import { initialTray, trayReducer, type TrayAction } from '../lib/trayReducer';
import { cand, det, resp } from './fixtures';

const S2 = 'aaaaaaaa-2222-3333-4444-555555555555';
const build = (...as: TrayAction[]) => as.reduce(trayReducer, initialTray('u'));
const two = () => build({ type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
  { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'X' }), det(2, { chosenKey: null })]) },
  { type: 'photoDone', photoId: 'p2', response: resp([det(1, { chosenKey: 'X', scan: S2 })], S2) });

describe('buildCommitPayload', () => {
  it('outcomes cover every detection of a merged row', () => {
    const p = buildCommitPayload(two());
    expect(Object.values(p.outcomesByScanId).flat().map(o => o.id).sort())
      .toEqual([`${S2}:1`, '11111111-2222-3333-4444-555555555555:1', '11111111-2222-3333-4444-555555555555:2'].sort());
    expect(Object.keys(p.outcomesByScanId)).toHaveLength(2);
  });

  it('removed rows carry removedAs and null finalKey', () => {
    let s = two();
    s = trayReducer(s, { type: 'removeRow', rowId: s.rows[0].rowId, as: 'unwanted' });
    const o = buildCommitPayload(s).outcomesByScanId['11111111-2222-3333-4444-555555555555'].find(x => x.id.endsWith(':1'))!;
    expect(o).toMatchObject({ removed: true, removedAs: 'unwanted', finalKey: null, unresolved: false });
    expect(buildCommitPayload(s).rows).toEqual([]);
  });

  it('unresolved not_found row', () => {
    const o = buildCommitPayload(two()).outcomesByScanId['11111111-2222-3333-4444-555555555555'].find(x => x.id.endsWith(':2'))!;
    expect(o).toMatchObject({ unresolved: true, finalKey: null, removed: false });
  });

  it('payload rows sum identical keys across rows', () => {
    let s = build({ type: 'photoAdded', photoId: 'p1' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'A' }), det(2, { chosenKey: 'B' })]) });
    s = trayReducer(s, { type: 'setKey', rowId: s.rows[1].rowId, key: 'A', via: 'search' });
    s = trayReducer(s, { type: 'setQty', rowId: s.rows[1].rowId, qty: 3 });
    expect(buildCommitPayload(s).rows).toEqual([{ key: 'A', qty: 4 }]);
  });

  it('outcome satisfies queries.sql assumptions', () => {
    let s = two();
    s = trayReducer(s, { type: 'setKey', rowId: s.rows[1].rowId, key: 'Q', via: 'search' });
    const ids = new Set(s.rows.flatMap(r => r.sources.map(x => x.id)));
    const outs = Object.values(buildCommitPayload(s).outcomesByScanId).flat();
    expect(outs.length).toBeGreaterThan(0);
    for (const o of outs) {
      expect(Object.keys(o).sort()).toEqual(['finalKey', 'id', 'nameChanged', 'printingChanged', 'removed', 'removedAs', 'unresolved']);
      for (const k of ['printingChanged', 'nameChanged', 'removed', 'unresolved'] as const) expect(typeof o[k]).toBe('boolean');
      expect([null, 'wrong', 'unwanted']).toContain(o.removedAs);
      expect(o.id).toMatch(/^[0-9a-f-]{36}:\d+$/);
      expect(ids.has(o.id)).toBe(true);
      expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    }
  });

  const S1 = '11111111-2222-3333-4444-555555555555';
  const mergeSetup = (second: Parameters<typeof det>[1]) => {
    let s = build({ type: 'photoAdded', photoId: 'p1' }, { type: 'photoAdded', photoId: 'p2' },
      { type: 'photoDone', photoId: 'p1', response: resp([det(1, { chosenKey: 'A', candidates: [cand('A', 1), cand('B', 2)] })]) });
    s = trayReducer(s, { type: 'setKey', rowId: s.rows[0].rowId, key: 'B', via: 'candidates' });
    return trayReducer(s, { type: 'photoDone', photoId: 'p2', response: resp([det(1, { scan: S2, ...second })], S2) });
  };

  it('merged detection whose own pick equals the corrected key records no change', () => {
    const s = mergeSetup({ chosenKey: 'B' });
    expect(s.rows).toHaveLength(1);
    const o = buildCommitPayload(s).outcomesByScanId;
    expect(o[S1][0]).toMatchObject({ finalKey: 'B', printingChanged: true });
    expect(o[S2][0]).toMatchObject({ finalKey: 'B', printingChanged: false, nameChanged: false });
  });

  it('merged detection with a different chosenKey records its own change', () => {
    const s = mergeSetup({ chosenKey: 'B', candidates: [cand('B', 2)] });
    const s3 = trayReducer(s, { type: 'photoAdded', photoId: 'p3' });
    expect(s3.rows[0].sources).toHaveLength(2);
    // detection whose own pick is C but whose row key is B (not a candidate -> name change)
    const only = mergeSetup({ chosenKey: 'C', candidates: [cand('C', 1)] });
    expect(only.rows).toHaveLength(2);
    const t = trayReducer(only, { type: 'setKey', rowId: only.rows[1].rowId, key: 'B', via: 'search' });
    const o = buildCommitPayload(t).outcomesByScanId[S2][0];
    expect(o).toMatchObject({ finalKey: 'B', nameChanged: true, printingChanged: false });
  });
});
