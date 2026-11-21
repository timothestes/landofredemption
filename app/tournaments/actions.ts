"use server";

import { createClient } from "@/utils/supabase/server";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { normalizeTournamentFormat, type FormatId } from "@/lib/formats";
import type { MetagameFormatId } from "@/lib/tournament/metagameFilters";
import {
  buildBreakdown,
  type BreakdownDeckInput,
  type BreakdownEvent,
  type TournamentBreakdown,
} from "@/lib/tournament/breakdown";

export interface TournamentListing {
  id: string;
  title: string;
  tournament_type: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  city: string;
  state: string;
  venue_name: string | null;
  venue_address: string | null;
  host_name: string | null;
  formats: { format: string; entry_fee: string | null }[];
  door_fee: string | null;
  description: string | null;
  linked_tournament_id: string | null;
}

export async function loadUpcomingListings(): Promise<TournamentListing[]> {
  const supabase = await createClient();

  // Keep a listing visible for a few days after its start date. Categories often
  // get played a day or two late (low turnout / time), and the host still needs
  // the "Host This Event" link during that window.
  const grace = new Date();
  grace.setDate(grace.getDate() - 3);
  const graceDate = grace.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("tournament_listings")
    .select(
      "id, title, tournament_type, start_date, end_date, start_time, city, state, venue_name, venue_address, host_name, formats, door_fee, description, linked_tournament_id"
    )
    .eq("status", "upcoming")
    .gte("start_date", graceDate)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("Failed to load tournament listings:", error.message);
    return [];
  }

  return (data as TournamentListing[]) || [];
}

// ─── Public results (published only) ─────────────────────────────────
//
// Admin client, no auth — but every loader below checks results_published
// === true FIRST and returns { success: false } otherwise. deck_snapshot is
// never read/returned here; decklist links come from
// tournament_decklists.published_deck_id, and only when decklists_published
// === true.

export interface PublicResultsIndexEvent {
  id: string;
  name: string;
  category: string | null;
  deckFormat: string | null;
  endedAt: string | null;
  playerCount: number;
}

export async function loadPublicResultsIndexAction(
  limit = 50
): Promise<{ success: boolean; events: PublicResultsIndexEvent[] }> {
  const admin = getSupabaseAdmin();

  const { data: tournaments, error } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, ended_at")
    .eq("results_published", true);

  if (error || !tournaments) {
    return { success: false, events: [] };
  }

  const limited = [...tournaments]
    .sort((a: any, b: any) => {
      const aTime = a.ended_at ? new Date(a.ended_at).getTime() : 0;
      const bTime = b.ended_at ? new Date(b.ended_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  // One in-grouped query for all participant counts, rather than one count
  // query per event.
  const ids = limited.map((t: any) => t.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: participantRows } = await admin
      .from("participants")
      .select("tournament_id")
      .in("tournament_id", ids);
    for (const p of participantRows ?? []) {
      counts.set(p.tournament_id, (counts.get(p.tournament_id) ?? 0) + 1);
    }
  }

  const events: PublicResultsIndexEvent[] = limited.map((t: any) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    deckFormat: t.deck_format,
    endedAt: t.ended_at,
    playerCount: counts.get(t.id) ?? 0,
  }));

  return { success: true, events };
}

export interface PublicResultsStandingRow {
  place: number | null;
  name: string | null;
  matchPoints: number | null;
  differential: number | null;
  publishedDeckId: string | null;
  /** Left the event; dropped players have no place. */
  dropped: boolean;
}

export async function loadPublicResultsAction(tournamentId: string): Promise<
  | { success: false }
  | {
      success: true;
      name: string;
      category: string | null;
      deckFormat: FormatId | "Other" | null;
      endedAt: string | null;
      decklistsPublished: boolean;
      standings: PublicResultsStandingRow[];
    }
> {
  const admin = getSupabaseAdmin();

  const { data: tournament, error } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, ended_at, results_published, decklists_published")
    .eq("id", tournamentId)
    .maybeSingle();

  // Gate FIRST: unpublished tournaments never reach the participants/decklist
  // queries below, let alone anything that could expose deck_snapshot.
  if (error || !tournament || tournament.results_published !== true) {
    return { success: false };
  }

  const { data: participants } = await admin
    .from("participants")
    .select("id, place, name, match_points, differential, dropped_out")
    .eq("tournament_id", tournamentId);

  const decklistMap = new Map<string, string>(); // participant_id -> published_deck_id
  if (tournament.decklists_published === true) {
    const { data: decklists } = await admin
      .from("tournament_decklists")
      .select("participant_id, published_deck_id")
      .eq("tournament_id", tournamentId);
    for (const d of decklists ?? []) {
      if (d.published_deck_id) decklistMap.set(d.participant_id, d.published_deck_id);
    }
  }

  const standings: PublicResultsStandingRow[] = (participants ?? [])
    .slice()
    .sort((a: any, b: any) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return (b.match_points ?? 0) - (a.match_points ?? 0);
    })
    .map((p: any) => ({
      place: p.place,
      name: p.name,
      matchPoints: p.match_points,
      differential: p.differential,
      publishedDeckId: decklistMap.get(p.id) ?? null,
      dropped: p.dropped_out === true,
    }));

  return {
    success: true,
    name: tournament.name,
    category: tournament.category,
    deckFormat: normalizeTournamentFormat(tournament.deck_format),
    endedAt: tournament.ended_at,
    decklistsPublished: tournament.decklists_published === true,
    standings,
  };
}

