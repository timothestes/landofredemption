import { describe, it, expect } from 'vitest';
import { buildBracket } from '..';
import type { Bracket, BracketGame, BracketMatch } from '../types';
import {
  computeMoments, computeStandings, describeSeries, gameMinutes, goingFirst, placeForRound,
} from '../standings';
import { entries, game, ids } from './fixtures';

const bracket = (over: Partial<Bracket> = {}): Bracket =>
  ({ id: 'b1', name: 'Test', format: 'T1', size: 4, bestOf: 3, status: 'active', championEntryId: null, ...over });

const at = (ms: BracketMatch[], round: number, position: number) =>
  ms.find(m => m.round === round && m.position === position)!;

const T0 = '2026-10-21T10:00:00Z';
const after = (minutes: number) => new Date(new Date(T0).getTime() + minutes * 60_000).toISOString();

/**
 * Four decks, best of three. SF1 = e1 vs e3, SF2 = e2 vs e4 (all 'a' slots seed first).
 * SF1: e3 wins game 1, e1 wins games 2 and 3 (a comeback that went the distance).
 * SF2: e2 sweeps e4. Final: e1 beats e2 2–0. Souls on every game but the final's game 2.
 */
function fourDeckComplete() {
  const matches = buildBracket(entries(4), ids);
  const sf1 = at(matches, 1, 0);
  const sf2 = at(matches, 1, 1);
  const final = at(matches, 2, 0);
  sf1.winnerEntryId = 'e1';
  sf2.winnerEntryId = 'e2';
  final.entryAId = 'e1';
  final.entryBId = 'e2';
  final.winnerEntryId = 'e1';
  const games: BracketGame[] = [
    game(1, 'e3', { id: 's1', matchId: sf1.id, mode: 'solo', firstEntryId: 'e1', soulsA: 3, soulsB: 5, finishedAt: after(20) }),
    game(2, 'e1', { id: 's2', matchId: sf1.id, mode: 'solo', firstEntryId: 'e3', soulsA: 5, soulsB: 4, finishedAt: after(45) }),
    game(3, 'e1', { id: 's3', matchId: sf1.id, mode: 'solo', firstEntryId: 'e3', soulsA: 5, soulsB: 1, finishedAt: after(12) }),
    game(1, 'e2', { id: 't1', matchId: sf2.id, mode: 'solo', firstEntryId: 'e4', soulsA: 5, soulsB: 2, finishedAt: after(30) }),
    game(2, 'e2', { id: 't2', matchId: sf2.id, mode: 'online', firstEntryId: 'e2', soulsA: 5, soulsB: 3, finishedAt: after(25) }),
    game(1, 'e1', { id: 'f1', matchId: final.id, mode: 'solo', firstEntryId: 'e2', soulsA: 5, soulsB: 2, finishedAt: after(18) }),
    game(2, 'e1', { id: 'f2', matchId: final.id, mode: 'manual' }),
  ];
  return { bracket: bracket({ status: 'complete', championEntryId: 'e1' }), entries: entries(4), matches, games };
}

describe('placeForRound', () => {
  it('ranks the tier a round\'s losers finish in', () => {
    expect(placeForRound(8, 1)).toBe(5);
    expect(placeForRound(8, 2)).toBe(3);
    expect(placeForRound(8, 3)).toBe(2);
    expect(placeForRound(16, 1)).toBe(9);
  });
});

describe('gameMinutes', () => {
  it('rounds the table time to whole minutes', () => {
    expect(gameMinutes(game(1, 'e1', { mode: 'solo', finishedAt: after(22.4) }))).toBe(22);
  });
  it('is null for hand-recorded, unfinished, and resumed-later games', () => {
    expect(gameMinutes(game(1, 'e1', { mode: 'manual', finishedAt: after(22) }))).toBeNull();
    expect(gameMinutes(game(1, null, { mode: 'solo' }))).toBeNull();
    expect(gameMinutes(game(1, 'e1', { mode: 'solo', finishedAt: after(181) }))).toBeNull();
  });
});

