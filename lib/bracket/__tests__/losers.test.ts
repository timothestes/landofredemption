import { describe, it, expect } from 'vitest';
import {
  applyGameResult, buildBracket, byPlayOrder, currentRoundName, labelForMatch, losersMatches, reconcileUpdates,
  resetMatchAllowed, resetMatchUpdates, shapeOf, sizeFor,
} from '../index';
import { computeStandings } from '../standings';
import type { Bracket, BracketGame, BracketMatch, RowUpdate } from '../types';
import { entries, game } from './fixtures';

let n = 0;
const ids = () => `x${++n}`;

interface State { bracket: Bracket; matches: BracketMatch[]; games: BracketGame[] }

function start(count: number, losers = true): State {
  return {
    bracket: { id: 'b', name: 'x', format: 'T1', size: sizeFor(count), bestOf: 1, status: 'active', championEntryId: null },
    matches: buildBracket(entries(count), ids, losers),
    games: [],
  };
}

function apply(s: State, updates: RowUpdate[]) {
  for (const u of updates) {
    if (u.kind === 'game') s.games = s.games.map(g => (g.id === u.gameId ? { ...g, winnerEntryId: u.winnerEntryId } : g));
    else if (u.kind === 'match-winner') s.matches.find(m => m.id === u.matchId)!.winnerEntryId = u.winnerEntryId || null;
    else if (u.kind === 'match-slot') {
      const m = s.matches.find(x => x.id === u.matchId)!;
      if (u.side === 'a') m.entryAId = u.entryId;
      else m.entryBId = u.entryId;
    } else {
      s.bracket = { ...s.bracket, championEntryId: u.entryId, status: u.entryId ? 'complete' : 'active' };
    }
  }
}

function play(s: State, match: BracketMatch, winner: 'a' | 'b') {
  const g = game(1, null, { id: `g-${match.id}`, matchId: match.id });
  s.games.push(g);
  apply(s, applyGameResult({ ...s, gameId: g.id, winnerEntryId: (winner === 'a' ? match.entryAId : match.entryBId)! }));
}

/** Plays every ready match in play order until none is left; `pick` chooses the winner. */
function playOut(s: State, pick: (m: BracketMatch) => 'a' | 'b' = () => 'a') {
  for (let guard = 0; guard < 100; guard++) {
    const ready = [...s.matches].sort(byPlayOrder).find(m => !m.isBye && !m.winnerEntryId && m.entryAId && m.entryBId);
    if (!ready) return;
    play(s, ready, pick(ready));
  }
  throw new Error('did not finish');
}

const count = (s: State, stage: string, round?: number) =>
  s.matches.filter(m => m.stage === stage && (round === undefined || m.round === round)).length;

describe('buildBracket with a losers bracket', () => {
  it('lays out 8 decks: 7 winners matches, 6 losers matches, one grand final', () => {
    const s = start(8);
    expect(count(s, 'winners')).toBe(7);
    expect([1, 2, 3, 4].map(r => count(s, 'losers', r))).toEqual([2, 2, 1, 1]);
    expect(count(s, 'final')).toBe(1);
    expect(s.matches.some(m => m.isBye)).toBe(false);
    expect(shapeOf(s.matches)).toEqual({ size: 8, losers: true });
  });

  it('names the stages', () => {
    const shape = { size: 8 as const, losers: true };
    expect(labelForMatch(shape, { stage: 'winners', round: 3, position: 0 })).toBe('Winners final');
    expect(labelForMatch(shape, { stage: 'losers', round: 1, position: 1 })).toBe('L1-2');
    expect(labelForMatch(shape, { stage: 'losers', round: 4, position: 0 })).toBe('Losers final');
    expect(labelForMatch(shape, { stage: 'final', round: 1, position: 0 })).toBe('Grand final');
  });

  it('refuses a losers bracket for two decks', () => {
    expect(() => buildBracket(entries(2), ids, true)).toThrow('at least 3');
  });

  it('marks losers byes where a first-round bye leaves no loser', () => {
    // 6 decks: QF3 and QF4 are byes, so L1-2 can never fill and L2-2 only takes the SF2 drop.
    const s = start(6);
    const l1 = s.matches.filter(m => m.stage === 'losers' && m.round === 1).sort((x, y) => x.position - y.position);
    const l2 = s.matches.filter(m => m.stage === 'losers' && m.round === 2).sort((x, y) => x.position - y.position);
    expect(l1.map(m => m.isBye)).toEqual([false, true]);
    expect(l2.map(m => m.isBye)).toEqual([false, true]);
  });
});

