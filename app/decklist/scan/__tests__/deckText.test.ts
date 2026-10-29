import { describe, expect, it } from 'vitest';
import { parseDeckText } from '@/app/decklist/card-search/utils/deckImportExport';
import type { Card } from '@/app/decklist/card-search/utils';
import { deckTrayReducer, initialDeckTray, type DeckTrayAction } from '../lib/deckTrayReducer';
import { buildDeckText } from '../lib/deckText';
import { saveRows } from '../lib/handoff';
import type { DeckTrayState } from '../types';
import { deckResponse, rep } from './fixtures';

const run = (s: DeckTrayState, ...as: DeckTrayAction[]) => as.reduce(deckTrayReducer, s);
const card = (name: string, set: string, imgFile: string): Card => ({
  dataLine: '', name, set, imgFile, officialSet: set, type: 'Hero', brigade: '', strength: '', toughness: '', class: '',
  identifier: '', specialAbility: '', rarity: '', reference: '', alignment: '', legality: '', testament: '', isGospel: false,
});

describe('buildDeckText', () => {
  const resp = deckResponse('s1', [
    ...rep(3, { group: 1, key: 'Moses|RoJ|moses' }),
    { group: 1, key: 'Aaron|Pr|aaron' },
    { group: 1, key: null, kind: 'not_found', title: 'Zed' },
    ...rep(2, { group: 2, key: 'Joshua|RoJ|joshua' }),
  ], [{ id: 1 }, { id: 2 }]);
  const s = run(initialDeckTray('u1'),
    { type: 'photoAdded', photoId: 'p1' }, { type: 'photoStarted', photoId: 'p1', at: 1 }, { type: 'photoDone', photoId: 'p1', response: resp },
    { type: 'setGroupZone', groupKey: 'p1:2', zone: 'reserve' },
    { type: 'setLostSoulPicks', picks: [{ key: 'Lost Soul|Pr|ls', qty: 2 }] });

  it('writes main, then Reserve:, tab separated', () => {
    expect(buildDeckText(s)).toBe(
      ['3\tMoses\tRoJ\tmoses', '1\tAaron\tPr\taaron', '2\tLost Soul\tPr\tls', 'Reserve:', '2\tJoshua\tRoJ\tjoshua'].join('\n'),
    );
  });

  it('omits Reserve: when there is none', () => {
    const t = buildDeckText(run(s, { type: 'setGroupZone', groupKey: 'p1:2', zone: 'main' }));
    expect(t).not.toContain('Reserve:');
  });

  it('round-trips through parseDeckText', () => {
    const cards = [card('Moses', 'RoJ', 'moses'), card('Aaron', 'Pr', 'aaron'), card('Lost Soul', 'Pr', 'ls'), card('Joshua', 'RoJ', 'joshua')];
    const r = parseDeckText(buildDeckText(s), cards);
    expect(r.errors).toEqual([]);
    const got = r.deck!.cards.map(dc => [dc.card.name, dc.card.set, dc.quantity, dc.zone]).sort();
    const want = saveRows(s).map(x => [x.card_name, x.card_set, x.quantity, x.zone]).sort();
    expect(got).toEqual(want);
  });
});
