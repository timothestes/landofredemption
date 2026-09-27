// lib/tournament/dropForfeit.ts
//
// The ONE place that turns "this player forfeited" into what gets written to
// a `matches` row and what it is worth. Shared by:
//   - the two End Round auto-score sites (a player who dropped mid-round
//     forfeits the unscored match),
//   - the score-entry modal's explicit Forfeit buttons,
//   - the live-standings and per-round scoring readers.
//
// The values come from scoring.ts (the rule table in algorithm.md):
//   forfeiter → game score 0, lost soul score −5
//   opponent  → game score 3, lost soul score 0
// A forfeit is persisted as souls 0–0 plus `player1_forfeit` /
// `player2_forfeit` flags (migration 110); the flags are what make the
// asymmetric −5 / 0 differential representable — no pair of soul counts can
// express it, which is why the old max_score–0 auto-score was wrong.

import { gameScoreFor, lostSoulScoreFor } from './scoring';
import type { MatchOutcome } from './types';

export type ForfeitSide = 'player1' | 'player2' | 'both';

/** The forfeit flags as stored on a `matches` row. */
export interface ForfeitFlags {
  player1_forfeit?: boolean | null;
  player2_forfeit?: boolean | null;
}

export function forfeitOutcomes(side: ForfeitSide): {
  p1Outcome: MatchOutcome;
  p2Outcome: MatchOutcome;
} {
  return {
    p1Outcome: side === 'player2' ? 'forfeit_opponent' : 'forfeit',
    p2Outcome: side === 'player1' ? 'forfeit_opponent' : 'forfeit',
  };
}

/** Per-side game score / lost soul score a forfeit is worth. */
export function forfeitScores(side: ForfeitSide): {
  p1: { gameScore: number; lostSoulScore: number };
  p2: { gameScore: number; lostSoulScore: number };
} {
  const { p1Outcome, p2Outcome } = forfeitOutcomes(side);
  // Souls are irrelevant for forfeit outcomes; scoring.ts ignores them.
  return {
    p1: { gameScore: gameScoreFor(p1Outcome), lostSoulScore: lostSoulScoreFor(p1Outcome, 0, 0, 0) },
    p2: { gameScore: gameScoreFor(p2Outcome), lostSoulScore: lostSoulScoreFor(p2Outcome, 0, 0, 0) },
  };
}

export function isForfeitedMatch(m: ForfeitFlags): boolean {
  return !!m.player1_forfeit || !!m.player2_forfeit;
}

export function forfeitSideOf(m: ForfeitFlags): ForfeitSide | null {
  if (m.player1_forfeit && m.player2_forfeit) return 'both';
  if (m.player1_forfeit) return 'player1';
  if (m.player2_forfeit) return 'player2';
  return null;
}

/** Which side forfeits when players dropped out mid-round; null if nobody did. */
export function forfeitSideForDrops(
  p1Dropped: boolean,
  p2Dropped: boolean,
): ForfeitSide | null {
  if (p1Dropped && p2Dropped) return 'both';
  if (p1Dropped) return 'player1';
  if (p2Dropped) return 'player2';
  return null;
}

/**
 * `is_tie` / `winner_id` for a scored match row. A forfeit is never a tie
 * (its stored souls are 0–0) — the non-forfeiting player wins, and a double
 * forfeit has no winner.
 */
export function matchOutcomeColumns(
  m: ForfeitFlags & { player1_score: number; player2_score: number },
  player1Id: string,
  player2Id: string,
): { is_tie: boolean; winner_id: string | null } {
  const side = forfeitSideOf(m);
  if (side === 'player1') return { is_tie: false, winner_id: player2Id };
  if (side === 'player2') return { is_tie: false, winner_id: player1Id };
  if (side === 'both') return { is_tie: false, winner_id: null };
  if (m.player1_score === m.player2_score) return { is_tie: true, winner_id: null };
  return {
    is_tie: false,
    winner_id: m.player1_score > m.player2_score ? player1Id : player2Id,
  };
}

/** The columns written to `matches` to record a forfeit. */
export interface ForfeitMatchWrite {
  player1_score: 0;
  player2_score: 0;
  player1_forfeit: boolean;
  player2_forfeit: boolean;
  is_tie: false;
  winner_id: string | null;
}

export function forfeitMatchWrite(
  side: ForfeitSide,
  player1Id: string,
  player2Id: string,
): ForfeitMatchWrite {
  const flags = {
    player1_forfeit: side !== 'player2',
    player2_forfeit: side !== 'player1',
  };
  const { winner_id } = matchOutcomeColumns(
    { ...flags, player1_score: 0, player2_score: 0 },
    player1Id,
    player2Id,
  );
  return { player1_score: 0, player2_score: 0, ...flags, is_tie: false, winner_id };
}
