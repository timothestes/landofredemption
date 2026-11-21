"use server";

import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeJoinCode } from "@/lib/tournament/joinCodeShared";
import type { PublicRoundView } from "@/lib/tournament/liveRound";

export type PublicRoundViewResult =
  /** `view` is null when the code is unknown or the event hasn't started. */
  | { ok: true; view: PublicRoundView | null }
  /** Transient failure — the caller keeps whatever it last showed. */
  | { ok: false };

/**
 * The live round view for a join code, via the SECURITY DEFINER RPC from
 * migration 109. Runs as the anonymous role on purpose: the RPC is the whole
 * public surface, so nothing here needs (or has) host privileges.
 */
export async function getPublicRoundView(rawCode: string): Promise<PublicRoundViewResult> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { ok: true, view: null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_round_view", { p_code: code });
  if (error) {
    console.error("get_public_round_view failed:", error.message);
    return { ok: false };
  }
  return { ok: true, view: (data as PublicRoundView | null) ?? null };
}

/**
 * The event name for a code whose tournament exists but hasn't started — the
 * one thing the page shows before round 1 that the RPC (null until start)
 * cannot provide. Same exposure as the join page's header, nothing more.
 */
export async function getPendingEvent(rawCode: string): Promise<{ name: string } | null> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return null;

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tournaments")
    .select("name, has_started")
    .eq("code", code)
    .maybeSingle();
  if (!data || data.has_started === true) return null;
  return { name: data.name as string };
}

/**
 * The name the signed-in visitor registered under for this event, so the page
 * can open on their table instead of asking them to type the name again. Null
 * when signed out or not registered. The session says who is asking; only that
 * player's own row is read.
 */
export async function getMyParticipantName(rawCode: string): Promise<string | null> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = getSupabaseAdmin();
  const { data: tournament } = await admin
    .from("tournaments")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (!tournament) return null;

  const { data: participant } = await admin
    .from("participants")
    .select("name")
    .eq("tournament_id", tournament.id)
    .eq("user_id", user.id)
    .maybeSingle();
  return (participant?.name as string | null) ?? null;
}
