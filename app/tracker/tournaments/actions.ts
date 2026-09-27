"use server";

import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { computeFinalStandings } from "@/lib/tournament/standings";
import { buildStateFromSupabase } from "@/utils/tournament/stateAdapter";
import { generateJoinCode } from "@/lib/tournament/joinCodes";
import { buildDeckSubmission, type DeckSnapshot } from "@/lib/tournament/deckSubmission";
import { normalizeTournamentFormat, type FormatId } from "@/lib/formats";
import { checkDeck, type DeckCheckCard, type DeckCheckIssue } from "@/utils/deckcheck";
import { derivePreviewCards } from "@/lib/tournament/previewCards";

// System user that owns published tournament deck copies
const REDEMPTIONCCG_USER_ID = "a0a8e980-f372-4ebd-be25-d2f26507e98f";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Name - 2nd Place - Tournament" (no place segment when unplaced). The one
 * naming rule for a published deck copy, used at publish time and again when
 * a post-event repair moves the placings. */
function publishedDeckName(
  participantName: string,
  place: number | undefined,
  tournamentName: string,
): string {
  const placeStr = place ? `${ordinal(place)} Place - ` : "";
  return `${participantName} - ${placeStr}${tournamentName}`;
}


// Reads on the default-deny tables (tournament_deck_submissions,
// tournament_join_blocks) go through the admin client, which bypasses RLS
// entirely — so authority must be proven first. A user-scoped read of the
// tournament row only succeeds (RLS: host_can_access_tournaments) if the
// caller IS the host; that's the proof.
async function requireHost(tournamentId: string): Promise<{ userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: t } = await supabase
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .maybeSingle();
  return t ? { userId: user.id } : null;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface TournamentDecklistRow {
  id: string;
  tournament_id: string;
  participant_id: string;
  deck_id: string | null;
  deck_name: string;
  deck_format: string | null;
  deck_card_count: number;
  preview_card_1: string | null;
  preview_card_2: string | null;
  submission: {
    deckName: string;
    cardCount: number;
    isLegal: boolean | null;
    submittedAt: string;
    source: "player" | "host";
  } | null;
}

export interface DeckSearchResult {
  id: string;
  name: string;
  format: string | null;
  card_count: number;
  preview_card_1: string | null;
  preview_card_2: string | null;
  is_public: boolean;
  username?: string | null;
}

// ─── Load tournament decklists ──────────────────────────────────────

export async function loadTournamentDecklistsAction(tournamentId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tournament_decklists")
    .select(`
      id,
      tournament_id,
      participant_id,
      deck_id,
      decks!tournament_decklists_deck_id_fkey (
        name,
        format,
        card_count,
        preview_card_1,
        preview_card_2
      )
    `)
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("Error loading tournament decklists:", error);
    return { success: false, error: error.message, decklists: [] };
  }

  // Submissions live in a default-deny table (host-only). Only merge them in
  // for confirmed hosts; anyone else still gets the plain decklist rows.
  const submissionMap = new Map<string, any>();
  const host = await requireHost(tournamentId);
  if (host) {
    const admin = getSupabaseAdmin();
    const { data: subs } = await admin
      .from("tournament_deck_submissions")
      .select("participant_id, deck_snapshot, is_legal, submitted_at, source")
      .eq("tournament_id", tournamentId);
    for (const s of subs ?? []) {
      submissionMap.set(s.participant_id, s);
    }
  }

  const decklists: TournamentDecklistRow[] = (data || []).map((row: any) => {
    const sub = submissionMap.get(row.participant_id);
    const snapshot = sub?.deck_snapshot as DeckSnapshot | undefined;
    // Main deck only — `decks.card_count` excludes reserve and maybeboard
    // everywhere else in the app (saveDeckAction), and the public v1 API
    // documents the column as main-zone-only. Counting every zone here made a
    // submitted deck read "61c" against the "51c" the deck builder and
    // /my-decks show for the very same deck.
    const cardCountFromSnapshot = snapshot
      ? snapshot.cards.reduce((n, c) => (c.zone === "main" ? n + c.quantity : n), 0)
      : 0;
    // The `decks` join fails when deck_id is null (deck deleted) or the deck
    // is private and inaccessible under RLS. Fall back to the submission
    // snapshot for name/count in that case rather than showing "Unknown".
    const deckJoinFailed = !row.decks;

    return {
      id: row.id,
      tournament_id: row.tournament_id,
      participant_id: row.participant_id,
      deck_id: row.deck_id,
      deck_name: deckJoinFailed && snapshot ? snapshot.deckName : row.decks?.name || "Unknown",
      deck_format: row.decks?.format || null,
      deck_card_count: deckJoinFailed && snapshot ? cardCountFromSnapshot : row.decks?.card_count || 0,
      preview_card_1: row.decks?.preview_card_1 || null,
      preview_card_2: row.decks?.preview_card_2 || null,
      submission: sub
        ? {
            deckName: snapshot?.deckName ?? "Deck",
            cardCount: cardCountFromSnapshot,
            isLegal: sub.is_legal,
            submittedAt: sub.submitted_at,
            source: sub.source,
          }
        : null,
    };
  });

  return { success: true, decklists };
}

