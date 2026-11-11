import { describe, expect, it } from 'vitest';
import { deckTrayReducer, initialDeckTray, restoreDeckTray, trayRows, type DeckTrayAction } from '../lib/deckTrayReducer';
import { saveRows, totals } from '../lib/handoff';
import type { DeckScanResponse, DeckTrayState } from '../types';
import { deckResponse, rep } from './fixtures';

const run = (s: DeckTrayState, ...as: DeckTrayAction[]) => as.reduce(deckTrayReducer, s);
const read = (s: DeckTrayState, photoId: string, response: DeckScanResponse, lostSouls = false) =>
  run(s,
    { type: 'photoAdded', photoId },
    ...(lostSouls ? [{ type: 'markLostSoulPhoto', photoId } as DeckTrayAction] : []),
    { type: 'photoDone', photoId, response });
const LS = (n: string) => `Lost Soul "${n}" [Gen 1:${n.length}]|RoJ|ls-${n}`;
const stack = { group: 1, key: null, kind: 'lost_soul' as const, type: 'Lost Soul' };
const soul = (n: string) => ({ group: 1, key: LS(n), type: 'Lost Soul' });
const deck = (extra: Parameters<typeof deckResponse>[1] = []) =>
  read(initialDeckTray('u1'), 'p1', deckResponse('s1', [{ group: 1, key: 'Moses|RoJ|moses' }, ...rep(7, stack), ...extra]));
const stackQty = (s: DeckTrayState) => trayRows(s).filter(r => r.kind === 'lost_soul').reduce((n, r) => n + r.quantity, 0);
const souls = (s: DeckTrayState) => saveRows(s).filter(r => r.card_name.startsWith('Lost Soul')).reduce((n, r) => n + r.quantity, 0);

describe('a Lost Souls photo', () => {
  it('names the stacked Lost Souls it reads: each one takes a counted one off the list', () => {
    const s = read(deck(), 'p2', deckResponse('s2', ['a', 'b', 'c', 'd', 'e'].map(soul)), true);
    expect(stackQty(s)).toBe(2);
    expect(totals(s)).toMatchObject({ lostSoulsToPick: 2, main: 6 });
    expect(souls(s)).toBe(5);
  });

  it('reading all of them leaves nothing to pick and no summary row', () => {
    const s = read(deck(), 'p2', deckResponse('s2', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(soul)), true);
    expect(trayRows(s).some(r => r.kind === 'lost_soul')).toBe(false);
    expect(totals(s)).toMatchObject({ lostSoulsToPick: 0, main: 8 });
  });

  it('does not count a Lost Soul twice when the deck photo already named it', () => {
    const s = read(deck([soul('a')]), 'p2', deckResponse('s2', ['a', 'b', 'c'].map(soul)), true);
    // 8 in the deck photo (7 stacked + a); the photo names a, b, c: a once, b and c off the stack.
    expect(saveRows(s).find(r => r.card_img_file === 'ls-a')!.quantity).toBe(1);
    expect(stackQty(s)).toBe(5);
    expect(souls(s) + totals(s).lostSoulsToPick).toBe(8);
  });

  it('a Lost Soul it could not name is not counted again while stacked ones are left', () => {
    const s = read(deck(), 'p2', deckResponse('s2', [soul('a'), stack, stack]), true);
    expect(stackQty(s)).toBe(6);
  });

  it('keeps its own unnamed Lost Souls when the deck photo showed none', () => {
    const s0 = read(initialDeckTray('u1'), 'p1', deckResponse('s1', [{ group: 1, key: 'Moses|RoJ|moses' }]));
    const s = read(s0, 'p2', deckResponse('s2', [soul('a'), stack, stack]), true);
    expect(stackQty(s)).toBe(2);
    expect(souls(s)).toBe(1);
  });

  it('only a row with its card covers: a Which card? row covers once it is picked', () => {
    const which = { group: 1, key: LS('a'), kind: 'which' as const, type: 'Lost Soul', identityCandidates: ['x', 'y'] };
    const s = read(deck(), 'p2', deckResponse('s2', [which]), true);
    expect(stackQty(s)).toBe(7);
    const row = trayRows(s).find(r => r.kind === 'which')!;
    expect(stackQty(run(s, { type: 'setCard', rowKey: row.rowKey, key: LS('a') }))).toBe(6);
  });

  it('an ordinary second photo adds to the count as before', () => {
    const s = read(deck(), 'p2', deckResponse('s2', ['a', 'b'].map(soul)));
    expect(stackQty(s)).toBe(7);
    expect(souls(s)).toBe(2);
  });

  it('removing the photo brings the count back, and the mark survives a reload', () => {
    const s = read(deck(), 'p2', deckResponse('s2', ['a', 'b'].map(soul)), true);
    expect(stackQty(run(s, { type: 'photoRemoved', photoId: 'p2' }))).toBe(7);
    const back = restoreDeckTray(JSON.stringify(s), 'u1');
    expect(back.photos[1].lostSouls).toBe(true);
    expect(stackQty(back)).toBe(5);
    expect(restoreDeckTray(JSON.stringify({ ...s, photos: s.photos.map(p => ({ ...p, lostSouls: 'yes' })) }), 'u1').photos[1].lostSouls).toBeUndefined();
  });

  it('a removed row in the photo stops covering', () => {
    const s = read(deck(), 'p2', deckResponse('s2', ['a', 'b'].map(soul)), true);
    const row = trayRows(s).find(r => r.key === LS('a'))!;
    expect(stackQty(run(s, { type: 'removeRow', rowKey: row.rowKey }))).toBe(6);
  });
});