describe('computeStandings', () => {
  it('orders a complete bracket champion, runner-up, then the semifinal losers by record', () => {
    const rows = computeStandings(fourDeckComplete());
    expect(rows.map(r => r.entry.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(rows.map(r => r.finishLabel)).toEqual(['Champion', 'Runner-up', 'Semifinalist', 'Semifinalist']);
    expect(rows[2].finish).toEqual({ kind: 'out', place: 3, round: 1 });
  });

  it('totals games, series, and souls from the deck\'s own side', () => {
    const rows = computeStandings(fourDeckComplete());
    const e1 = rows[0];
    expect(e1.games).toEqual({ won: 4, lost: 1 });
    expect(e1.series).toEqual({ won: 2, lost: 0 });
    // Four scored games for e1: 3–5, 5–4, 5–1, 5–2; the hand-recorded final game 2 has no souls.
    expect(e1.souls).toEqual({ rescued: 18, conceded: 12, games: 4 });
    const e3 = rows[2];
    expect(e3.games).toEqual({ won: 1, lost: 2 });
    expect(e3.souls).toEqual({ rescued: 10, conceded: 13, games: 3 });
  });

  it('writes the road game by game from the deck\'s perspective', () => {
    const rows = computeStandings(fourDeckComplete());
    const e3 = rows[2];
    expect(e3.road).toHaveLength(1);
    expect(e3.road[0]).toMatchObject({ label: 'SF1', opponentName: 'Deck 1', won: false, wins: 1, losses: 2 });
    expect(e3.road[0].games[0]).toEqual({
      gameNumber: 1, won: true, wentFirst: false, souls: { own: 5, opponent: 3 }, minutes: 20, byHand: false,
    });
    const final = rows[0].road[1];
    expect(final.label).toBe('Final');
    expect(final.games[1]).toEqual({ gameNumber: 2, won: true, wentFirst: null, souls: null, minutes: null, byHand: true });
    expect(describeSeries(final, 3)).toBe('Beat Deck 2 2–0');
    expect(describeSeries(e3.road[0], 3)).toBe('Lost to Deck 1 1–2');
    expect(describeSeries(e3.road[0], 1)).toBe('Lost to Deck 1');
  });

  it('keeps live decks on top while the bracket is active, deeper rounds first', () => {
    const data = fourDeckComplete();
    const final = at(data.matches, 2, 0);
    final.winnerEntryId = null;
    const games = data.games.filter(g => g.matchId !== final.id);
    const rows = computeStandings({ ...data, bracket: bracket(), games });
    // Both finalists are still in; e2's sweep (2–0) outranks e1's 2–1 on record.
    expect(rows.map(r => r.entry.id)).toEqual(['e2', 'e1', 'e3', 'e4']);
    expect(rows[0].finish).toEqual({ kind: 'alive', reached: 2 });
    expect(rows[0].finishLabel).toBe('Still in');
    expect(rows[1].finish).toEqual({ kind: 'alive', reached: 2 });
    expect(rows[2].finishLabel).toBe('Semifinalist');
    expect(rows[0].souls).toEqual({ rescued: 10, conceded: 5, games: 2 });
    expect(rows[1].souls).toEqual({ rescued: 13, conceded: 10, games: 3 });
  });

  it('counts a round-one bye as a seat in the next round, not a series', () => {
    const matches = buildBracket(entries(3), ids);
    const rows = computeStandings({ bracket: bracket(), entries: entries(3), matches, games: [] });
    const e2 = rows.find(r => r.entry.id === 'e2')!;
    expect(e2.finish).toEqual({ kind: 'alive', reached: 2 });
    expect(e2.road).toEqual([]);
    expect(rows[0].entry.id).toBe('e2');
  });

  it('ranks a decided deck above live decks that can still finish below it', () => {
    // Eight decks, played out of order: QF1, QF2 and SF1 done, QF3 and QF4 untouched.
    const matches = buildBracket(entries(8), ids);
    const qf1 = at(matches, 1, 0);
    const qf2 = at(matches, 1, 1);
    const sf1 = at(matches, 2, 0);
    qf1.winnerEntryId = qf1.entryAId;
    qf2.winnerEntryId = qf2.entryAId;
    sf1.entryAId = qf1.winnerEntryId;
    sf1.entryBId = qf2.winnerEntryId;
    sf1.winnerEntryId = sf1.entryAId;
    const rows = computeStandings({ bracket: bracket({ size: 8 }), entries: entries(8), matches, games: [] });
    const labels = rows.map(r => `${r.entry.id}:${r.finishLabel}`);
    // The finalist, then the semifinal loser (3rd at worst), then the four unplayed
    // quarterfinalists (5th at worst), then the two quarterfinal losers.
    expect(labels.slice(0, 2)).toEqual([`${sf1.entryAId}:Still in`, `${sf1.entryBId}:Semifinalist`]);
    expect(labels.slice(2, 6).every(l => l.endsWith(':Still in'))).toBe(true);
    expect(labels.slice(6).every(l => l.endsWith(':Quarterfinalist'))).toBe(true);
  });

  it('reads the champion from the final when the champion column lags behind', () => {
    const data = fourDeckComplete();
    const rows = computeStandings({ ...data, bracket: bracket({ championEntryId: null }) });
    expect(rows[0].entry.id).toBe('e1');
    expect(rows[0].finishLabel).toBe('Champion');
  });
});

describe('computeMoments', () => {
  it('names the closest game, the blowout, the comeback, and the timed extremes', () => {
    const moments = computeMoments(fourDeckComplete());
    expect(moments.map(m => m.kind)).toEqual(['closest', 'blowout', 'comeback', 'longest', 'fastest']);
    expect(moments[0].text).toBe('SF1, game 2 · Deck 1 5–4 Deck 3');
    expect(moments[1].text).toBe('SF1, game 3 · Deck 1 5–1 Deck 3');
    expect(moments[2].text).toBe('Deck 1 came back from 0–1 to take SF1 2–1');
    expect(moments[3].text).toBe('SF1, game 2 · 45 min · Deck 1 over Deck 3');
    expect(moments[4].text).toBe('SF1, game 3 · 12 min · Deck 1 over Deck 3');
  });

  it('reports a series that went the distance without a comeback', () => {
    const data = fourDeckComplete();
    // Rewrite SF1 so e1 wins game 1 and game 3: the distance, but no comeback.
    const s1 = data.games.find(g => g.id === 's1')!;
    const s2 = data.games.find(g => g.id === 's2')!;
    s1.winnerEntryId = 'e1';
    s2.winnerEntryId = 'e3';
    const moments = computeMoments(data);
    expect(moments.find(m => m.kind === 'distance')?.text).toBe('SF1 · Deck 1 2–1 Deck 3');
    expect(moments.some(m => m.kind === 'comeback')).toBe(false);
  });

  it('skips souls lines where the winner ended short, and is empty with nothing played', () => {
    const data = fourDeckComplete();
    // A resignation: the winner has fewer souls. Only that game has souls.
    data.games = [game(1, 'e1', { id: 's1', matchId: at(data.matches, 1, 0).id, mode: 'solo', soulsA: 2, soulsB: 4, finishedAt: after(10) })];
    expect(computeMoments(data)).toEqual([]);
    expect(computeMoments({ ...data, games: [] })).toEqual([]);
  });

  it('needs two scored games before calling one the closest', () => {
    const data = fourDeckComplete();
    data.games = [game(1, 'e1', { id: 's1', matchId: at(data.matches, 1, 0).id, mode: 'solo', soulsA: 5, soulsB: 3, finishedAt: after(10) })];
    expect(computeMoments(data)).toEqual([]);
  });

  it('never names a resignation as the fastest win', () => {
    const data = fourDeckComplete();
    const sf1 = at(data.matches, 1, 0).id;
    const sf2 = at(data.matches, 1, 1).id;
    data.games = [
      // Wrong deck loaded, resigned after a minute: the winner is behind on souls.
      game(1, 'e1', { id: 's1', matchId: sf1, mode: 'solo', soulsA: 0, soulsB: 1, finishedAt: after(1) }),
      game(2, 'e1', { id: 's2', matchId: sf1, mode: 'solo', soulsA: 5, soulsB: 2, finishedAt: after(20) }),
      game(1, 'e2', { id: 't1', matchId: sf2, mode: 'solo', soulsA: 5, soulsB: 4, finishedAt: after(30) }),
    ];
    const moments = computeMoments(data);
    expect(moments.find(m => m.kind === 'fastest')?.text).toBe('SF1, game 2 · 20 min · Deck 1 over Deck 3');
    expect(moments.find(m => m.kind === 'longest')?.text).toBe('SF2, game 1 · 30 min · Deck 2 over Deck 4');
  });

  it('drops scores and game numbers for best-of-one', () => {
    const data = fourDeckComplete();
    data.bracket = bracket({ bestOf: 1, status: 'complete', championEntryId: 'e1' });
    data.games = [
      game(1, 'e1', { id: 's1', matchId: at(data.matches, 1, 0).id, mode: 'solo', soulsA: 5, soulsB: 4 }),
      game(1, 'e2', { id: 't1', matchId: at(data.matches, 1, 1).id, mode: 'solo', soulsA: 5, soulsB: 0 }),
    ];
    const moments = computeMoments(data);
    expect(moments.map(m => m.text)).toEqual(['SF1 · Deck 1 5–4 Deck 3', 'SF2 · Deck 2 5–0 Deck 4']);
  });
});

describe('goingFirst', () => {
  it('counts every played game and ignores hand-recorded games', () => {
    // s1 (e1 first, e3 won), t1 (e4 first, e2 won), f1 (e2 first, e1 won), s2 (e3 first, e1 won),
    // s3 (e3 first, e1 won), t2 (e2 first, e2 won) → 1 of 6; f2 by hand.
    expect(goingFirst(fourDeckComplete().games)).toEqual({ firstWon: 1, total: 6 });
  });
});