// ─── Search decks (admin's own + public) ────────────────────────────

export async function searchDecksForTournamentAction(query: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Not authenticated", decks: [] };
  }

  const term = query.trim();
  if (!term) {
    return { success: true, decks: [] };
  }

  // Search admin's own decks
  const { data: ownDecks } = await supabase
    .from("decks")
    .select("id, name, format, card_count, preview_card_1, preview_card_2, is_public, user_id")
    .eq("user_id", user.id)
    .ilike("name", `%${term}%`)
    .order("updated_at", { ascending: false })
    .limit(10);

  // Search public decks (excluding own; unlisted decks aren't discoverable here)
  const { data: publicDecks } = await supabase
    .from("decks")
    .select("id, name, format, card_count, preview_card_1, preview_card_2, is_public, user_id")
    .eq("visibility", "public")
    .neq("user_id", user.id)
    .ilike("name", `%${term}%`)
    .order("view_count", { ascending: false })
    .limit(10);

  // Get usernames for public decks
  const publicUserIds = [...new Set((publicDecks || []).map((d: any) => d.user_id).filter(Boolean))];
  let usernameMap = new Map<string, string>();
  if (publicUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", publicUserIds);
    for (const p of profiles || []) {
      if (p.username) usernameMap.set(p.id, p.username);
    }
  }

  const results: DeckSearchResult[] = [
    ...(ownDecks || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      format: d.format,
      card_count: d.card_count || 0,
      preview_card_1: d.preview_card_1,
      preview_card_2: d.preview_card_2,
      is_public: d.is_public,
      username: "You" as string | null,
    })),
    ...(publicDecks || []).map((d: any) => ({
      id: d.id,
      name: d.name,
      format: d.format,
      card_count: d.card_count || 0,
      preview_card_1: d.preview_card_1,
      preview_card_2: d.preview_card_2,
      is_public: d.is_public,
      username: usernameMap.get(d.user_id) || null,
    })),
  ];

  return { success: true, decks: results };
}

// ─── Attach deck to participant ─────────────────────────────────────

