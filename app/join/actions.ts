"use server";

import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeJoinCode } from "@/lib/tournament/joinCodes";
import {
  buildDeckSubmission,
  checkSnapshotCards,
  cleanSnapshotCards,
  type DeckSnapshot,
  type DeckSnapshotCard,
} from "@/lib/tournament/deckSubmission";
import { normalizeTournamentFormat, type FormatId } from "@/lib/formats";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";
import type { DeckCheckIssue } from "@/utils/deckcheck";

const NAME_MAX = 40;

function cleanDisplayName(raw: string | null): string {
  return (raw ?? "").replace(/[\p{Cc}]/gu, "").trim().slice(0, NAME_MAX);
}

// A guest has no account, so their browser is their identity: a random token in this cookie. The participants
// table stores only its hash, so nothing read from a participant row can be replayed as the cookie.
const GUEST_COOKIE = "lor_guest";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

function guestKeyOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type JoinInfo =
  | {
      success: true;
      tournamentName: string;
      category: string | null;
      deckFormat: FormatId | "Other" | null;
      requiresDecklist: boolean;
      hasStarted: boolean;
      hostName: string | null;
      joined: null | {
        displayName: string;
        /** Joined by name alone, without an account: this row cannot carry a decklist of the player's own. */
        guest: boolean;
        submission: null | { deckName: string; submittedAt: string; isLegal: boolean | null };
      };
    }
  | { success: false; error: "invalid_code" | "rate_limited" };

export type JoinResult =
  | { success: true }
  | {
      success: false;
      error:
        | "invalid_code"
        | "not_signed_in"
        | "started"
        | "blocked"
        | "already_joined"
        | "not_joined"
        | "decklist_required"
        | "deck_not_found"
        | "deck_not_accessible"
        | "deck_illegal"
        | "invalid_name"
        | "rate_limited"
        | "guests_full"
        | "join_failed";
      issues?: DeckCheckIssue[];
    };

async function findTournamentByCode(code: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, require_decklists, has_started, host_id, code")
    .eq("code", code)
    .maybeSingle();
  return data;
}

export async function getJoinInfoAction(rawCode: string): Promise<JoinInfo> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };

  // Auth-aware first: signed-in users skip the IP throttle (the limiter
  // guards the ANONYMOUS enumeration surface; 30 players behind one venue
  // NAT must not exhaust it at QR-reveal time).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    try {
      const h = await headers();
      const ip = extractClientIp(new Request("http://x", { headers: h }));
      const rl = await rateLimitForUnauthIp(ip);
      if (rl.success === false) return { success: false, error: "rate_limited" };
    } catch {
      // Fail open: rateLimitForUnauthIp throws when KV_REST_API_* is unset
      // (fresh dev env, e2e CI). A missing limiter must not 500 the page.
    }
  }

  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };

  const admin = getSupabaseAdmin();
  const { data: hostProfile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", t.host_id)
    .maybeSingle();

  // Auth-aware extras (user client for identity only; reads stay admin-side).
  type JoinedInfo = Extract<JoinInfo, { success: true }>["joined"];
  let joined: JoinedInfo = null;
  let p: { id: string; name: string | null } | null = null;
  let guest = false;
  if (user) {
    const { data } = await admin
      .from("participants")
      .select("id, name")
      .eq("tournament_id", t.id)
      .eq("user_id", user.id)
      .maybeSingle();
    p = data;
  }
  // No account row: this browser may have joined as a guest (and its owner may have signed in since).
  if (!p) {
    const token = (await cookies()).get(GUEST_COOKIE)?.value;
    if (token) {
      const { data } = await admin
        .from("participants")
        .select("id, name")
        .eq("tournament_id", t.id)
        .eq("guest_key", guestKeyOf(token))
        .maybeSingle();
      p = data;
      guest = p !== null;
    }
  }
  if (p) {
    const { data: sub } = await admin
      .from("tournament_deck_submissions")
      .select("deck_snapshot, submitted_at, is_legal")
      .eq("participant_id", p.id)
      .maybeSingle();
    joined = {
      displayName: p.name ?? "",
      guest,
      submission: sub
        ? {
            deckName: (sub.deck_snapshot as any)?.deckName ?? "Deck",
            submittedAt: sub.submitted_at,
            isLegal: sub.is_legal,
          }
        : null,
    };
  }

  return {
    success: true,
    tournamentName: t.name,
    category: t.category,
    deckFormat: normalizeTournamentFormat(t.deck_format),
    requiresDecklist: t.require_decklists === true,
    hasStarted: t.has_started === true,
    hostName: hostProfile?.username ?? null,
    joined,
  };
}

