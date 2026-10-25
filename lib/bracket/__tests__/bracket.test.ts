import { describe, it, expect } from 'vitest';
import { canEditBracket, sizeFor, slotOrder, roundNames, matchLabel, nextSlot, buildBracket, seriesState,
  matchState, canPlayMatch, applyGameResult, resetMatchAllowed, resetMatchUpdates, reconcileUpdates } from '../index';
import type { BracketMatch, Bracket } from '../types';
import { entry, entries, ids, match, game } from './fixtures';


describe('sizeFor', () => {
  it.each([[2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16], [16, 16]])('%i decks → size %i', (n, size) => expect(sizeFor(n)).toBe(size));
  it('rejects 1 and 17', () => { expect(() => sizeFor(1)).toThrow(RangeError); expect(() => sizeFor(17)).toThrow(RangeError); });
});

describe('slotOrder', () => {
  it('fills every a slot top-down, then every b slot', () => {
    expect(slotOrder(8)).toEqual([
      { position: 0, side: 'a' }, { position: 1, side: 'a' }, { position: 2, side: 'a' }, { position: 3, side: 'a' },
      { position: 0, side: 'b' }, { position: 1, side: 'b' }, { position: 2, side: 'b' }, { position: 3, side: 'b' }]);
  });
  it('never produces a bye-vs-bye for any count 2..16', () => {
    for (let n = 2; n <= 16; n++) {
      const ms = buildBracket(entries(n), ids).filter(m => m.round === 1);
      expect(ms.every(m => m.entryAId !== null)).toBe(true);
    }
  });
});