export async function attachDeckToParticipantAction(
  tournamentId: string,
  participantId: string,
  deckId: string
) {
  // Only the tournament's host may attach a deck, and participantId must
  // actually belong to tournamentId. requireHost alone only proves the
  // caller hosts SOME tournament (their own) — the admin upsert further
  // below (onConflict: "participant_id") bypasses RLS entirely, so without
  // this check a host of tournament T_a could pass a victim's participantId
  // (participant UUIDs of published tournaments are publicly readable via
  // migration 017's published-decklists policy) and repoint the victim's
  // tournament_deck_submissions row at T_a, destroying that immutable
  // record. Same pattern removeParticipantWithBlockAction already uses.
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, error: "not_found" };

  const admin = getSupabaseAdmin();
  const { data: participant } = await admin
    .from("participants")
    .select("id")
    .eq("id", participantId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (!participant) return { success: false, error: "not_found" };

  const supabase = await createClient();

  // Upsert: if participant already has a deck, replace it
  const { data: existing } = await supabase
    .from("tournament_decklists")
    .select("id")
    .eq("participant_id", participantId)
    .eq("tournament_id", tournamentId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("tournament_decklists")
      .update({ deck_id: deckId })
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating tournament decklist:", error);
      return { success: false, error: error.message };
    }
  } else {
    const { error } = await supabase
      .from("tournament_decklists")
      .insert({
        tournament_id: tournamentId,
        participant_id: participantId,
        deck_id: deckId,
      });

    if (error) {
      console.error("Error attaching deck:", error);
      return { success: false, error: error.message };
    }
  }

  // Record a host-side submission snapshot (default-deny table — admin
  // client, host authority already confirmed above). Best-effort: if the
  // deck turns out to be private/inaccessible to the host, leave the
  // tournament_decklists attach above intact and simply skip the snapshot.
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("deck_format")
    .eq("id", tournamentId)
    .maybeSingle();
  const format = normalizeTournamentFormat(tournament?.deck_format);

  let snapshot: DeckSnapshot | null = null;
  let isLegal: boolean | null = null;
  let issues: DeckCheckIssue[] | null = null;

  if (format === null || format === "Other") {
    // No declared tournament format -> a legality verdict would be
    // meaningless, so we can't route this through buildDeckSubmission
    // (which requires a FormatId). Still snapshot the cards so the host
    // has a record — but this reads via the ADMIN client, which bypasses
    // RLS entirely, so we must re-enforce the same access rule
    // buildDeckSubmission enforces by hand (deckSubmission.ts:47-49):
    // the requester must own the deck OR it must not be private. Without
    // this, a host on a no-format tournament could attach ANY deck UUID
    // (not just ones surfaced by searchDecksForTournamentAction) and read
    // back a private deck's full card list via the submission snapshot.
    const { data: deck } = await admin
      .from("decks")
      .select("name, user_id, visibility")
      .eq("id", deckId)
      .maybeSingle();
    const isOwner = deck?.user_id === host.userId;
    const isAccessible = !!deck && (isOwner || deck.visibility !== "private");
    if (isAccessible && deck) {
      const { data: rows } = await admin
        .from("deck_cards")
        .select("card_name, card_set, card_img_file, quantity, zone")
        .eq("deck_id", deckId)
        .in("zone", ["main", "reserve"]);
      snapshot = {
        deckName: deck.name ?? "Untitled Deck",
        deckFormat: "",
        cards: (rows ?? []).map((r: any) => ({
          name: r.card_name,
          set: r.card_set,
          imgFile: r.card_img_file ?? null,
          quantity: r.quantity,
          zone: r.zone,
        })),
      };
    }
  } else {
    const built = await buildDeckSubmission(admin, deckId, host.userId, format);
    if (built.success === true) {
      snapshot = built.snapshot;
      isLegal = built.isLegal;
      issues = built.issues;
    }
  }

  if (snapshot) {
    await admin.from("tournament_deck_submissions").upsert(
      {
        tournament_id: tournamentId,
        participant_id: participantId,
        deck_id: deckId,
        submitted_by: host.userId,
        source: "host",
        deck_snapshot: snapshot,
        is_legal: isLegal,
        deckcheck_issues: issues && issues.length > 0 ? issues : null,
      },
      { onConflict: "participant_id" }
    );
  }

  return { success: true };
}

// ─── Detach deck from participant ───────────────────────────────────