async function submitToTournament(
  rawCode: string,
  deckId: string | undefined,
  displayName: string | null,
  resubmit: boolean
): Promise<JoinResult> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_signed_in" };

  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };
  if (t.has_started === true) return { success: false, error: "started" };

  let name: string | null = null;
  if (!resubmit) {
    name = cleanDisplayName(displayName);
    if (!name) return { success: false, error: "invalid_name" };
  }

  const admin = getSupabaseAdmin();
  let snapshot = null,
    isLegal: boolean | null = null,
    issues: DeckCheckIssue[] = [];
  const format = normalizeTournamentFormat(t.deck_format);
  if (t.require_decklists === true) {
    if (!deckId) return { success: false, error: "decklist_required" };
    if (format === null || format === "Other")
      return { success: false, error: "decklist_required" }; // misconfigured event; host must set a format
    const built = await buildDeckSubmission(admin, deckId, user.id, format);
    if (built.success === false) return { success: false, error: built.error };
    if (built.isLegal === false || built.hasUnresolvedCards === true)
      return { success: false, error: "deck_illegal", issues: built.issues };
    snapshot = built.snapshot;
    isLegal = built.isLegal;
    issues = built.issues;
  }

  const { data, error } = await admin.rpc("tournament_qr_join", {
    p_code: code,
    p_user_id: user.id,
    p_display_name: name,
    p_deck_id: snapshot ? deckId : null,
    p_snapshot: snapshot,
    p_is_legal: isLegal,
    p_issues: issues.length ? issues : null,
    p_resubmit: resubmit,
  });
  if (error) return { success: false, error: "join_failed" };
  const out = data as { ok: boolean; error?: string };
  if (out.ok !== true) {
    // Explicit map from the SQL function's error strings; unknown -> join_failed.
    const SQL_ERRORS: Record<string, Extract<JoinResult, { success: false }>["error"]> = {
      not_found: "invalid_code",
      started: "started",
      blocked: "blocked",
      decklist_required: "decklist_required",
      already_joined: "already_joined",
      not_joined: "not_joined",
    };
    return { success: false, error: SQL_ERRORS[out.error ?? ""] ?? "join_failed" };
  }
  return { success: true };
}

export async function joinTournamentAction(
  rawCode: string,
  params: { displayName: string; deckId?: string }
): Promise<JoinResult> {
  return submitToTournament(rawCode, params.deckId, params.displayName, false);
}

export async function resubmitDeckAction(rawCode: string, deckId: string): Promise<JoinResult> {
  return submitToTournament(rawCode, deckId, null, true);
}

/**
 * Joins by name alone, with no account, for an event that asks for no decklist. The browser is remembered by a
 * cookie, so the same phone cannot join twice and sees its registration when it comes back.
 */
export async function joinAsGuestAction(rawCode: string, displayName: string): Promise<JoinResult> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };

  // An anonymous write, so it is throttled by IP. A bucket apart from the page-load one in getJoinInfoAction:
  // a room of players behind one venue connection each spend one load and one join.
  try {
    const ip = extractClientIp(new Request("http://x", { headers: await headers() }));
    const rl = await rateLimitForUnauthIp(`guest-join:${ip}`);
    if (rl.success === false) return { success: false, error: "rate_limited" };
  } catch {
    // Fail open when the limiter is not configured, as getJoinInfoAction does.
  }

  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };
  if (t.has_started === true) return { success: false, error: "started" };
  if (t.require_decklists === true) return { success: false, error: "decklist_required" };

  const name = cleanDisplayName(displayName);
  if (!name) return { success: false, error: "invalid_name" };

  const jar = await cookies();
  const token = jar.get(GUEST_COOKIE)?.value || randomUUID();
  const { data, error } = await getSupabaseAdmin().rpc("tournament_guest_join", {
    p_code: code,
    p_guest_key: guestKeyOf(token),
    p_display_name: name,
  });
  if (error) return { success: false, error: "join_failed" };
  const out = data as { ok: boolean; error?: string };
  if (out.ok !== true) {
    const SQL_ERRORS: Record<string, Extract<JoinResult, { success: false }>["error"]> = {
      not_found: "invalid_code",
      started: "started",
      decklist_required: "decklist_required",
      already_joined: "already_joined",
      guests_full: "guests_full",
    };
    return { success: false, error: SQL_ERRORS[out.error ?? ""] ?? "join_failed" };
  }

  jar.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/join",
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  return { success: true };
}