describe('roundNames / matchLabel / nextSlot', () => {
  it('names rounds by size', () => {
    expect(roundNames(2)).toEqual(['Final']);
    expect(roundNames(4)).toEqual(['Semifinals', 'Final']);
    expect(roundNames(8)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(roundNames(16)).toEqual(['Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
  });
  it('labels matches', () => {
    expect(matchLabel(8, 1, 0)).toBe('QF1'); expect(matchLabel(8, 2, 1)).toBe('SF2');
    expect(matchLabel(8, 3, 0)).toBe('Final'); expect(matchLabel(16, 1, 2)).toBe('R16-3');
  });
  it('feeds the next round', () => {
    expect(nextSlot(1, 0)).toEqual({ round: 2, position: 0, side: 'a' });
    expect(nextSlot(1, 3)).toEqual({ round: 2, position: 1, side: 'b' });
  });
});

describe('buildBracket', () => {
  it('builds 7 matches for 8 decks with no byes', () => {
    const ms = buildBracket(entries(8), ids);
    expect(ms).toHaveLength(7);
    expect(ms.filter(m => m.isBye)).toHaveLength(0);
    expect(ms.find(m => m.round === 3)!.entryAId).toBeNull();
  });
  it('decides byes at creation and advances them', () => {
    const ms = buildBracket(entries(6), ids);
    const byes = ms.filter(m => m.isBye);
    expect(byes.map(m => m.position)).toEqual([2, 3]);
    expect(byes[0].winnerEntryId).toBe('e3');
    const sf2 = ms.find(m => m.round === 2 && m.position === 1)!;
    expect(sf2.entryAId).toBe('e3'); expect(sf2.entryBId).toBe('e4');
  });
  it('two decks is just the final', () => {
    const ms = buildBracket(entries(2), ids);
    expect(ms).toHaveLength(1); expect(ms[0].round).toBe(1);
    expect(ms[0].entryAId).toBe('e1'); expect(ms[0].entryBId).toBe('e2');
  });
  it('three decks has one bye', () => {
    const ms = buildBracket(entries(3), ids);
    expect(ms.filter(m => m.isBye)).toHaveLength(1);
    // slotOrder(4) = a0, a1, b0, b1 → e1 v e3 in match 0, e2 v bye in match 1
    expect(ms.find(m => m.round === 2)!.entryBId).toBe('e2');
  });
});


describe('seriesState', () => {
  it('Bo3 at 1–1 needs one more', () => {
    const s = seriesState([game(1, 'e1'), game(2, 'e2')], match(), 3);
    expect(s).toMatchObject({ winsA: 1, winsB: 1, needed: 2, decided: false, winner: null, nextGameNumber: 3, inProgress: null });
  });
  it('Bo3 at 2–0 is decided for a', () => {
    expect(seriesState([game(1, 'e1'), game(2, 'e1')], match(), 3)).toMatchObject({ decided: true, winner: 'a' });
  });
  it('Bo1 decides after one game; an unfinished game is inProgress', () => {
    expect(seriesState([game(1, 'e2')], match(), 1)).toMatchObject({ decided: true, winner: 'b' });
    expect(seriesState([game(1, null)], match(), 5).inProgress?.id).toBe('g1');
  });
});

describe('matchState / canPlayMatch', () => {
  it('derives every state', () => {
    expect(matchState(match({ isBye: true, entryBId: null, winnerEntryId: 'e1' }), [], 3)).toBe('bye');
    expect(matchState(match({ entryBId: null }), [], 3)).toBe('waiting');
    expect(matchState(match(), [], 3)).toBe('ready');
    expect(matchState(match(), [game(1, null)], 3)).toBe('live');
    expect(matchState(match({ winnerEntryId: 'e1' }), [game(1, 'e1'), game(2, 'e1')], 3)).toBe('done');
  });
  it('a deleted deck blocks play but not recording', () => {
    const byId = new Map([['e1', entry(1, null)], ['e2', entry(2)]]);
    expect(canPlayMatch(match(), byId, 'ready')).toBe(false);
    expect(canPlayMatch(match(), new Map([['e1', entry(1)], ['e2', entry(2)]]), 'ready')).toBe(true);
  });
});

describe('applyGameResult', () => {
  const bracket: Bracket = { id: 'b', name: 'x', format: 'T1', size: 4, bestOf: 3, status: 'active', championEntryId: null };
  const matches = (): BracketMatch[] => [
    match({ id: 'm1', round: 1, position: 0 }),
    match({ id: 'm2', round: 1, position: 1, entryAId: 'e3', entryBId: 'e4' }),
    match({ id: 'm3', round: 2, position: 0, entryAId: null, entryBId: null }),
  ];
  it('records an undecided series game only', () => {
    const ups = applyGameResult({ bracket, matches: matches(), games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e1' });
    expect(ups).toEqual([{ kind: 'game', gameId: 'g1', winnerEntryId: 'e1' }]);
  });
  it('advances the winner into the next slot when the series is decided', () => {
    const ups = applyGameResult({ bracket, matches: matches(), games: [game(1, 'e1'), game(2, null)], gameId: 'g2', winnerEntryId: 'e1' });
    expect(ups).toEqual([
      { kind: 'game', gameId: 'g2', winnerEntryId: 'e1' },
      { kind: 'match-winner', matchId: 'm1', winnerEntryId: 'e1' },
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: 'e1' },
    ]);
  });
  it('crowns the champion after the final', () => {
    const ms = matches(); ms[2].entryAId = 'e1'; ms[2].entryBId = 'e3';
    const gs = [game(1, 'e3', { id: 'f1', matchId: 'm3' }), game(2, null, { id: 'f2', matchId: 'm3' })];
    const ups = applyGameResult({ bracket, matches: ms, games: gs, gameId: 'f2', winnerEntryId: 'e3' });
    expect(ups.at(-1)).toEqual({ kind: 'champion', entryId: 'e3' });
  });
  it('refuses a decided game, a decided match, and a foreign winner', () => {
    expect(() => applyGameResult({ bracket, matches: matches(), games: [game(1, 'e1')], gameId: 'g1', winnerEntryId: 'e1' })).toThrow('game already decided');
    const ms = matches(); ms[0].winnerEntryId = 'e1';
    expect(() => applyGameResult({ bracket, matches: ms, games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e1' })).toThrow('match already decided');
    expect(() => applyGameResult({ bracket, matches: matches(), games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e9' })).toThrow('winner is not in this match');
  });
});

describe('reset', () => {
  const bracket: Bracket = { id: 'b', name: 'x', format: 'T1', size: 4, bestOf: 1, status: 'complete', championEntryId: 'e1' };
  const ms: BracketMatch[] = [
    match({ id: 'm1', winnerEntryId: 'e1' }),
    match({ id: 'm2', position: 1, entryAId: 'e3', entryBId: 'e4', winnerEntryId: 'e3' }),
    match({ id: 'm3', round: 2, entryAId: 'e1', entryBId: 'e3', winnerEntryId: 'e1' }),
  ];
  it('allows a reset only while the fed match has no games', () => {
    expect(resetMatchAllowed(ms, [game(1, 'e1', { id: 'f1', matchId: 'm3' })], 'm1')).toBe(false);
    expect(resetMatchAllowed(ms, [], 'm1')).toBe(true);
    expect(resetMatchAllowed(ms, [game(1, 'e1', { id: 'f1', matchId: 'm3' })], 'm3')).toBe(true);
    expect(resetMatchAllowed([match({ isBye: true })], [], 'm1')).toBe(false);
  });
  it('clears the winner, the fed slot and the champion', () => {
    expect(resetMatchUpdates(ms, bracket, 'm3')).toEqual([
      { kind: 'match-winner', matchId: 'm3', winnerEntryId: '' },
      { kind: 'champion', entryId: null },
    ]);
    expect(resetMatchUpdates(ms, bracket, 'm1')).toEqual([
      { kind: 'match-winner', matchId: 'm1', winnerEntryId: '' },
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: null },
    ]);
  });
});

describe('reconcileUpdates', () => {
  const bracket: Bracket = { id: 'b', name: 'x', format: 'T1', size: 4, bestOf: 3, status: 'active', championEntryId: null };
  const base = (): BracketMatch[] => [
    match({ id: 'm1', round: 1, position: 0 }),
    match({ id: 'm2', round: 1, position: 1, entryAId: 'e3', entryBId: 'e4' }),
    match({ id: 'm3', round: 2, position: 0, entryAId: null, entryBId: null }),
  ];
  it('emits nothing for a consistent bracket', () => {
    const ms = base(); ms[0].winnerEntryId = 'e1'; ms[2].entryAId = 'e1';
    expect(reconcileUpdates(bracket, ms, [game(1, 'e1'), game(2, 'e1')])).toEqual([]);
  });
  it('emits match-winner and match-slot for a decided series with no match winner', () => {
    expect(reconcileUpdates(bracket, base(), [game(1, 'e1'), game(2, 'e1')])).toEqual([
      { kind: 'match-winner', matchId: 'm1', winnerEntryId: 'e1' },
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: 'e1' },
    ]);
  });
  it('emits only match-slot when the winner is set but the fed slot is empty', () => {
    const ms = base(); ms[0].winnerEntryId = 'e1';
    expect(reconcileUpdates(bracket, ms, [game(1, 'e1'), game(2, 'e1')])).toEqual([
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: 'e1' },
    ]);
  });
  it('emits champion when the final is won but no champion is set', () => {
    const ms = base(); ms[2].entryAId = 'e1'; ms[2].entryBId = 'e3'; ms[2].winnerEntryId = 'e3';
    ms[0].winnerEntryId = 'e1'; ms[1].winnerEntryId = 'e3';
    ms[0].isBye = true; ms[1].isBye = true;
    expect(reconcileUpdates(bracket, ms, [])).toEqual([{ kind: 'champion', entryId: 'e3' }]);
  });
});

describe('canEditBracket', () => {
  it('is editable until the first result is recorded', () => {
    expect(canEditBracket([])).toBe(true);
    expect(canEditBracket([game(1, null)])).toBe(true);
    expect(canEditBracket([game(1, 'e1')])).toBe(false);
    expect(canEditBracket([game(1, null), game(2, 'e1')])).toBe(false);
  });
});