export async function detachDeckFromParticipantAction(participantId: string) {
  const supabase = await createClient();

  // Proof-of-delete: only when the user-scoped delete actually removed a row
  // (i.e. RLS let it through because the caller is the host) do we touch the
  // admin-only submissions table. Without this, any authenticated caller
  // could pass an arbitrary participantId and admin-delete someone else's
  // submission through this open server action.
  const { data, error } = await supabase
    .from("tournament_decklists")
    .delete()
    .eq("participant_id", participantId)
    .select("tournament_id");

  if (error) {
    console.error("Error detaching deck:", error);
    return { success: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return { success: false, error: "not_found" };
  }

  const admin = getSupabaseAdmin();
  await admin.from("tournament_deck_submissions").delete().eq("participant_id", participantId);

  return { success: true };
}

// ─── QR join controls ────────────────────────────────────────────────

export async function setQrJoinEnabledAction(
  tournamentId: string,
  enabled: boolean
): Promise<{ success: boolean; code?: string | null; error?: string }> {
  const supabase = await createClient();

  if (enabled === false) {
    const { data, error } = await supabase
      .from("tournaments")
      .update({ code: null })
      .eq("id", tournamentId)
      .select("code")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    // RLS makes a non-host's update touch zero rows -> data comes back null
    // with no error. Treat that as "not found" (can't tell it apart from a
    // truly missing tournament, which is fine — same response either way).
    if (!data) return { success: false, error: "not_found" };
    return { success: true, code: null };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const { data, error } = await supabase
      .from("tournaments")
      .update({ code })
      .eq("id", tournamentId)
      .select("code")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") continue; // code collision — try another
      return { success: false, error: error.message };
    }
    if (!data) return { success: false, error: "not_found" };
    return { success: true, code: data.code };
  }
  return { success: false, error: "code_generation_failed" };
}

export async function updateJoinSettingsAction(
  tournamentId: string,
  s: { requireDecklists: boolean }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  // The format is Tournament Settings' to set, not this dialog's — but the
  // invariant it protects still has to hold here: requiring a decklist on an
  // event with no specific format makes it unjoinable (every player is bounced
  // with `decklist_required`). Read the persisted format and refuse.
  if (s.requireDecklists === true) {
    const { data } = await supabase
      .from("tournaments")
      .select("deck_format")
      .eq("id", tournamentId)
      .maybeSingle();
    const format = normalizeTournamentFormat(data?.deck_format);
    if (format === null || format === "Other") {
      return { success: false, error: "format_required" };
    }
  }

  const { error } = await supabase
    .from("tournaments")
    .update({ require_decklists: s.requireDecklists })
    .eq("id", tournamentId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Final placements ────────────────────────────────────────────────
//
// participants.place is written in exactly one spot: here. Both a
// results-only publish (setResultsPublishedAction) and a decklist publish
// (publishTournamentDecklistsAction) need it computed and persisted, so it's
// factored out rather than duplicated.

async function persistFinalPlaces(tournamentId: string): Promise<Map<string, number>> {
  const supabase = await createClient();
  const placementMap = new Map<string, number>(); // participant_id → place

  const state = await buildStateFromSupabase(supabase, tournamentId);
  if (state) {
    const standings = computeFinalStandings(state);
    for (const placement of standings) {
      placementMap.set(placement.participantId, placement.place);
      await supabase
        .from("participants")
        .update({ place: placement.place })
        .eq("id", placement.participantId);
    }
    // Dropped players are excluded from `standings` per algorithm.md
    // ("no place value at all"). Clear any stale `place` left over from a
    // prior publish so the data accurately reflects their dropped status.
    await supabase
      .from("participants")
      .update({ place: null })
      .eq("tournament_id", tournamentId)
      .eq("dropped_out", true);
  }

  return placementMap;
}

/**
 * Re-run the final-placement save after a result is corrected on an ENDED
 * tournament, so participants.place and any already-published decklist
 * names ("Name - 2nd Place - …") follow the corrected standings. Uses the
 * same persistFinalPlaces + naming rule as publishing — never a second
 * implementation. No-op while the tournament is still running (placings
 * are only meaningful once it has ended).
 */
export async function refreshFinalPlacesAction(
  tournamentId: string
): Promise<{ success: boolean; renamed: number; error?: string }> {
  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("name, has_ended")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tournament?.has_ended) return { success: true, renamed: 0 };

  const placementMap = await persistFinalPlaces(tournamentId);

  // Published copies carry the place in their name; rename any that exist.
  const { data: rows, error } = await supabase
    .from("tournament_decklists")
    .select("participant_id, published_deck_id, participants!inner ( name )")
    .eq("tournament_id", tournamentId)
    .not("published_deck_id", "is", null);
  if (error) return { success: false, renamed: 0, error: error.message };

  const published = (rows ?? []) as any[];
  if (published.length === 0) return { success: true, renamed: 0 };

  // Copies are owned by the system user, so the rename goes through the
  // admin client — prove host authority first (same gate as publishing).
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, renamed: 0, error: "Not the tournament host" };
  const admin = getSupabaseAdmin();

  let renamed = 0;
  for (const row of published) {
    const name = publishedDeckName(
      row.participants?.name || "Unknown",
      placementMap.get(row.participant_id),
      tournament.name
    );
    const { error: renameError } = await admin
      .from("decks")
      .update({ name })
      .eq("id", row.published_deck_id)
      .eq("user_id", REDEMPTIONCCG_USER_ID);
    if (!renameError) renamed += 1;
  }
  return { success: true, renamed };
}

