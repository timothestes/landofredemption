// utils/tournament/saveMatchScore.ts
//
// The single live-round score write, shared by the score-entry modal
// (components/ui/match-edit.tsx) and the keyboard score grid
// (components/ui/ScoreGrid* in TournamentRounds.tsx).
//
// Extracted verbatim from match-edit.tsx so the two entry surfaces cannot
// drift on validation or on what gets written. Behavior is deliberately
// unchanged from the modal's original implementation, including the
// denormalized player{1,2}_match_points / differential{,2} snapshot columns.
//
// Scope note: this is the LIVE-ROUND path only. Correcting a result on a
// completed round still goes through repairMatchScoreAction ->
// repair_match_score, which recomputes participant totals from history.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserSafe } from "../supabase/getUserSafe";
import { forfeitMatchWrite, type ForfeitSide } from "../../lib/tournament/dropForfeit";

export type SaveScoreResult =
  | { ok: true }
  | { ok: false; error: string };

export const SESSION_EXPIRED_MESSAGE =
  "Your session expired — reload the page to sign back in, then re-enter the score.";

/**
 * Validate a score pair against the tournament's cap. Pure — used by the grid
 * to reject a keystroke before it ever reaches the network, and by the modal
 * to gate submit.
 *
 * Returns null when the pair is legal, otherwise the message to show.
 */
export function validateScorePair(
  p1: number | null,
  p2: number | null,
  maxScore: number,
): string | null {
  if (p1 === null || p2 === null) {
    return "Select a score for both players before submitting.";
  }
  if (Number.isNaN(p1) || Number.isNaN(p2)) {
    return `Invalid scores. Scores must be between 0 and ${maxScore}, inclusive.`;
  }
  if (p1 < 0 || p2 < 0 || p1 > maxScore || p2 > maxScore) {
    return `Invalid scores. Scores must be between 0 and ${maxScore}, inclusive.`;
  }
  // Both players reaching the soul cap is not a reachable game state.
  if (p1 === maxScore && p2 === maxScore) {
    return `Score cannot be ${maxScore}-${maxScore}.`;
  }
  return null;
}

/** Match points each player earns, mirroring lib/tournament/standingsScoring. */
export function matchPointsFor(
  p1Score: number,
  p2Score: number,
  maxScore: number,
): { p1: number; p2: number; isTie: boolean; p1Wins: boolean | null } {
  if (p1Score === p2Score) return { p1: 1.5, p2: 1.5, isTie: true, p1Wins: null };
  if (p1Score === maxScore) return { p1: 3, p2: 0, isTie: false, p1Wins: true };
  if (p2Score === maxScore) return { p1: 0, p2: 3, isTie: false, p1Wins: false };
  if (p1Score > p2Score) return { p1: 2, p2: 1, isTie: false, p1Wins: true };
  return { p1: 1, p2: 2, isTie: false, p1Wins: false };
}

/**
 * Write a live-round result. Reads both participants' running totals to build
 * the per-match snapshot columns, exactly as the modal has always done.
 */
export async function saveMatchScore(
  client: SupabaseClient,
  args: {
    matchId: string;
    player1Id: string;
    player2Id: string;
    player1Score: number;
    player2Score: number;
    maxScore: number;
  },
): Promise<SaveScoreResult> {
  const { matchId, player1Id, player2Id, player1Score, player2Score, maxScore } =
    args;

  const invalid = validateScorePair(player1Score, player2Score, maxScore);
  if (invalid) return { ok: false, error: invalid };

  // A read/write failure mid-round is most often a dead/expired session (the
  // owner-scoped RLS query returns no row). getUserSafe distinguishes that
  // (returns null) from a transient network blip, so flaky venue wifi shows a
  // generic retry message rather than a false "session expired".
  const hasValidSession = async () => !!(await getUserSafe(client));

  const [player1, player2] = await Promise.all([
    client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", player1Id)
      .single(),
    client
      .from("participants")
      .select("differential, match_points, id")
      .eq("id", player2Id)
      .single(),
  ]);

  if (player1.error || player2.error) {
    return {
      ok: false,
      error: (await hasValidSession())
        ? "Couldn't load player data. Please try again."
        : SESSION_EXPIRED_MESSAGE,
    };
  }

  const pts = matchPointsFor(player1Score, player2Score, maxScore);
  const winnerId = pts.isTie ? null : pts.p1Wins ? player1Id : player2Id;

  const { error } = await client
    .from("matches")
    .update({
      player1_score: player1Score,
      player2_score: player2Score,
      differential:
        (player1.data.differential ?? 0) + (player1Score - player2Score),
      differential2:
        (player2.data.differential ?? 0) + (player2Score - player1Score),
      player1_match_points: (player1.data.match_points || 0) + pts.p1,
      player2_match_points: (player2.data.match_points || 0) + pts.p2,
      is_tie: pts.isTie,
      winner_id: winnerId,
      // A real score replaces any forfeit recorded earlier on this row.
      player1_forfeit: false,
      player2_forfeit: false,
      updated_at: new Date(),
    })
    .eq("id", matchId);

  if (error) {
    return {
      ok: false,
      error: (await hasValidSession())
        ? "Failed to save match scores. Please try again."
        : SESSION_EXPIRED_MESSAGE,
    };
  }

  return { ok: true };
}

/**
 * Record a forfeit on a live-round match. The row is written exactly as the
 * End Round drop auto-score writes it (lib/tournament/dropForfeit.ts), so a
 * host-entered forfeit and a mid-round drop score identically.
 */
export async function saveMatchForfeit(
  client: SupabaseClient,
  args: {
    matchId: string;
    player1Id: string;
    player2Id: string;
    side: ForfeitSide;
  },
): Promise<SaveScoreResult> {
  const { error } = await client
    .from("matches")
    .update({
      ...forfeitMatchWrite(args.side, args.player1Id, args.player2Id),
      updated_at: new Date(),
    })
    .eq("id", args.matchId);

  if (error) {
    return {
      ok: false,
      error: (await getUserSafe(client))
        ? "Failed to save the forfeit. Please try again."
        : SESSION_EXPIRED_MESSAGE,
    };
  }
  return { ok: true };
}