describe('playing a losers bracket through', () => {
  it.each([3, 4, 5, 6, 7, 8, 11, 16])('%i decks: one champion, every other deck out after its second loss', deckCount => {
    const s = start(deckCount);
    playOut(s);
    expect(s.bracket.championEntryId).not.toBeNull();
    const losses = new Map<string, number>();
    for (const m of s.matches) {
      if (m.isBye || !m.winnerEntryId) continue;
      const loser = m.winnerEntryId === m.entryAId ? m.entryBId! : m.entryAId!;
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
    const champion = s.bracket.championEntryId!;
    for (const e of entries(deckCount)) {
      if (e.id === champion) expect(losses.get(e.id) ?? 0).toBe(0);
      else expect(losses.get(e.id)).toBe(2);
    }
    expect(currentRoundName(s.bracket, s.matches, s.games)).toBe('Complete');
  });

  it('a losers-bracket winner who takes the grand final is champion with one loss', () => {
    const s = start(4);
    playOut(s, m => (m.stage === 'final' ? 'b' : 'a'));
    const final = s.matches.find(m => m.stage === 'final')!;
    expect(s.bracket.championEntryId).toBe(final.entryBId);
  });

  it('never drops a deck straight into a rematch with the deck it just beat', () => {
    const s = start(8);
    playOut(s);
    const l2 = s.matches.filter(m => m.stage === 'losers' && m.round === 2);
    for (const m of l2) {
      const met = s.matches.filter(x => x.stage === 'winners' && [x.entryAId, x.entryBId].includes(m.entryAId)
        && [x.entryAId, x.entryBId].includes(m.entryBId));
      expect(met).toEqual([]);
    }
  });

  it('places 8 decks 1, 2, 3, 4, 5, 5, 7, 7', () => {
    const s = start(8);
    playOut(s);
    const rows = computeStandings({ ...s, entries: entries(8) });
    expect(rows.map(r => (r.finish.kind === 'out' ? r.finish.place : r.finish.kind === 'champion' ? 1 : 0)))
      .toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
    expect(rows.slice(0, 4).map(r => r.finishLabel)).toEqual(['Champion', 'Runner-up', 'Third', 'Fourth']);
  });

  it('keeps a deck that lost once in the winners bracket "still in"', () => {
    const s = start(4);
    const sf1 = s.matches.find(m => m.stage === 'winners' && m.round === 1 && m.position === 0)!;
    play(s, sf1, 'a');
    const loser = sf1.entryBId!;
    const row = computeStandings({ ...s, entries: entries(4) }).find(r => r.entry.id === loser)!;
    expect(row.finish.kind).toBe('alive');
  });
});

describe('reset with a losers bracket', () => {
  it('clears the dropped loser too, and passes back through a bye', () => {
    // 6 decks: L2-2 is a bye, and drops land in reverse, so SF1's loser passes straight through it.
    const t = start(6);
    const qfs = t.matches.filter(m => m.stage === 'winners' && m.round === 1 && !m.isBye);
    for (const m of qfs) play(t, m, 'a');
    const sf1 = t.matches.find(m => m.stage === 'winners' && m.round === 2 && m.position === 0)!;
    play(t, sf1, 'a');
    const l2bye = t.matches.find(m => m.stage === 'losers' && m.round === 2 && m.position === 1)!;
    expect(l2bye.winnerEntryId).toBe(sf1.entryBId);
    expect(resetMatchAllowed(t.matches, t.games, sf1.id)).toBe(true);
    const ups = resetMatchUpdates(t.matches, t.bracket, sf1.id);
    expect(ups).toContainEqual({ kind: 'match-winner', matchId: l2bye.id, winnerEntryId: '' });
    expect(ups.filter(u => u.kind === 'match-slot' && u.entryId === null)).toHaveLength(3);
  });

  it('is blocked once the losers match it fed has a game', () => {
    const s = start(4);
    const [sf1, sf2] = s.matches.filter(m => m.stage === 'winners' && m.round === 1);
    play(s, sf1, 'a');
    play(s, sf2, 'a');
    const l1 = s.matches.find(m => m.stage === 'losers' && m.round === 1)!;
    expect(resetMatchAllowed(s.matches, s.games, sf1.id)).toBe(true);
    play(s, l1, 'a');
    expect(resetMatchAllowed(s.matches, s.games, sf1.id)).toBe(false);
  });
});

describe('adding a losers bracket to a running bracket', () => {
  it('seats the decks that already lost', () => {
    const s = start(8, false);
    const qfs = s.matches.filter(m => m.round === 1).sort((x, y) => x.position - y.position);
    play(s, qfs[0], 'a');
    play(s, qfs[1], 'a');
    play(s, qfs[2], 'b');
    s.matches.push(...losersMatches(s.bracket.size, ids, s.matches));
    apply(s, reconcileUpdates(s.bracket, s.matches, s.games));
    const l1 = s.matches.filter(m => m.stage === 'losers' && m.round === 1).sort((x, y) => x.position - y.position);
    expect([l1[0].entryAId, l1[0].entryBId]).toEqual([qfs[0].entryBId, qfs[1].entryBId]);
    expect([l1[1].entryAId, l1[1].entryBId]).toEqual([qfs[2].entryAId, null]);
    // Winners side carries on unchanged; the final now feeds the grand final.
    playOut(s);
    expect(s.bracket.championEntryId).not.toBeNull();
  });
});
