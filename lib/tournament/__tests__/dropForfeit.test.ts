import { describe, it, expect } from 'vitest';
import {
  forfeitOutcomes,
  forfeitScores,
  forfeitMatchWrite,
  forfeitSideForDrops,
  matchOutcomeColumns,
  isForfeitedMatch,
  forfeitSideOf,
  matchesAwaitingResult,
} from '../dropForfeit';
import { gameScoreFor, lostSoulScoreFor } from '../scoring';

const P1 = 'p1-id';
const P2 = 'p2-id';

describe('forfeitOutcomes', () => {
  it('player1 forfeits → forfeit / forfeit_opponent', () => {
    expect(forfeitOutcomes('player1')).toEqual({
      p1Outcome: 'forfeit',
      p2Outcome: 'forfeit_opponent',
    });
  });
  it('player2 forfeits → forfeit_opponent / forfeit', () => {
    expect(forfeitOutcomes('player2')).toEqual({
      p1Outcome: 'forfeit_opponent',
      p2Outcome: 'forfeit',
    });
  });
  it('both forfeit → forfeit / forfeit', () => {
    expect(forfeitOutcomes('both')).toEqual({
      p1Outcome: 'forfeit',
      p2Outcome: 'forfeit',
    });
  });
});

describe('forfeitScores (algorithm.md: forfeiter 0 / −5, opponent 3 / 0)', () => {
  it('player1 forfeits: p1 gets 0 MP and −5, p2 gets 3 MP and 0', () => {
    expect(forfeitScores('player1')).toEqual({
      p1: { gameScore: 0, lostSoulScore: -5 },
      p2: { gameScore: 3, lostSoulScore: 0 },
    });
  });
  it('player2 forfeits: mirror image', () => {
    expect(forfeitScores('player2')).toEqual({
      p1: { gameScore: 3, lostSoulScore: 0 },
      p2: { gameScore: 0, lostSoulScore: -5 },
    });
  });
  it('both forfeit: both get 0 MP and −5 (nobody is awarded the win)', () => {
    expect(forfeitScores('both')).toEqual({
      p1: { gameScore: 0, lostSoulScore: -5 },
      p2: { gameScore: 0, lostSoulScore: -5 },
    });
  });
  it('is derived from scoring.ts, not re-declared', () => {
    // If the rule table in scoring.ts ever changes, this helper must follow it.
    const s = forfeitScores('player1');
    expect(s.p1.gameScore).toBe(gameScoreFor('forfeit'));
    expect(s.p1.lostSoulScore).toBe(lostSoulScoreFor('forfeit', 0, 0, 5));
    expect(s.p2.gameScore).toBe(gameScoreFor('forfeit_opponent'));
    expect(s.p2.lostSoulScore).toBe(lostSoulScoreFor('forfeit_opponent', 0, 0, 5));
  });
  it('is NOT the old max_score–0 auto-score (which gave the forfeiter −N and the opponent +N)', () => {
    const s = forfeitScores('player1');
    expect(s.p2.lostSoulScore).not.toBe(5);
    expect(s.p1.lostSoulScore).toBe(-5);
  });
});

describe('forfeitMatchWrite', () => {
  it('records 0–0 souls, the forfeit flag, no tie, and the opponent as winner', () => {
    expect(forfeitMatchWrite('player1', P1, P2)).toEqual({
      player1_score: 0,
      player2_score: 0,
      player1_forfeit: true,
      player2_forfeit: false,
      is_tie: false,
      winner_id: P2,
    });
    expect(forfeitMatchWrite('player2', P1, P2)).toEqual({
      player1_score: 0,
      player2_score: 0,
      player1_forfeit: false,
      player2_forfeit: true,
      is_tie: false,
      winner_id: P1,
    });
  });
  it('double forfeit has no winner and is not a tie', () => {
    expect(forfeitMatchWrite('both', P1, P2)).toEqual({
      player1_score: 0,
      player2_score: 0,
      player1_forfeit: true,
      player2_forfeit: true,
      is_tie: false,
      winner_id: null,
    });
  });
});

