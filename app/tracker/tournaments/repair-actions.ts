"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { buildStateFromSupabase } from "@/utils/tournament/stateAdapter";
import { pairFirstRound, pairLaterRound } from "@/lib/tournament/pairing";
import { mulberry32 } from "@/lib/tournament/rng";
import { assignTables } from "@/lib/tournament/tableAssignment";
import { refreshFinalPlacesAction } from "./actions";

export interface RepairResult {
  ok: boolean;
  error?: string;
  data?: {
    match_id: string;
    tournament_id: string;
    round: number;
    old: { p1: number; p2: number };
    new: { p1: number; p2: number; p1_forfeit?: boolean; p2_forfeit?: boolean };
  };
}

export async function repairMatchScoreAction(input: {
  matchId: string;
  newP1Score: number;
  newP2Score: number;
  /** Forfeit flags (migration 110). A forfeit is sent as 0–0 plus the flag. */
  p1Forfeit?: boolean;
  p2Forfeit?: boolean;
  reason?: string;
  tournamentId: string;
}): Promise<RepairResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("repair_match_score", {
    p_match_id: input.matchId,
    p_new_p1_score: input.newP1Score,
    p_new_p2_score: input.newP2Score,
    p_reason: input.reason ?? null,
    p_p1_forfeit: input.p1Forfeit ?? false,
    p_p2_forfeit: input.p2Forfeit ?? false,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // The RPC recomputed totals; on an ended tournament the final placings
  // (and any published decklist names carrying them) must follow. No-op
  // while the event is still running.
  await refreshFinalPlacesAction(input.tournamentId);

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RepairResult["data"] };
}

export interface RegenerateResult {
  ok: boolean;
  error?: string;
  data?: { tournament_id: string; round: number; matches_inserted: number; bye_id: string | null };
}

export async function regenerateCurrentRoundPairingsAction(input: {
  tournamentId: string;
  unlock?: boolean;
}): Promise<RegenerateResult> {
  const supabase = await createClient();

  const state = await buildStateFromSupabase(supabase, input.tournamentId);
  if (!state) return { ok: false, error: "Tournament not found" };

  const round = state.currentRound;
  // Fresh random seed per regenerate. The deterministic rngForRound seed used by
  // createPairing exists for reproducibility of the *initial* pairing; regenerate
  // is an explicit host re-shuffle and must produce different output each time,
  // especially for round 1 where standings provide no other variability.
  const rng = mulberry32(Math.floor(Math.random() * 0xffffffff));
  const result =
    round === 1
      ? pairFirstRound(state.participants.filter((p) => !p.droppedOut), rng)
      : pairLaterRound(state, round, rng);

  // Static seats: honor pins when placing regenerated matches (spec
  // 2026-07-15-static-seats-design.md).
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
  const pairings = assigned.matches.map((m, idx) => ({
    player1_id: m.player1Id,
    player2_id: m.player2Id,
    match_order: m.matchOrder ?? idx + 1,
    table_number: m.tableNumber,
    player1_pin_overridden: overridden.has(m.player1Id),
    player2_pin_overridden: overridden.has(m.player2Id),
  }));

  const { data, error } = await supabase.rpc("regenerate_current_round_pairings", {
    p_tournament_id: input.tournamentId,
    p_pairings: pairings,
    p_bye_id: result.bye ?? null,
    p_unlock: input.unlock ?? false,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tracker/tournaments/${input.tournamentId}`);
  return { ok: true, data: data as RegenerateResult["data"] };
}