/** The signed-in player's participant row and submission for the event with this code, read admin-side. */
async function findMySubmission(tournamentId: string, userId: string) {
  const admin = getSupabaseAdmin();
  const { data: p } = await admin
    .from("participants")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!p) return null;
  const { data: sub } = await admin
    .from("tournament_deck_submissions")
    .select("deck_id, deck_snapshot, is_legal, deckcheck_issues")
    .eq("participant_id", p.id)
    .maybeSingle();
  return sub ?? null;
}

export type MySubmission =
  | { success: true; deckName: string; cards: DeckSnapshotCard[]; hasStarted: boolean }
  | { success: false; error: "invalid_code" | "not_signed_in" | "not_joined" };

/** The card list the signed-in player handed in for this event, so they can read it and touch it up. */
export async function getMySubmissionAction(rawCode: string): Promise<MySubmission> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_signed_in" };
  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };
  const sub = await findMySubmission(t.id, user.id);
  if (!sub) return { success: false, error: "not_joined" };
  const snapshot = sub.deck_snapshot as DeckSnapshot;
  return {
    success: true,
    deckName: snapshot?.deckName ?? "Deck",
    cards: snapshot?.cards ?? [],
    hasStarted: t.has_started === true,
  };
}

/**
 * Replaces the cards of the player's own submitted list with an edited copy. The same rules as a resubmit: only
 * before the event starts, and only a list that passes the event's deck check is accepted, so the list on record
 * stays as it was until the new one is legal. The deck the list first came from is not changed.
 */
export async function updateMySubmissionAction(rawCode: string, cards: unknown): Promise<JoinResult> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return { success: false, error: "invalid_code" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "not_signed_in" };
  const t = await findTournamentByCode(code);
  if (!t) return { success: false, error: "invalid_code" };
  if (t.has_started === true) return { success: false, error: "started" };

  const sub = await findMySubmission(t.id, user.id);
  if (!sub) return { success: false, error: "not_joined" };
  const cleaned = cleanSnapshotCards(cards);
  if (!cleaned) return { success: false, error: "join_failed" };
  const format = normalizeTournamentFormat(t.deck_format);
  if (format === null || format === "Other") return { success: false, error: "decklist_required" };

  const verdict = await checkSnapshotCards(cleaned, format);
  if (verdict.isLegal === false || verdict.hasUnresolvedCards === true)
    return { success: false, error: "deck_illegal", issues: verdict.issues };

  const before = sub.deck_snapshot as DeckSnapshot;
  const snapshot: DeckSnapshot = {
    deckName: before?.deckName ?? "Deck",
    deckFormat: before?.deckFormat ?? "",
    cards: cleaned,
  };
  // The join function again, as a resubmit: it locks the event row, so an edit cannot land after the host starts.
  const { data, error } = await getSupabaseAdmin().rpc("tournament_qr_join", {
    p_code: code,
    p_user_id: user.id,
    p_display_name: null,
    p_deck_id: sub.deck_id ?? null,
    p_snapshot: snapshot,
    p_is_legal: verdict.isLegal,
    p_issues: verdict.issues.length ? verdict.issues : null,
    p_resubmit: true,
  });
  if (error) return { success: false, error: "join_failed" };
  const out = data as { ok: boolean; error?: string };
  if (out.ok !== true) {
    const known = out.error === "started" || out.error === "blocked" || out.error === "not_joined";
    return { success: false, error: known ? (out.error as "started" | "blocked" | "not_joined") : "join_failed" };
  }
  return { success: true };
}