// ─── Join stats ───────────────────────────────────────────────────────

export async function getJoinStatsAction(
  tournamentId: string
): Promise<{ success: boolean; joined: number; submitted: number }> {
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, joined: 0, submitted: 0 };

  const supabase = await createClient();
  const { count: joined } = await supabase
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  const admin = getSupabaseAdmin();
  const { count: submitted } = await admin
    .from("tournament_deck_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tournament_id", tournamentId);

  return { success: true, joined: joined ?? 0, submitted: submitted ?? 0 };
}

// ─── Single submission (host review modal) ────────────────────────────

export async function getSubmissionAction(
  tournamentId: string,
  participantId: string
): Promise<{
  success: boolean;
  submission?: {
    snapshot: DeckSnapshot;
    isLegal: boolean | null;
    issues: DeckCheckIssue[];
    submittedAt: string;
    source: "player" | "host";
    submittedByUsername: string | null;
  };
  error?: string;
}> {
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, error: "not_found" };

  const admin = getSupabaseAdmin();
  const { data: sub, error } = await admin
    .from("tournament_deck_submissions")
    .select("deck_snapshot, is_legal, deckcheck_issues, submitted_at, source, submitted_by")
    .eq("tournament_id", tournamentId)
    .eq("participant_id", participantId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!sub) return { success: false, error: "not_found" };

  let submittedByUsername: string | null = null;
  if (sub.submitted_by) {
    const { data: profile } = await admin
      .from("profiles")
      .select("username")
      .eq("id", sub.submitted_by)
      .maybeSingle();
    submittedByUsername = profile?.username ?? null;
  }

  return {
    success: true,
    submission: {
      snapshot: sub.deck_snapshot as DeckSnapshot,
      isLegal: sub.is_legal,
      issues: (sub.deckcheck_issues as DeckCheckIssue[] | null) ?? [],
      submittedAt: sub.submitted_at,
      source: sub.source,
      submittedByUsername,
    },
  };
}

// ─── Remove participant (with optional rejoin block) ───────────────────

export async function removeParticipantWithBlockAction(
  tournamentId: string,
  participantId: string,
  block: boolean
): Promise<{ success: boolean; error?: string }> {
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, error: "not_found" };

  const admin = getSupabaseAdmin();
  const { data: participant } = await admin
    .from("participants")
    .select("user_id")
    .eq("id", participantId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  const supabase = await createClient();
  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId)
    .eq("tournament_id", tournamentId);

  if (error) return { success: false, error: error.message };

  if (block === true && participant?.user_id != null) {
    await admin
      .from("tournament_join_blocks")
      .upsert(
        { tournament_id: tournamentId, user_id: participant.user_id },
        { onConflict: "tournament_id,user_id", ignoreDuplicates: true }
      );
  }

  return { success: true };
}

// ─── Recheck all submissions against current format ────────────────────

