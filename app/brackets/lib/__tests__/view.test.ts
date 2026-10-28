import { describe, it, expect } from 'vitest';
import { buildBracket } from '@/lib/bracket';
import type { Bracket, BracketGame, BracketMatch } from '@/lib/bracket/types';
import { entries, game, ids } from '@/lib/bracket/__tests__/fixtures';
import { buildMatchViews, championPath, firstActionableMatchId } from '../view';

const bracket = (over: Partial<Bracket> = {}): Bracket =>
  ({ id: 'b1', name: 'Test', format: 'T1', size: 4, bestOf: 3, status: 'active', championEntryId: null, ...over });

// Seeding fills every 'a' slot, then every 'b' slot: SF1 = e1 vs e3, SF2 = e2 vs e4.
const fourMatches = buildBracket(entries(4), ids);
const at = (ms: BracketMatch[], round: number, position: number) =>
  ms.find(m => m.round === round && m.position === position)!;
const sf1Id = at(fourMatches, 1, 0).id;
const sf2Id = at(fourMatches, 1, 1).id;

const fourDeckBo3 = (games: BracketGame[] = []) => ({
  bracket: bracket(),
  entries: entries(4),
  matches: fourMatches.map(m => ({ ...m })),
  games,
});

// 3 decks: SF1 = e1 vs e3; SF2 = e2 with a bye, so e2 already sits in the final's 'b' slot.
const threeDeck = () => ({
  bracket: bracket(),
  entries: entries(3),
  matches: buildBracket(entries(3), ids),
  games: [] as BracketGame[],
});

// e1 beats e3 2–1 in SF1; e2 beats e1 2–0 in the final.
const threeDeckWon = () => {
  const base = threeDeck();
  const sf1 = at(base.matches, 1, 0);
  const final = at(base.matches, 2, 0);
  sf1.winnerEntryId = 'e1';
  final.entryAId = 'e1';
  final.winnerEntryId = 'e2';
  return {
    ...base,
    bracket: bracket({ status: 'complete', championEntryId: 'e2' }),
    games: [
      game(1, 'e1', { id: 's1', matchId: sf1.id }),
      game(2, 'e3', { id: 's2', matchId: sf1.id }),
      game(3, 'e1', { id: 's3', matchId: sf1.id }),
      game(1, 'e2', { id: 'f1', matchId: final.id }),
      game(2, 'e2', { id: 'f2', matchId: final.id }),
    ],
  };
};

describe('buildMatchViews', () => {
  it('fills placeholders and labels', () => {
    const views = buildMatchViews(fourDeckBo3());
    expect(views.winners[0][0].label).toBe('SF1');
    expect(views.winners[1][0].placeholderA).toBe('Winner of SF1');
    expect(views.winners[1][0].placeholderB).toBe('Winner of SF2');
    expect(views.winners[0][0].state).toBe('ready');
  });
  it('marks a bye block', () => {
    const views = buildMatchViews(threeDeck());
    expect(views.winners[0][1].state).toBe('bye');
    expect(views.winners[0][1].placeholderB).toBe('Bye');
  });
});

describe('championPath', () => {
  it('lists one line per won round, byes excluded', () => {
    expect(championPath(threeDeckWon(), 'e2')).toEqual(['Beat Deck 1 2–0']);
  });
});

describe('firstActionableMatchId', () => {
  it('prefers live, then ready, in round order', () => {
    const views = buildMatchViews(fourDeckBo3([game(1, null, { matchId: sf2Id })]));
    expect(firstActionableMatchId(views)).toBe(sf2Id);
  });
});