// PostgREST caps a response at 1000 rows and says nothing when it truncates —
// an unpaginated read of a 62-deck field returns a quarter of the cards and
// every frequency built on it is wrong by a factor of four.
const PAGE_SIZE = 1000;

// `.in()` becomes a query string, so a long id list becomes a long URL. At ~37
// characters per uuid, a few hundred decks would exceed what the server will
// accept, which matters for the cross-event pool rather than for one event.
const ID_CHUNK = 200;

/**
 * Every row matching `column IN (ids)`: chunked to keep the URL short, paged to
 * defeat the row cap.
 *
 * Returns null on a query error, which callers treat as a failed load rather
 * than as an empty result — reporting "no cards" for what was really a failed
 * query is the one outcome worse than an error, since it looks like data.
 */
async function fetchAllByIds(
  admin: any,
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<any[] | null> {
  const rows: any[] = [];

  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin
        .from(table)
        .select(columns)
        .in(column, chunk)
        // A stable order is what makes .range() paging coherent; without it
        // Postgres may return overlapping or skipped rows between pages.
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error(`Error loading ${table}:`, error);
        return null;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
  }

  return rows;
}

const DECK_CARD_COLUMNS = "deck_id, card_name, card_set, card_img_file, quantity, zone";

function fetchDeckCards(admin: any, deckIds: string[]): Promise<any[] | null> {
  return fetchAllByIds(admin, "deck_cards", DECK_CARD_COLUMNS, "deck_id", deckIds);
}

export interface TournamentBreakdownResult {
  name: string;
  category: string | null;
  deckFormat: FormatId | "Other" | null;
  endedAt: string | null;
  /** Everyone who played, including those who never submitted a list. */
  fieldSize: number;
  breakdown: TournamentBreakdown;
}

/**
 * Card-level metagame data for a tournament's published decklists.
 *
 * Gated exactly like `loadPublicResultsAction`, plus `decklists_published` —
 * the deck contents this returns are the very thing that flag governs, so an
 * unpublished event must not reach the deck_cards query at all.
 */
export async function loadTournamentBreakdownAction(tournamentId: string): Promise<
  { success: false } | ({ success: true } & TournamentBreakdownResult)
> {
  const admin = getSupabaseAdmin();

  const { data: tournament, error } = await admin
    .from("tournaments")
    .select("id, name, category, deck_format, ended_at, results_published, decklists_published")
    .eq("id", tournamentId)
    .maybeSingle();

  if (
    error ||
    !tournament ||
    tournament.results_published !== true ||
    tournament.decklists_published !== true
  ) {
    return { success: false };
  }

  const [{ data: participants }, { data: links }] = await Promise.all([
    admin
      .from("participants")
      .select("id, name, place")
      .eq("tournament_id", tournamentId),
    admin
      .from("tournament_decklists")
      .select("participant_id, published_deck_id")
      .eq("tournament_id", tournamentId)
      .not("published_deck_id", "is", null),
  ]);

  const byParticipant = new Map((participants ?? []).map((p: any) => [p.id, p]));
  const deckIds = (links ?? [])
    .map((l: any) => l.published_deck_id)
    .filter((id: string | null): id is string => Boolean(id));

  if (deckIds.length === 0) {
    return {
      success: true,
      name: tournament.name,
      category: tournament.category,
      deckFormat: normalizeTournamentFormat(tournament.deck_format),
      endedAt: tournament.ended_at,
      fieldSize: (participants ?? []).length,
      breakdown: buildBreakdown([]),
    };
  }

  const cardRows = await fetchDeckCards(admin, deckIds);
  if (cardRows === null) return { success: false };

  const cardsByDeck = new Map<string, any[]>();
  for (const row of cardRows) {
    const list = cardsByDeck.get(row.deck_id);
    if (list) list.push(row);
    else cardsByDeck.set(row.deck_id, [row]);
  }

  // The unit of analysis is the entry, not the distinct list. Two participants
  // can point at one published deck — at the 2026 Nationals two players brought
  // the same list — and that list genuinely occupied two seats in the field,
  // played its matches twice, and can take two slots in a Top 16. Collapsing it
  // would understate it and put "% of field" over the wrong denominator.
  //
  // Keyed by participant rather than deck: the ids must be unique per entry,
  // and the two rows are what let Deck DNA show the pair as 100% neighbours
  // instead of silently hiding one player.
  const deckInputs: BreakdownDeckInput[] = (links ?? [])
    .filter((link: any) => Boolean(link.published_deck_id))
    .map((link: any) => {
      const participant: any = byParticipant.get(link.participant_id);
      return {
        deckId: link.published_deck_id as string,
        participantId: link.participant_id as string,
        playerName: participant?.name ?? null,
        place: participant?.place ?? null,
        cards: (cardsByDeck.get(link.published_deck_id) ?? []).map((c: any) => ({
          name: c.card_name,
          set: c.card_set,
          imgFile: c.card_img_file,
          quantity: c.quantity,
          zone: c.zone,
        })),
      };
    })
    // Empty lists would drag every "% of field" denominator down without
    // contributing a single card.
    .filter((deck: BreakdownDeckInput) => deck.cards.length > 0);

  return {
    success: true,
    name: tournament.name,
    category: tournament.category,
    deckFormat: normalizeTournamentFormat(tournament.deck_format),
    endedAt: tournament.ended_at,
    fieldSize: (participants ?? []).length,
    breakdown: buildBreakdown(deckInputs),
  };
}