export async function recheckAllSubmissionsAction(
  tournamentId: string
): Promise<{ success: boolean; rechecked: number; nowIllegal: number; error?: string }> {
  const host = await requireHost(tournamentId);
  if (!host) return { success: false, rechecked: 0, nowIllegal: 0, error: "not_found" };

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("deck_format")
    .eq("id", tournamentId)
    .maybeSingle();

  const format = normalizeTournamentFormat(tournament?.deck_format);
  if (format === null || format === "Other") {
    // No declared format -> a legality verdict is meaningless (same rule as
    // host-attach). Nothing to recheck.
    return { success: false, rechecked: 0, nowIllegal: 0, error: "format_required" };
  }

  const admin = getSupabaseAdmin();
  const { data: subs, error } = await admin
    .from("tournament_deck_submissions")
    .select("id, deck_snapshot, is_legal")
    .eq("tournament_id", tournamentId);

  if (error) return { success: false, rechecked: 0, nowIllegal: 0, error: error.message };

  let rechecked = 0;
  let nowIllegal = 0;

  for (const sub of subs ?? []) {
    const snapshot = sub.deck_snapshot as DeckSnapshot;
    const toCheckCard = (c: DeckSnapshot["cards"][number]): DeckCheckCard => ({
      name: c.name,
      set: c.set,
      quantity: c.quantity,
      imgFile: c.imgFile ?? undefined,
    });
    const main = snapshot.cards.filter((c) => c.zone === "main").map(toCheckCard);
    const reserve = snapshot.cards.filter((c) => c.zone === "reserve").map(toCheckCard);
    const result = await checkDeck(main, reserve, format);

    if (sub.is_legal === true && result.valid === false) nowIllegal++;

    await admin
      .from("tournament_deck_submissions")
      .update({
        is_legal: result.valid,
        deckcheck_issues: result.issues.length > 0 ? result.issues : null,
      })
      .eq("id", sub.id);

    rechecked++;
  }

  return { success: true, rechecked, nowIllegal };
}

// ─── Publish / unpublish results ────────────────────────────────────────

