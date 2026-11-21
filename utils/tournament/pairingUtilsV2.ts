// Tournament Pairing Utilities v2 (DB shell).
//
// All algorithm decisions live in lib/tournament/. This file is a thin
// Supabase IO layer that:
//   1. Loads TournamentState via stateAdapter.
//   2. Calls a pure pairing function.
//   3. Persists the resulting matches and bye records.

import { createClient } from "../supabase/client";
import { rngForRound } from "../../lib/tournament/rng";
import { pairFirstRound, pairLaterRound } from "../../lib/tournament/pairing";
import { assignTables } from "../../lib/tournament/tableAssignment";
import { buildStateFromSupabase } from "./stateAdapter";

type AnyClient = {
  from: (table: string) => any;
};

/** Insert a bye record. bye_points/bye_differential are vestigial; always 3/0 per algorithm.md. */
async function persistBye(
  client: AnyClient,
  tournamentId: string,
  round: number,
  participantId: string,
) {
  const { error } = await client.from("byes").insert({
    tournament_id: tournamentId,
    round_number: round,
    match_points: 3,
    differential: 0,
    participant_id: participantId,
  });
  if (error) throw error;
}

/** Insert match records for a round. */
async function persistMatches(
  client: AnyClient,
  tournamentId: string,
  matches: Array<{
    round: number;
    player1Id: string;
    player2Id: string;
    matchOrder: number;
    tableNumber: number;
    player1PinOverridden: boolean;
    player2PinOverridden: boolean;
  }>,
) {
  if (matches.length === 0) return;
  const rows = matches.map(m => ({
    tournament_id: tournamentId,
    round: m.round,
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    player1_score: null,
    player2_score: null,
    match_order: m.matchOrder,
    table_number: m.tableNumber,
    player1_pin_overridden: m.player1PinOverridden,
    player2_pin_overridden: m.player2PinOverridden,
  }));
  const { error } = await client.from("matches").insert(rows);
  if (error) throw error;
}

/**
 * Ensure a rounds row exists for the round. started_at stays NULL until the
 * host clicks "Start Round" — repair RPCs require this row to exist (see
 * migration 036).
 */
async function ensureRoundRow(
  client: AnyClient,
  tournamentId: string,
  round: number,
) {
  const { error } = await client.from("rounds").upsert(
    { tournament_id: tournamentId, round_number: round, started_at: null },
    { onConflict: "tournament_id,round_number", ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Public API: create pairings for a Swiss tournament round.
 *
 * Resolves true when the round is paired, false when it is not — every read
 * and write is checked, so a caller must not carry on (advance the round,
 * report success) after false.
 *
 * Safe to call again for the same round, which is how a host recovers from a
 * dropped request: a round that already has matches is left alone. Nothing in
 * the database stops duplicate match or bye rows, so this is the only guard.
 * It does not cover two calls running at the same moment; callers disable
 * their button while one is in flight.
 */
export const createPairing = async (
  tournamentId: string,
  round: number,
): Promise<boolean> => {
  const client = await createClient();
  try {
    const { data: existingMatches, error: existingMatchesError } = await client
      .from("matches")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("round", round)
      .limit(1);
    if (existingMatchesError) throw existingMatchesError;
    if (existingMatches.length > 0) {
      // Already paired. The bye is written before the matches, so matches
      // never exist without it; only the round row can still be missing.
      await ensureRoundRow(client, tournamentId, round);
      return true;
    }

    // No matches, but an earlier attempt may have saved the bye and then
    // failed. Reconciled below, once this attempt knows who gets the bye.
    const { data: existingByes, error: existingByesError } = await client
      .from("byes")
      .select("id, participant_id")
      .eq("tournament_id", tournamentId)
      .eq("round_number", round);
    if (existingByesError) throw existingByesError;

    const state = await buildStateFromSupabase(client, tournamentId, { throwOnReadError: true });
    if (!state) {
      console.error("createPairing: tournament not found");
      return false;
    }
    // Every tournament has participant rows (dropping keeps the row), so none
    // at all means the session expired and RLS returned an empty list.
    if (state.participants.length === 0) {
      throw new Error("createPairing: no participants could be read");
    }
    const rng = rngForRound(tournamentId, round);
    const result = round === 1
      ? pairFirstRound(state.participants.filter(p => !p.droppedOut), rng)
      : pairLaterRound(state, round, rng);

    // Keep a leftover bye that is still the right one (pairing is seeded, so
    // an unchanged field picks the same player); remove any other, e.g. when
    // that player dropped between the two attempts.
    const keptBye = existingByes.find((b: any) => b.participant_id === result.bye);
    const staleByeIds = existingByes.filter((b: any) => b !== keptBye).map((b: any) => b.id);
    if (staleByeIds.length > 0) {
      const { error: staleByeError } = await client.from("byes").delete().in("id", staleByeIds);
      if (staleByeError) throw staleByeError;
    }
    if (result.bye && !keptBye) {
      await persistBye(client, tournamentId, round, result.bye);
    }

    // Static seats: place each match at a physical table, honoring pins.
    // Chair-side swaps (seats mode) happen here, before insert, while the
    // match has no scores. Spec: 2026-07-15-static-seats-design.md
    const pins = new Map<string, number>();
    for (const p of state.participants) {
      if (!p.droppedOut && p.assignedSeat != null) pins.set(p.id, p.assignedSeat);
    }
    const assigned = assignTables(result.matches, pins, {
      startingTableNumber: state.startingTableNumber ?? 1,
      mode: state.numberingMode ?? "tables",
    });

    // Persist the override decision now — it must not be re-derived later
    // from a pin that may have changed since (spec: "Overridden pins" §).
    const overridden = new Set(assigned.overriddenPins);
    const matchesToPersist = assigned.matches.map(m => ({
      ...m,
      player1PinOverridden: overridden.has(m.player1Id),
      player2PinOverridden: overridden.has(m.player2Id),
    }));

    await persistMatches(client, tournamentId, matchesToPersist);
    await ensureRoundRow(client, tournamentId, round);
    return true;
  } catch (error) {
    console.error("Error in createPairing v2:", error);
    return false;
  }
};