describe('forfeitSideForDrops', () => {
  it('maps mid-round drops to the side that forfeits', () => {
    expect(forfeitSideForDrops(true, false)).toBe('player1');
    expect(forfeitSideForDrops(false, true)).toBe('player2');
    expect(forfeitSideForDrops(true, true)).toBe('both');
  });
  it('returns null when nobody dropped (the match still needs a real score)', () => {
    expect(forfeitSideForDrops(false, false)).toBeNull();
  });
});

describe('matchOutcomeColumns', () => {
  it('played match: tie when equal, otherwise the higher score wins', () => {
    expect(matchOutcomeColumns({ player1_score: 3, player2_score: 3 }, P1, P2))
      .toEqual({ is_tie: true, winner_id: null });
    expect(matchOutcomeColumns({ player1_score: 5, player2_score: 2 }, P1, P2))
      .toEqual({ is_tie: false, winner_id: P1 });
    expect(matchOutcomeColumns({ player1_score: 1, player2_score: 4 }, P1, P2))
      .toEqual({ is_tie: false, winner_id: P2 });
  });
  it('a forfeit is never a tie even though the stored souls are 0–0', () => {
    expect(matchOutcomeColumns(
      { player1_score: 0, player2_score: 0, player1_forfeit: true, player2_forfeit: false }, P1, P2,
    )).toEqual({ is_tie: false, winner_id: P2 });
    expect(matchOutcomeColumns(
      { player1_score: 0, player2_score: 0, player1_forfeit: false, player2_forfeit: true }, P1, P2,
    )).toEqual({ is_tie: false, winner_id: P1 });
    expect(matchOutcomeColumns(
      { player1_score: 0, player2_score: 0, player1_forfeit: true, player2_forfeit: true }, P1, P2,
    )).toEqual({ is_tie: false, winner_id: null });
  });
});

describe('isForfeitedMatch / forfeitSideOf', () => {
  it('reads the flags off a match row', () => {
    expect(isForfeitedMatch({ player1_forfeit: true, player2_forfeit: false })).toBe(true);
    expect(isForfeitedMatch({ player1_forfeit: false, player2_forfeit: false })).toBe(false);
    expect(isForfeitedMatch({})).toBe(false);
    expect(forfeitSideOf({ player1_forfeit: true, player2_forfeit: false })).toBe('player1');
    expect(forfeitSideOf({ player1_forfeit: false, player2_forfeit: true })).toBe('player2');
    expect(forfeitSideOf({ player1_forfeit: true, player2_forfeit: true })).toBe('both');
    expect(forfeitSideOf({ player1_forfeit: false, player2_forfeit: false })).toBeNull();
  });
});

describe('matchesAwaitingResult', () => {
  const player = (dropped_out = false) => ({ dropped_out });
  const row = (p1: number | null, p2: number | null, p1Dropped = false, p2Dropped = false) => ({
    player1_score: p1,
    player2_score: p2,
    player1_id: player(p1Dropped),
    player2_id: player(p2Dropped),
  });

  it('lists the rows with no saved result, by position', () => {
    expect(matchesAwaitingResult([row(5, 2), row(null, null), row(3, 3), row(null, null)]))
      .toEqual([1, 3]);
  });
  it('is empty when every result is in, and for a round with no matches', () => {
    expect(matchesAwaitingResult([row(5, 2), row(0, 0)])).toEqual([]);
    expect(matchesAwaitingResult([])).toEqual([]);
  });
  it('a half-entered score is still awaiting', () => {
    expect(matchesAwaitingResult([row(5, null), row(null, 2)])).toEqual([0, 1]);
  });
  it('an unscored match with a dropped player is not awaiting: End Round forfeits it', () => {
    expect(matchesAwaitingResult([
      row(null, null, true, false),
      row(null, null, false, true),
      row(null, null, true, true),
      row(null, null),
    ])).toEqual([3]);
  });
  it('treats a row loaded without the dropped flag as not dropped', () => {
    expect(matchesAwaitingResult([
      { player1_score: null, player2_score: null, player1_id: {}, player2_id: null },
    ])).toEqual([0]);
  });
});