export async function setResultsPublishedAction(
  tournamentId: string,
  published: boolean
): Promise<{ success: boolean; error?: string }> {
  if (published === true) {
    // Results page shows the Place column — compute + persist it here since
    // this path may run without ever publishing decklists.
    await persistFinalPlaces(tournamentId);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tournaments")
    .update({ results_published: published })
    .eq("id", tournamentId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Publish all decklists ──────────────────────────────────────────

export async function publishTournamentDecklistsAction(
  tournamentId: string,
  deckFormat: string
) {
  const supabase = await createClient();
  const admin = getSupabaseAdmin();

  // Get tournament name for the deck copies
  const { data: tournament, error: tournError } = await supabase
    .from("tournaments")
    .select("name")
    .eq("id", tournamentId)
    .single();

  if (tournError || !tournament) {
    return { success: false, error: "Tournament not found" };
  }

  // Get all decklists with participant names
  const { data: decklists, error: fetchError } = await supabase
    .from("tournament_decklists")
    .select(`
      id,
      deck_id,
      published_deck_id,
      participant_id,
      participants!inner ( name )
    `)
    .eq("tournament_id", tournamentId);

  if (fetchError) {
    console.error("Error fetching decklists:", fetchError);
    return { success: false, error: fetchError.message };
  }

  if (!decklists || decklists.length === 0) {
    return { success: false, error: "No decklists to publish" };
  }

  // Calculate and persist placements first.
  // Uses the pure standings module so head-to-head tiebreakers are applied
  // (previous code only sorted by match_points then differential, which missed
  // the head-to-head step required by algorithm.md).
  const placementMap = await persistFinalPlaces(tournamentId);

  // Submissions live in a default-deny table — admin client, so authority
  // must be proven first. The tournament read above already proved it (RLS
  // returned a row), but re-check explicitly right at the point of admin
  // access so the gate is obvious and doesn't rely on code above staying put.
  const host = await requireHost(tournamentId);
  const submissionMap = new Map<string, any>();
  if (host) {
    const { data: subs } = await admin
      .from("tournament_deck_submissions")
      .select("participant_id, deck_snapshot, is_legal, deckcheck_issues")
      .eq("tournament_id", tournamentId);
    for (const s of subs ?? []) {
      submissionMap.set(s.participant_id, s);
    }
  }

  // Check if copies already exist (previous publish that was unpublished)
  const existingPublishedIds = (decklists as any[])
    .map((dl: any) => dl.published_deck_id)
    .filter(Boolean);

  if (existingPublishedIds.length > 0) {
    const { data: existingCopies } = await admin
      .from("decks")
      .select("id")
      .in("id", existingPublishedIds)
      .eq("user_id", REDEMPTIONCCG_USER_ID);

    if (existingCopies && existingCopies.length === existingPublishedIds.length) {
      // All copies still exist — just make them public again
      await admin
        .from("decks")
        .update({ visibility: "public" })
        .in("id", existingPublishedIds)
        .eq("user_id", REDEMPTIONCCG_USER_ID);

      // Mark tournament as published
      const { error: updateError } = await supabase
        .from("tournaments")
        .update({ decklists_published: true, deck_format: deckFormat })
        .eq("id", tournamentId);

      if (updateError) {
        console.error("Error publishing tournament:", updateError);
        return { success: false, error: updateError.message };
      }

      return { success: true };
    }
  }

  // No existing copies — create them fresh
  for (const dl of decklists as any[]) {
    const participantName = dl.participants?.name || "Unknown";
    const submission = submissionMap.get(dl.participant_id);

    // Snapshot-first: a submission is an immutable record of what the
    // player/host actually entered, and survives the live deck being
    // deleted or edited. Carry is_legal/deckcheck_issues forward so PDF
    // generation on the published copy renders the legal/illegal seal.
    // (Note: the published deck's `name` is always participant + place +
    // tournament name, below — never the original/snapshot deck name, same
    // as the pre-existing behavior.)
    let deckMeta: {
      description: string | null;
      format: string | null;
      paragon: string | null;
      preview_card_1: string | null;
      preview_card_2: string | null;
      card_count: number;
      is_legal: boolean | null;
      deckcheck_issues: unknown;
    };
    let cardsToInsert: {
      card_name: string;
      card_set: string | null;
      card_img_file: string | null;
      quantity: number;
      zone: string;
    }[];

    if (submission) {
      const snapshot = submission.deck_snapshot as DeckSnapshot;
      const [derived1, derived2] = derivePreviewCards(snapshot.cards);
      // A player can hand-pick their deck's cover art, and that choice lives on
      // the deck row, not in the snapshot. Host attaches write a submission row
      // too, so this branch handles nearly every publish — reading the original
      // deck here is what keeps a deliberate cover from being silently replaced
      // by a derived one. Falls back to derived when the deck is gone.
      let chosen1: string | null = null;
      let chosen2: string | null = null;
      if (dl.deck_id !== null) {
        const { data: orig } = await admin
          .from("decks")
          .select("preview_card_1, preview_card_2")
          .eq("id", dl.deck_id)
          .maybeSingle();
        chosen1 = orig?.preview_card_1 ?? null;
        chosen2 = orig?.preview_card_2 ?? null;
      }
      deckMeta = {
        description: null,
        format: snapshot.deckFormat || null,
        paragon: null,
        // Never null: a published copy with no cover renders as a blank tile on
        // the community decks page, which is the bug this replaced.
        preview_card_1: chosen1 ?? derived1,
        preview_card_2: chosen2 ?? derived2,
        // Main deck only — matches how `decks.card_count` is written everywhere
        // else (see saveDeckAction); counting reserve here inflated the count
        // on every published copy.
        card_count: snapshot.cards.reduce((n, c) => (c.zone === "main" ? n + c.quantity : n), 0),
        is_legal: submission.is_legal ?? null,
        deckcheck_issues: submission.deckcheck_issues ?? null,
      };
      cardsToInsert = snapshot.cards.map((c) => ({
        card_name: c.name,
        card_set: c.set || null,
        card_img_file: c.imgFile || null,
        quantity: c.quantity,
        zone: c.zone,
      }));
    } else if (dl.deck_id !== null) {
      // Fetch original deck metadata.
      const { data: origDeck } = await admin
        .from("decks")
        .select("name, description, format, paragon, preview_card_1, preview_card_2, card_count, is_legal, deckcheck_issues")
        .eq("id", dl.deck_id)
        .single();

      if (!origDeck) continue;

      // Fetch original deck cards. Maybeboard rows are excluded from the
      // tournament submission — only main + reserve get published.
      const { data: origCards } = await admin
        .from("deck_cards")
        .select("card_name, card_set, card_img_file, quantity, zone")
        .eq("deck_id", dl.deck_id)
        .in("zone", ["main", "reserve"]);

      deckMeta = {
        description: origDeck.description || null,
        format: origDeck.format,
        paragon: origDeck.paragon || null,
        preview_card_1: origDeck.preview_card_1 || null,
        preview_card_2: origDeck.preview_card_2 || null,
        card_count: origDeck.card_count || 0,
        is_legal: origDeck.is_legal ?? null,
        deckcheck_issues: origDeck.deckcheck_issues ?? null,
      };
      cardsToInsert = (origCards ?? []).map((c: any) => ({
        card_name: c.card_name,
        card_set: c.card_set || null,
        card_img_file: c.card_img_file || null,
        quantity: c.quantity,
        zone: c.zone,
      }));
    } else {
      // Neither a submission snapshot nor a live deck (deck was deleted and
      // this participant never submitted through the join flow) — nothing
      // to publish for this participant.
      console.warn(
        `publishTournamentDecklistsAction: participant ${dl.participant_id} has neither a submission nor a live deck; skipping.`
      );
      continue;
    }

    // Create copy owned by RedemptionCCG.app
    const deckName = publishedDeckName(
      participantName,
      placementMap.get(dl.participant_id),
      tournament.name
    );
    const { data: newDeck, error: createError } = await admin
      .from("decks")
      .insert({
        user_id: REDEMPTIONCCG_USER_ID,
        name: deckName,
        description: deckMeta.description,
        format: deckFormat !== "Other" ? deckFormat : deckMeta.format,
        paragon: deckMeta.paragon,
        preview_card_1: deckMeta.preview_card_1,
        preview_card_2: deckMeta.preview_card_2,
        card_count: deckMeta.card_count,
        visibility: "public",
        is_legal: deckMeta.is_legal,
        deckcheck_issues: deckMeta.deckcheck_issues,
      })
      .select("id")
      .single();

    if (createError || !newDeck) {
      console.error("Error creating deck copy:", createError);
      continue;
    }

    // Copy cards to the new deck
    if (cardsToInsert.length > 0) {
      const cardRows = cardsToInsert.map((c) => ({
        deck_id: newDeck.id,
        ...c,
      }));

      await admin.from("deck_cards").insert(cardRows);
    }

    // Store published copy ID separately — deck_id stays as the user's original
    await admin
      .from("tournament_decklists")
      .update({ published_deck_id: newDeck.id })
      .eq("id", dl.id);
  }

  // Mark tournament as published with format
  const { error: updateError } = await supabase
    .from("tournaments")
    .update({
      decklists_published: true,
      deck_format: deckFormat,
    })
    .eq("id", tournamentId);

  if (updateError) {
    console.error("Error publishing tournament:", updateError);
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

// ─── Unpublish decklists ────────────────────────────────────────────

export async function unpublishTournamentDecklistsAction(tournamentId: string) {
  const supabase = await createClient();
  const admin = getSupabaseAdmin();

  // Find published copy IDs
  const { data: tdRows } = await supabase
    .from("tournament_decklists")
    .select("id, published_deck_id")
    .eq("tournament_id", tournamentId);

  const publishedDeckIds = (tdRows || [])
    .map((r: any) => r.published_deck_id)
    .filter(Boolean);

  // Delete the published copies (cards first for FK constraint)
  if (publishedDeckIds.length > 0) {
    await admin
      .from("deck_cards")
      .delete()
      .in("deck_id", publishedDeckIds);

    // Clear the published_deck_id references before deleting decks
    await admin
      .from("tournament_decklists")
      .update({ published_deck_id: null })
      .eq("tournament_id", tournamentId);

    await admin
      .from("decks")
      .delete()
      .in("id", publishedDeckIds)
      .eq("user_id", REDEMPTIONCCG_USER_ID);
  }

  // Toggle the tournament flag — deck_id links to original decks are untouched
  const { error } = await supabase
    .from("tournaments")
    .update({ decklists_published: false })
    .eq("id", tournamentId);

  if (error) {
    console.error("Error unpublishing:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
