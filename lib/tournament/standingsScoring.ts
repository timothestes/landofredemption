// lib/tournament/standingsScoring.ts
//
// Canonical per-match scoring used for live Standings display AND the test
// invariants. This MUST match the STORED-column behavior in
// supabase/migrations/039_byes_count_only_when_round_started.sql
// (the `recompute_participant_totals` SQL), so the live Standings numbers
// equal what End Round writes — that's the whole point of computing them live.
//
// NOTE: this is intentionally NOT lib/tournament/scoring.ts's soul-capped
// differential. Per migration 039 the stored differential is the UNCAPPED
// `player1_score - player2_score`. Keep these two formulas distinct on purpose.

import { forfeitScores, forfeitSideOf, type ForfeitFlags } from "./dropForfeit";

/** Minimal match shape needed for scoring: participant ids, raw scores, and
 * the forfeit flags (migration 110). The flags are optional so hand-built
 * rows in older tests still type-check; absent means "played normally". */
export interface ScorableMatch extends ForfeitFlags {
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
}

/**
 * Match points a participant earns from a single match. Mirrors the CASE in
 * recompute_participant_totals (migration 039):
 *   tie → 1.5; your full win (your score = max_score) → 3; opponent full win → 0;
 *   partial win (ahead, neither at cap) → 2; partial loss → 1; otherwise 0.
 * Returns 0 for matches the participant isn't in or that have NULL scores
 * (pre-staged next-round pairings).
 */
export function gameScoreForMatch(
  participantId: string,
  m: ScorableMatch,
  maxScore: number,
): number {
  if (m.player1_score === null || m.player2_score === null) return 0;
  const isP1 = m.player1_id === participantId;
  const isP2 = m.player2_id === participantId;
  if (!isP1 && !isP2) return 0;
  // Forfeits first: the stored 0–0 souls would otherwise read as a tie.
  const forfeit = forfeitSideOf(m);
  if (forfeit) return forfeitScores(forfeit)[isP1 ? "p1" : "p2"].gameScore;
  if (m.player1_score === m.player2_score) return 1.5;
  if (isP1 && m.player1_score === maxScore) return 3;
  if (isP2 && m.player2_score === maxScore) return 3;
  if (isP1 && m.player2_score === maxScore) return 0;
  if (isP2 && m.player1_score === maxScore) return 0;
  if (isP1 && m.player1_score > m.player2_score) return 2;
  if (isP1 && m.player1_score < m.player2_score) return 1;
  if (isP2 && m.player2_score > m.player1_score) return 2;
  if (isP2 && m.player2_score < m.player1_score) return 1;
  return 0;
}

/**
 * Differential a participant earns from a single match: UNCAPPED
 * `own_score - opponent_score`, matching migration 039's SUM. Returns 0 for
 * matches the participant isn't in or with NULL scores.
 */
export function differentialForMatch(
  participantId: string,
  m: ScorableMatch,
): number {
  if (m.player1_score === null || m.player2_score === null) return 0;
  const forfeit = forfeitSideOf(m);
  if (forfeit) {
    if (m.player1_id === participantId) return forfeitScores(forfeit).p1.lostSoulScore;
    if (m.player2_id === participantId) return forfeitScores(forfeit).p2.lostSoulScore;
    return 0;
  }
  if (m.player1_id === participantId) return m.player1_score - m.player2_score;
  if (m.player2_id === participantId) return m.player2_score - m.player1_score;
  return 0;
}