// ─── Cross-event metagame ────────────────────────────────────────────
//
// Same gate as the single-event breakdown, same aggregation, wider net: every
// published event inside a window whose deck format matches. The unit stays the
// entry, so a 62-list Nationals weighs twenty times a 3-list local — which is
// the honest weighting, and why the contributing events are always named on the
// page rather than summed into an anonymous total.

export interface MetagameResult {
  format: MetagameFormatId;
  days: number;
  /** Everyone who played in the contributing events, submitted or not. */
  fieldSize: number;
  /**
   * Events that published lists in the window but in a different format. The
   * empty state needs this to say "nothing here yet" rather than implying the
   * whole window is bare.
   */
  otherFormatEvents: number;
  breakdown: TournamentBreakdown;
}

export async function loadMetagameAction(
  format: MetagameFormatId,
  days: number,
): Promise<{ success: false } | ({ success: true } & MetagameResult)> {
  const admin = getSupabaseAdmin();

  let query = admin
    .from("tournaments")
    .select("id, name, deck_format, ended_at")
    .eq("results_published", true)
    .eq("decklists_published", true)
    // The view is indexed by time, so an event with no recorded end date cannot
    // be placed in any window — including "all time", where showing it would
    // make the windowed views look like they were dropping data.
    .not("ended_at", "is", null);

  if (days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte("ended_at", cutoff.toISOString());
  }

  const { data: tournaments, error } = await query;
  if (error || !tournaments) {
    console.error("Error loading metagame tournaments:", error);
    return { success: false };
  }

  // Format lives as free text ('Limited', 'T1', 'Type 2', …), so the match runs
  // through the canonical normalizer rather than against the stored string.
  const matching = tournaments.filter(
    (t: any) => normalizeTournamentFormat(t.deck_format) === format,
  );
  const otherFormatEvents = tournaments.length - matching.length;

  const empty = (): { success: true } & MetagameResult => ({
    success: true,
    format,
    days,
    fieldSize: 0,
    otherFormatEvents,
    breakdown: buildBreakdown([]),
  });

  if (matching.length === 0) return empty();

  const tournamentIds = matching.map((t: any) => t.id);
  const eventById = new Map<string, BreakdownEvent>(
    matching.map((t: any) => [t.id, { id: t.id, name: t.name, endedAt: t.ended_at }]),
  );

  const [participants, links] = await Promise.all([
    fetchAllByIds(admin, "participants", "id, name, place, tournament_id", "tournament_id", tournamentIds),
    fetchAllByIds(
      admin,
      "tournament_decklists",
      "participant_id, published_deck_id, tournament_id",
      "tournament_id",
      tournamentIds,
    ),
  ]);

  if (participants === null || links === null) return { success: false };

  const byParticipant = new Map(participants.map((p: any) => [p.id, p]));
  const deckIds = links
    .map((l: any) => l.published_deck_id)
    .filter((id: string | null): id is string => Boolean(id));

  if (deckIds.length === 0) {
    return { ...empty(), fieldSize: participants.length };
  }

  const cardRows = await fetchDeckCards(admin, deckIds);
  if (cardRows === null) return { success: false };

  const cardsByDeck = new Map<string, any[]>();
  for (const row of cardRows) {
    const list = cardsByDeck.get(row.deck_id);
    if (list) list.push(row);
    else cardsByDeck.set(row.deck_id, [row]);
  }

  const deckInputs: BreakdownDeckInput[] = links
    .filter((link: any) => Boolean(link.published_deck_id))
    .map((link: any) => {
      const participant: any = byParticipant.get(link.participant_id);
      return {
        deckId: link.published_deck_id as string,
        participantId: link.participant_id as string,
        playerName: participant?.name ?? null,
        place: participant?.place ?? null,
        event: eventById.get(link.tournament_id) ?? null,
        cards: (cardsByDeck.get(link.published_deck_id) ?? []).map((c: any) => ({
          name: c.card_name,
          set: c.card_set,
          imgFile: c.card_img_file,
          quantity: c.quantity,
          zone: c.zone,
        })),
      };
    })
    .filter((deck: BreakdownDeckInput) => deck.cards.length > 0);

  return {
    success: true,
    format,
    days,
    fieldSize: participants.length,
    otherFormatEvents,
    breakdown: buildBreakdown(deckInputs),
  };
}
