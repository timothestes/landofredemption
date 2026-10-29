import { describe, expect, it } from 'vitest';
import { FORMATS } from '@/lib/formats';
import { deckTrayReducer, initialDeckTray, type DeckTrayAction } from '../lib/deckTrayReducer';
import { deckFormat, deckName, deckOutcomes, saveRows, totals } from '../lib/handoff';
import type { DeckTrayState } from '../types';
import { deckResponse, rep } from './fixtures';

const run = (s: DeckTrayState, ...as: DeckTrayAction[]) => as.reduce(deckTrayReducer, s);
const tray = (resp = deckResponse('s1', [])) =>
  run(initialDeckTray('u1'), { type: 'photoAdded', photoId: 'p1' }, { type: 'photoStarted', photoId: 'p1', at: 1 }, { type: 'photoDone', photoId: 'p1', response: resp });
const K = (n: string, set = 'RoJ', img = n) => `${n}|${set}|${img}`;

describe('saveRows', () => {
  it('saves main-only rows in main from a Reserve group', () => {
    const resp = deckResponse('s1', [
      ...rep(50, { group: 1, key: K('A') }),
      { group: 2, key: K('Dom'), type: 'Dominant' },
      { group: 2, key: K('B') },
    ], [{ id: 1 }, { id: 2 }]);
    const s = run(tray(resp), { type: 'setGroupZone', groupKey: 'p1:2', zone: 'reserve' });
    const rows = saveRows(s);
    expect(rows.find(r => r.card_name === 'Dom')).toMatchObject({ zone: 'main', quantity: 1 });
    expect(rows.find(r => r.card_name === 'B')).toMatchObject({ zone: 'reserve', card_set: 'RoJ', card_img_file: 'B' });
  });

  it('sums per key and zone, caps at 99, and adds Lost Soul picks to main', () => {
    let s = tray(deckResponse('s1', [...rep(2, { group: 1, key: K('A') })]));
    s = run(s, { type: 'setQty', rowKey: 'main|m:' + K('A'), qty: 99 }, { type: 'setLostSoulPicks', picks: [{ key: K('Lost Soul "X" [Gen 1]', 'Pr', 'LS'), qty: 3 }, { key: K('A'), qty: 100 }] });
    const rows = saveRows(s);
    expect(rows.filter(r => r.card_name === 'A')).toEqual([{ card_name: 'A', card_set: 'RoJ', card_img_file: 'A', quantity: 99, zone: 'main' }]);
    expect(rows.find(r => r.card_img_file === 'LS')).toMatchObject({ quantity: 3, zone: 'main' });
  });

  it('splits the key on the last two pipes', () => {
    const s = tray(deckResponse('s1', [{ group: 1, key: 'We|ird|RoJ|img' }]));
    expect(saveRows(s)).toEqual([{ card_name: 'We|ird', card_set: 'RoJ', card_img_file: 'img', quantity: 1, zone: 'main' }]);
  });

  it('leaves unresolved rows out and counts them', () => {
    const s = tray(deckResponse('s1', [
      { group: 1, key: K('A') },
      { group: 1, key: null, kind: 'not_found', title: 'Zed' },
      { group: 1, key: null, kind: 'not_found', title: 'Zed' },
      { group: 1, key: null, kind: 'unread' },
      { group: 1, key: null, kind: 'lost_soul', type: 'Lost Soul' },
    ]));
    expect(saveRows(s).map(r => r.card_name)).toEqual(['A']);
    expect(totals(s)).toMatchObject({ main: 1, reserve: 0, leftOut: 3, unread: 1, toCheck: 2, lostSoulsToPick: 1 });
    const o = deckOutcomes(s).s1;
    expect(o.filter(x => x.unresolved).map(x => x.id)).toEqual(['s1:1', 's1:2', 's1:3']);
    expect(o.find(x => x.id === 's1:4')!.unresolved).toBe(false);
  });
});

describe('totals', () => {
  it('lostSoulsToPick shrinks with picks and is 0 once skipped', () => {
    const base = tray(deckResponse('s1', [...rep(3, { group: 1, key: null, kind: 'lost_soul', type: 'Lost Soul' })]));
    expect(totals(base).lostSoulsToPick).toBe(3);
    const picked = run(base, { type: 'setLostSoulPicks', picks: [{ key: K('L'), qty: 2 }] });
    expect(totals(picked)).toMatchObject({ lostSoulsToPick: 1, main: 2, leftOut: 0 });
    expect(totals(run(picked, { type: 'setLostSoulPicks', picks: [{ key: K('L'), qty: 5 }] })).lostSoulsToPick).toBe(0);
    expect(totals(run(base, { type: 'skipLostSouls' })).lostSoulsToPick).toBe(0);
  });
});

describe('deckOutcomes', () => {
  it('tells a name change from a printing change', () => {
    const s = run(
      tray(deckResponse('s1', [{ group: 1, key: K('Moses (RoJ)', 'RoJ') }, { group: 1, key: K('Aaron') }, { group: 1, key: K('Same') }])),
      { type: 'setCard', rowKey: 'main|m:' + K('Moses (RoJ)', 'RoJ'), key: K('Moses (Pr)', 'Pr') },
      { type: 'setCard', rowKey: 'main|m:' + K('Aaron'), key: K('Joshua') },
    );
    const [a, b, c] = deckOutcomes(s).s1;
    expect(a).toMatchObject({ id: 's1:0', finalKey: K('Moses (Pr)', 'Pr'), printingChanged: true, nameChanged: false });
    expect(b).toMatchObject({ nameChanged: true, printingChanged: false });
    expect(c).toMatchObject({ nameChanged: false, printingChanged: false, zone: 'main' });
  });

  it('gives added cards and Lost Soul picks synthetic ids under a scan id', () => {
    const s = run(tray(deckResponse('s1', [{ group: 1, key: K('A') }])),
      { type: 'addCard', groupKey: 'p1:1', key: K('B') },
      { type: 'setLostSoulPicks', picks: [{ key: K('L'), qty: 2 }] });
    const o = deckOutcomes(s).s1;
    expect(o.map(x => x.id)).toEqual(['s1:0', 's1:add:0', 's1:ls:0']);
    expect(o[1]).toMatchObject({ finalKey: K('B'), nameChanged: false, printingChanged: false, lostSoulPick: false });
    expect(o[2]).toMatchObject({ finalKey: K('L'), zone: 'main', lostSoulPick: true });
  });

  it('records removed reads with removed true, finalKey null and no zone', () => {
    const s = run(tray(deckResponse('s1', [{ group: 1, key: K('A') }])), { type: 'removeRow', rowKey: 'main|m:' + K('A') });
    expect(deckOutcomes(s).s1[0]).toMatchObject({ removed: true, finalKey: null, zone: null, unresolved: false, nameChanged: false });
  });
});

describe('deckFormat and deckName', () => {
  it('reads FORMATS', () => {
    expect(deckFormat(FORMATS.T2.main.min)).toBe('Type 2');
    expect(deckFormat(FORMATS.T2.main.max)).toBe('Type 2');
    expect(deckFormat(60)).toBe('Type 1');
    expect(deckFormat(FORMATS.T2.main.max + 1)).toBe('Type 1');
  });
  it('names the deck by date', () => {
    expect(deckName(new Date('2026-10-29T12:00:00'))).toBe('Deck from photo · Oct 29');
  });
});
