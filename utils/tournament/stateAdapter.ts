// Supabase ↔ TournamentState mapping. Used by anything that needs to feed
// the lib/tournament/* pure modules with state pulled from the database.

import type {
  TournamentState, Participant, Match, MatchResult, Bye, MatchOutcome,
} from "../../lib/tournament/types";
import { forfeitOutcomes, forfeitSideOf } from "../../lib/tournament/dropForfeit";

/** Loose Supabase client type — accepts both the browser and server clients. */
type AnyClient = {
  from: (table: string) => any;
};

/**
 * Map a DB match row into a MatchResult.
 *
 * The DB stores raw scores plus is_tie + winner_id; partial-vs-full is
 * derived by comparing the winner's score against soulCap (max_score).
 *
 * A forfeit (migration 110) is stored as souls 0–0 plus a per-side flag; the
 * flags are checked first so the 0–0 never reads as a tie.
 *
 * Fallback for legacy data: tournaments scored before is_tie/winner_id were
 * persisted by match-edit.tsx have those columns null. If both scores are
 * present we derive the result from them — equal scores → tie, otherwise
 * the higher score wins.
 *
 * Exported for unit tests only.
 */
export function toMatchResult(m: any, soulCap: number): MatchResult | undefined {
  if (m.player1_score === null || m.player2_score === null) return undefined;
  const p1Souls = Number(m.player1_score);
  const p2Souls = Number(m.player2_score);
  const forfeit = forfeitSideOf(m);
  if (forfeit) return { p1Souls, p2Souls, ...forfeitOutcomes(forfeit) };
  if (m.is_tie || (m.winner_id == null && p1Souls === p2Souls)) {
    return { p1Souls, p2Souls, p1Outcome: "tie", p2Outcome: "tie" };
  }
  let p1Won: boolean;
  if (m.winner_id === m.player1_id) p1Won = true;
  else if (m.winner_id === m.player2_id) p1Won = false;
  else if (m.winner_id == null) p1Won = p1Souls > p2Souls;
  else return undefined;

  const winnerSouls = p1Won ? p1Souls : p2Souls;
  const isFullWin = winnerSouls >= soulCap;
  const winnerOutcome: MatchOutcome = isFullWin ? "full_win" : "partial_win";
  const loserOutcome: MatchOutcome = isFullWin ? "full_loss" : "partial_loss";
  return p1Won
    ? { p1Souls, p2Souls, p1Outcome: winnerOutcome, p2Outcome: loserOutcome }
    : { p1Souls, p2Souls, p1Outcome: loserOutcome, p2Outcome: winnerOutcome };
}

/** Build a TournamentState from a tournament's DB rows. */
export async function buildStateFromSupabase(
  client: AnyClient,
  tournamentId: string,
): Promise<TournamentState | null> {
  const { data: t } = await client
    .from("tournaments")
    .select("id, n_rounds, current_round, max_score, has_started, has_ended, starting_table_number, numbering_mode")
    .eq("id", tournamentId)
    .single();
  if (!t) return null;
  const soulCap = t.max_score ?? 5;

  const { data: parts } = await client
    .from("participants")
    .select("id, name, joined_at, dropped_out, assigned_seat")
    .eq("tournament_id", tournamentId);
  const participants: Participant[] = (parts || []).map((p: any) => ({
    id: p.id,
    name: p.name ?? "",
    joinedAt: p.joined_at ?? new Date(0).toISOString(),
    droppedOut: !!p.dropped_out,
    assignedSeat: p.assigned_seat ?? undefined,
  }));

  const { data: matchRows } = await client
    .from("matches")
    .select("id, round, player1_id, player2_id, match_order, player1_score, player2_score, is_tie, winner_id, player1_forfeit, player2_forfeit")
    .eq("tournament_id", tournamentId);
  const matches: Match[] = (matchRows || []).map((m: any) => ({
    id: m.id,
    round: m.round,
    player1Id: m.player1_id,
    player2Id: m.player2_id,
    matchOrder: m.match_order ?? 0,
    result: toMatchResult(m, soulCap),
  }));

  const { data: byeRows } = await client
    .from("byes")
    .select("participant_id, round_number")
    .eq("tournament_id", tournamentId);
  const byes: Bye[] = (byeRows || []).map((b: any) => ({
    participantId: b.participant_id,
    round: Number(b.round_number),
  }));

  // Rounds that have actually started. A bye only scores once its round has
  // started (Option C) — a round staged by End Round but not yet started must
  // not award its bye's points. recomputeTotalsFromHistory reads this.
  const { data: roundRows } = await client
    .from("rounds")
    .select("round_number, started_at")
    .eq("tournament_id", tournamentId);
  const startedRounds: number[] = (roundRows || [])
    .filter((r: any) => r.started_at != null)
    .map((r: any) => Number(r.round_number));

  return {
    id: t.id,
    nRounds: t.n_rounds ?? 0,
    currentRound: t.current_round ?? 0,
    soulCap,
    hasStarted: !!t.has_started,
    hasEnded: !!t.has_ended,
    participants,
    matches,
    byes,
    startedRounds,
    startingTableNumber: t.starting_table_number ?? 1,
    numberingMode: t.numbering_mode === "seats" ? "seats" : "tables",
  };
}
