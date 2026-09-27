import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock specifiers MUST match the implementation's "@/"-aliased imports
// exactly or the mocks silently don't apply (see app/join/__tests__/actions.test.ts).

const mockGetUser = vi.fn();
let userClientImpl: any = null;
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => userClientImpl),
}));

let adminImpl: any = null;
vi.mock("@/lib/pricing/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => adminImpl),
}));

const mockBuildDeckSubmission = vi.fn();
vi.mock("@/lib/tournament/deckSubmission", () => ({
  buildDeckSubmission: (...args: any[]) => mockBuildDeckSubmission(...args),
}));

const mockGenerateJoinCode = vi.fn();
vi.mock("@/lib/tournament/joinCodes", () => ({
  generateJoinCode: () => mockGenerateJoinCode(),
}));

const mockCheckDeck = vi.fn();
vi.mock("@/utils/deckcheck", () => ({
  checkDeck: (...args: any[]) => mockCheckDeck(...args),
}));

const mockBuildStateFromSupabase = vi.fn();
vi.mock("@/utils/tournament/stateAdapter", () => ({
  buildStateFromSupabase: (...args: any[]) => mockBuildStateFromSupabase(...args),
}));

const mockComputeFinalStandings = vi.fn();
vi.mock("@/lib/tournament/standings", () => ({
  computeFinalStandings: (...args: any[]) => mockComputeFinalStandings(...args),
}));

import { createClient } from "@/utils/supabase/server";
import {
  setQrJoinEnabledAction,
  updateJoinSettingsAction,
  attachDeckToParticipantAction,
  detachDeckFromParticipantAction,
  removeParticipantWithBlockAction,
  recheckAllSubmissionsAction,
  setResultsPublishedAction,
  publishTournamentDecklistsAction,
  refreshFinalPlacesAction,
} from "../actions";

const REDEMPTIONCCG_USER_ID = "a0a8e980-f372-4ebd-be25-d2f26507e98f";

// --- fake PostgREST chain builder --------------------------------------
// Every chain call returns the SAME node so the final resolved value can be
// configured directly on it (`_resp`) or via the terminal-method vi.fn's
// (`.single`/`.maybeSingle`), which support .mockResolvedValueOnce() for
// sequential-call scenarios (e.g. a retry loop).
function makeNode() {
  const node: any = { _resp: { data: null, error: null } };
  const self = () => node;
  node.select = vi.fn(self);
  node.eq = vi.fn(self);
  node.not = vi.fn(self);
  node.in = vi.fn(self);
  node.order = vi.fn(self);
  node.limit = vi.fn(self);
  node.update = vi.fn(self);
  node.delete = vi.fn(self);
  node.insert = vi.fn(self);
  node.upsert = vi.fn(self);
  node.single = vi.fn(async () => node._resp);
  node.maybeSingle = vi.fn(async () => node._resp);
  // Lets code `await` a chain that ends on .eq()/.update()/.delete()/.insert()/
  // .upsert() directly, without an explicit .single()/.maybeSingle().
  node.then = (resolve: any) => resolve(node._resp);
  return node;
}

function makeClient(tables: Record<string, ReturnType<typeof makeNode>>) {
  return {
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => tables[table] ?? makeNode()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userClientImpl = null;
  adminImpl = null;
});

// ─── setQrJoinEnabledAction ─────────────────────────────────────────────

describe("setQrJoinEnabledAction", () => {
  it("non-host: zero-row update -> failure, no retry", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null }; // RLS filtered out the row
    userClientImpl = makeClient({ tournaments });
    mockGenerateJoinCode.mockReturnValue("AAAAAA");

    const r = await setQrJoinEnabledAction("t1", true);

    expect(r).toEqual({ success: false, error: "not_found" });
    expect(tournaments.update).toHaveBeenCalledTimes(1);
  });

  it("23505 collision retries with a freshly generated code", async () => {
    const tournaments = makeNode();
    tournaments.maybeSingle
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } })
      .mockResolvedValueOnce({ data: { code: "CODE02" }, error: null });
    userClientImpl = makeClient({ tournaments });
    mockGenerateJoinCode.mockReturnValueOnce("CODE01").mockReturnValueOnce("CODE02");

    const r = await setQrJoinEnabledAction("t1", true);

    expect(r).toEqual({ success: true, code: "CODE02" });
    expect(mockGenerateJoinCode).toHaveBeenCalledTimes(2);
    expect(tournaments.update).toHaveBeenCalledTimes(2);
    expect(tournaments.update).toHaveBeenNthCalledWith(1, { code: "CODE01" });
    expect(tournaments.update).toHaveBeenNthCalledWith(2, { code: "CODE02" });
  });

  it("disabling clears the code", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { code: null }, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await setQrJoinEnabledAction("t1", false);

    expect(r).toEqual({ success: true, code: null });
    expect(tournaments.update).toHaveBeenCalledWith({ code: null });
  });
});

// ─── updateJoinSettingsAction ───────────────────────────────────────────

// The format itself is no longer an input here — Tournament Settings owns it.
// What this action still has to guarantee is the invariant that gate protected:
// require_decklists=true must never persist on an event with no specific
// format, because every player would then be bounced with `decklist_required`.
// It now enforces that against the PERSISTED deck_format instead of a caller-
// supplied one, which also closes the old bypass (passing "Sealed" instead of
// the literal "Other") by construction.
describe("updateJoinSettingsAction", () => {
  it("rejects require_decklists=true when the persisted format is 'Other'", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { deck_format: "Other" }, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await updateJoinSettingsAction("t1", { requireDecklists: true });

    expect(r).toEqual({ success: false, error: "format_required" });
    expect(tournaments.update).not.toHaveBeenCalled();
  });

  it("rejects require_decklists=true when no format is set at all", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { deck_format: null }, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await updateJoinSettingsAction("t1", { requireDecklists: true });

    expect(r).toEqual({ success: false, error: "format_required" });
    expect(tournaments.update).not.toHaveBeenCalled();
  });

  // The old bypass: "Sealed" isn't the literal "Other" but normalizes to it.
  // Reading the persisted value through normalizeTournamentFormat catches it.
  it("rejects a stored format that only normalizes to 'Other' (e.g. 'Sealed')", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { deck_format: "Sealed" }, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await updateJoinSettingsAction("t1", { requireDecklists: true });

    expect(r).toEqual({ success: false, error: "format_required" });
    expect(tournaments.update).not.toHaveBeenCalled();
  });

  it("accepts require_decklists=true when a real format is persisted", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { deck_format: "Limited" }, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await updateJoinSettingsAction("t1", { requireDecklists: true });

    expect(r).toEqual({ success: true });
    expect(tournaments.update).toHaveBeenCalledWith({ require_decklists: true });
  });

  it("turning decklists OFF never needs a format and skips the lookup", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await updateJoinSettingsAction("t1", { requireDecklists: false });

    expect(r).toEqual({ success: true });
    expect(tournaments.select).not.toHaveBeenCalled();
    expect(tournaments.update).toHaveBeenCalledWith({ require_decklists: false });
  });

  it("never writes deck_format — that's Tournament Settings' column now", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: { deck_format: "T2" }, error: null };
    userClientImpl = makeClient({ tournaments });

    await updateJoinSettingsAction("t1", { requireDecklists: true });

    for (const call of tournaments.update.mock.calls) {
      expect(call[0]).not.toHaveProperty("deck_format");
    }
  });
});

// ─── attachDeckToParticipantAction — no-format path access control ──────
//
// On a tournament with no declared format, host-attach can't route through
// buildDeckSubmission (it requires a FormatId) and instead reads the deck
// via the admin client directly. That read bypasses RLS entirely, so it
// must re-enforce buildDeckSubmission's own access rule by hand: owner OR
// not-private. Otherwise a host could attach ANY deck UUID — not just ones
// surfaced by searchDecksForTournamentAction — and read a stranger's
// private decklist back via the submission snapshot.

describe("attachDeckToParticipantAction — no-format path", () => {
  function setupNoFormatHost(deck: { name: string; user_id: string; visibility: string }) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });

    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = { data: null, error: null }; // no existing row -> insert branch

    const tournaments = makeNode();
    tournaments.maybeSingle
      .mockResolvedValueOnce({ data: { id: "t1" }, error: null }) // requireHost
      .mockResolvedValueOnce({ data: { deck_format: null }, error: null }); // deck_format lookup

    userClientImpl = makeClient({ tournament_decklists: tournamentDecklists, tournaments });

    const participants = makeNode();
    participants._resp = { data: { id: "p1" }, error: null }; // participant belongs to t1

    const decks = makeNode();
    decks.maybeSingle.mockResolvedValue({ data: deck, error: null });
    const deckCards = makeNode();
    const submissions = makeNode();
    adminImpl = makeClient({
      participants,
      decks,
      deck_cards: deckCards,
      tournament_deck_submissions: submissions,
    });

    return { decks, deckCards, submissions };
  }

  it("private deck owned by someone else -> no card read, no submission upsert", async () => {
    const { deckCards, submissions } = setupNoFormatHost({
      name: "Victim's Private Deck",
      user_id: "victim1",
      visibility: "private",
    });

    const r = await attachDeckToParticipantAction("t1", "p1", "victim-deck-1");

    // The attach itself (tournament_decklists) still succeeds — only the
    // submission-snapshot side effect is blocked.
    expect(r).toEqual({ success: true });
    expect(deckCards.select).not.toHaveBeenCalled();
    expect(submissions.upsert).not.toHaveBeenCalled();
  });

  it("the host's OWN private deck is still snapshotted", async () => {
    const { deckCards, submissions } = setupNoFormatHost({
      name: "My Own Private Deck",
      user_id: "host1",
      visibility: "private",
    });
    deckCards._resp = { data: [], error: null };

    const r = await attachDeckToParticipantAction("t1", "p1", "own-deck-1");

    expect(r).toEqual({ success: true });
    expect(deckCards.select).toHaveBeenCalledTimes(1);
    expect(submissions.upsert).toHaveBeenCalledTimes(1);
  });

  it("a public deck owned by someone else is still snapshotted", async () => {
    const { deckCards, submissions } = setupNoFormatHost({
      name: "Public Deck",
      user_id: "someoneElse",
      visibility: "public",
    });
    deckCards._resp = { data: [], error: null };

    const r = await attachDeckToParticipantAction("t1", "p1", "public-deck-1");

    expect(r).toEqual({ success: true });
    expect(deckCards.select).toHaveBeenCalledTimes(1);
    expect(submissions.upsert).toHaveBeenCalledTimes(1);
  });
});

// ─── attachDeckToParticipantAction — participant/tournament scoping ─────
//
// requireHost only proves the caller hosts SOME tournament (their own). The
// admin upsert into tournament_deck_submissions is keyed onConflict:
// "participant_id" and bypasses RLS entirely, so a hostile host of their
// own tournament could otherwise pass a victim's participantId (from a
// DIFFERENT tournament) and repoint/overwrite the victim's submission row.
// Guard: admin-read the participant scoped to (id, tournament_id) and bail
// before any write when it doesn't match — same pattern
// removeParticipantWithBlockAction already uses.

describe("attachDeckToParticipantAction — participant/tournament scoping", () => {
  it("participantId belongs to a different tournament -> failure, no tournament_decklists or submissions writes", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });

    const tournaments = makeNode();
    tournaments._resp = { data: { id: "t1" }, error: null }; // requireHost: caller hosts t1

    const tournamentDecklists = makeNode();
    userClientImpl = makeClient({ tournaments, tournament_decklists: tournamentDecklists });

    const participants = makeNode();
    // Admin-scoped lookup for (id: "p1", tournament_id: "t1") finds nothing —
    // p1 actually belongs to a different (victim's) tournament.
    participants._resp = { data: null, error: null };
    const submissions = makeNode();
    adminImpl = makeClient({ participants, tournament_deck_submissions: submissions });

    const r = await attachDeckToParticipantAction("t1", "p1", "some-deck");

    expect(r).toEqual({ success: false, error: "not_found" });
    expect(participants.eq).toHaveBeenCalledWith("id", "p1");
    expect(participants.eq).toHaveBeenCalledWith("tournament_id", "t1");
    expect(tournamentDecklists.select).not.toHaveBeenCalled();
    expect(tournamentDecklists.insert).not.toHaveBeenCalled();
    expect(tournamentDecklists.update).not.toHaveBeenCalled();
    expect(submissions.upsert).not.toHaveBeenCalled();
  });

  it("non-host -> failure before any participant lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "intruder" } } });
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null }; // RLS: not visible to non-host
    userClientImpl = makeClient({ tournaments });
    const adminFrom = vi.fn();
    adminImpl = { from: adminFrom };

    const r = await attachDeckToParticipantAction("t1", "p1", "some-deck");

    expect(r).toEqual({ success: false, error: "not_found" });
    expect(adminFrom).not.toHaveBeenCalled();
  });
});

// ─── detachDeckFromParticipantAction ────────────────────────────────────

describe("detachDeckFromParticipantAction", () => {
  it("zero-row user-client delete (not the host) touches NO submission row", async () => {
    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = { data: [], error: null }; // RLS blocked the delete
    userClientImpl = makeClient({ tournament_decklists: tournamentDecklists });
    const adminFrom = vi.fn();
    adminImpl = { from: adminFrom };

    const r = await detachDeckFromParticipantAction("p1");

    expect(r).toEqual({ success: false, error: "not_found" });
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("a real deleted row admin-deletes the submission", async () => {
    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = { data: [{ tournament_id: "t1" }], error: null };
    userClientImpl = makeClient({ tournament_decklists: tournamentDecklists });
    const submissions = makeNode();
    adminImpl = makeClient({ tournament_deck_submissions: submissions });

    const r = await detachDeckFromParticipantAction("p1");

    expect(r).toEqual({ success: true });
    expect(submissions.delete).toHaveBeenCalledTimes(1);
    expect(submissions.eq).toHaveBeenCalledWith("participant_id", "p1");
  });
});

// ─── removeParticipantWithBlockAction ───────────────────────────────────

describe("removeParticipantWithBlockAction", () => {
  function setupHost(participantUserId: string | null) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });
    const tournaments = makeNode();
    tournaments._resp = { data: { id: "t1" }, error: null };
    const participantsUser = makeNode();
    participantsUser._resp = { data: null, error: null };
    userClientImpl = makeClient({ tournaments, participants: participantsUser });

    const participantsAdmin = makeNode();
    participantsAdmin._resp = { data: { user_id: participantUserId }, error: null };
    const joinBlocks = makeNode();
    adminImpl = makeClient({ participants: participantsAdmin, tournament_join_blocks: joinBlocks });
    return { joinBlocks };
  }

  it("block=true + user-linked participant -> inserts the block", async () => {
    const { joinBlocks } = setupHost("u1");

    const r = await removeParticipantWithBlockAction("t1", "p1", true);

    expect(r).toEqual({ success: true });
    expect(joinBlocks.upsert).toHaveBeenCalledWith(
      { tournament_id: "t1", user_id: "u1" },
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });

  it("block=false -> no block row inserted even though the participant is user-linked", async () => {
    const { joinBlocks } = setupHost("u1");

    const r = await removeParticipantWithBlockAction("t1", "p1", false);

    expect(r).toEqual({ success: true });
    expect(joinBlocks.upsert).not.toHaveBeenCalled();
  });

  it("block=true but participant was never account-linked -> no block row inserted", async () => {
    const { joinBlocks } = setupHost(null);

    const r = await removeParticipantWithBlockAction("t1", "p1", true);

    expect(r).toEqual({ success: true });
    expect(joinBlocks.upsert).not.toHaveBeenCalled();
  });

  it("non-host -> failure, admin client never touched", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "intruder" } } });
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null }; // RLS: not visible to non-host
    userClientImpl = makeClient({ tournaments });
    const adminFrom = vi.fn();
    adminImpl = { from: adminFrom };

    const r = await removeParticipantWithBlockAction("t1", "p1", true);

    expect(r).toEqual({ success: false, error: "not_found" });
    expect(adminFrom).not.toHaveBeenCalled();
  });
});

// ─── recheckAllSubmissionsAction ────────────────────────────────────────

describe("recheckAllSubmissionsAction", () => {
  it("updates is_legal/deckcheck_issues from each submission's snapshot and counts newly-illegal", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });
    const tournaments = makeNode();
    tournaments._resp = { data: { id: "t1", deck_format: "Limited" }, error: null };
    userClientImpl = makeClient({ tournaments });

    const submissions = makeNode();
    submissions._resp = {
      data: [
        {
          id: "s1",
          is_legal: true,
          deck_snapshot: {
            deckName: "D1",
            deckFormat: "Limited",
            cards: [
              { name: "Card A", set: "TPC", imgFile: null, quantity: 40, zone: "main" },
              { name: "Card B", set: "TPC", imgFile: null, quantity: 10, zone: "reserve" },
            ],
          },
        },
        {
          id: "s2",
          is_legal: false,
          deck_snapshot: {
            deckName: "D2",
            deckFormat: "Limited",
            cards: [{ name: "Card C", set: "TPC", imgFile: null, quantity: 50, zone: "main" }],
          },
        },
      ],
      error: null,
    };
    adminImpl = makeClient({ tournament_deck_submissions: submissions });

    mockCheckDeck
      .mockResolvedValueOnce({ valid: false, issues: [{ type: "error", rule: "x", message: "now illegal" }] })
      .mockResolvedValueOnce({ valid: true, issues: [] });

    const r = await recheckAllSubmissionsAction("t1");

    expect(r).toEqual({ success: true, rechecked: 2, nowIllegal: 1 });
    expect(mockCheckDeck).toHaveBeenNthCalledWith(
      1,
      [{ name: "Card A", set: "TPC", quantity: 40, imgFile: undefined }],
      [{ name: "Card B", set: "TPC", quantity: 10, imgFile: undefined }],
      "Limited"
    );
    expect(submissions.update).toHaveBeenNthCalledWith(1, {
      is_legal: false,
      deckcheck_issues: [{ type: "error", rule: "x", message: "now illegal" }],
    });
    expect(submissions.update).toHaveBeenNthCalledWith(2, { is_legal: true, deckcheck_issues: null });
  });

  it("format null/'Other' -> fails fast, never calls checkDeck", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });
    const tournaments = makeNode();
    tournaments._resp = { data: { id: "t1", deck_format: null }, error: null };
    userClientImpl = makeClient({ tournaments });
    const submissions = makeNode();
    adminImpl = makeClient({ tournament_deck_submissions: submissions });

    const r = await recheckAllSubmissionsAction("t1");

    expect(r).toEqual({ success: false, rechecked: 0, nowIllegal: 0, error: "format_required" });
    expect(mockCheckDeck).not.toHaveBeenCalled();
    expect(submissions.select).not.toHaveBeenCalled();
  });
});

// ─── setResultsPublishedAction / persistFinalPlaces ─────────────────────

describe("setResultsPublishedAction", () => {
  it("published=true persists final places (via the shared persistFinalPlaces helper)", async () => {
    const participants = makeNode();
    participants._resp = { data: null, error: null };
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null };
    userClientImpl = makeClient({ participants, tournaments });

    mockBuildStateFromSupabase.mockResolvedValue({ fake: "state" });
    mockComputeFinalStandings.mockReturnValue([
      { participantId: "p1", place: 1 },
      { participantId: "p2", place: 2 },
    ]);

    const r = await setResultsPublishedAction("t1", true);

    expect(r).toEqual({ success: true });
    expect(mockBuildStateFromSupabase).toHaveBeenCalledWith(userClientImpl, "t1");
    expect(mockComputeFinalStandings).toHaveBeenCalledWith({ fake: "state" });
    // place writes for both placed participants, plus the dropped-out clear.
    expect(participants.update).toHaveBeenCalledWith({ place: 1 });
    expect(participants.update).toHaveBeenCalledWith({ place: 2 });
    expect(participants.update).toHaveBeenCalledWith({ place: null });
    expect(tournaments.update).toHaveBeenCalledWith({ results_published: true });
  });

  it("published=false does NOT recompute standings, only flips the flag", async () => {
    const tournaments = makeNode();
    tournaments._resp = { data: null, error: null };
    userClientImpl = makeClient({ tournaments });

    const r = await setResultsPublishedAction("t1", false);

    expect(r).toEqual({ success: true });
    expect(mockBuildStateFromSupabase).not.toHaveBeenCalled();
    expect(tournaments.update).toHaveBeenCalledWith({ results_published: false });
  });
});

// ─── publishTournamentDecklistsAction ───────────────────────────────────

describe("publishTournamentDecklistsAction — snapshot-first", () => {
  it("prefers the submission snapshot over the live deck when both exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });

    const tournaments = makeNode();
    tournaments.single.mockResolvedValue({ data: { name: "Spring Open" }, error: null });
    tournaments.maybeSingle.mockResolvedValue({ data: { id: "t1" }, error: null }); // requireHost
    tournaments._resp = { data: null, error: null }; // final decklists_published update

    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = {
      data: [
        {
          id: "dl1",
          deck_id: "live-deck-1",
          published_deck_id: null,
          participant_id: "p1",
          participants: { name: "Timmy" },
        },
      ],
      error: null,
    };

    const participants = makeNode();
    participants._resp = { data: null, error: null };

    userClientImpl = makeClient({
      tournaments,
      tournament_decklists: tournamentDecklists,
      participants,
    });

    mockBuildStateFromSupabase.mockResolvedValue({ fake: "state" });
    mockComputeFinalStandings.mockReturnValue([{ participantId: "p1", place: 1 }]);

    const submissions = makeNode();
    submissions._resp = {
      data: [
        {
          participant_id: "p1",
          is_legal: true,
          deckcheck_issues: null,
          deck_snapshot: {
            deckName: "Timmy's Submitted Deck",
            deckFormat: "Limited",
            cards: [
              { name: "Snapshot Card", set: "TPC", imgFile: "snap.jpg", quantity: 3, zone: "main" },
              // Reserve cards must not reach card_count — without one here the
              // main-only reduce and an all-zone reduce give the same answer.
              { name: "Reserve Card", set: "TPC", imgFile: "res.jpg", quantity: 7, zone: "reserve" },
            ],
          },
        },
      ],
      error: null,
    };

    const decks = makeNode();
    decks.single.mockResolvedValue({ data: { id: "new-deck-1" }, error: null });

    const deckCards = makeNode();
    deckCards._resp = { data: null, error: null };

    adminImpl = makeClient({
      tournament_deck_submissions: submissions,
      decks,
      deck_cards: deckCards,
      tournament_decklists: tournamentDecklists,
    });

    const r = await publishTournamentDecklistsAction("t1", "Limited");

    expect(r).toEqual({ success: true });

    // The live deck may be consulted for ONE thing — the cover art the player
    // hand-picked, which lives on the deck row and not in the snapshot. Cards
    // and metadata must still come from the snapshot, so the "name,
    // description, format..." live-deck fetch must never fire.
    expect(decks.select).toHaveBeenCalledWith("preview_card_1, preview_card_2");
    expect(decks.select).toHaveBeenCalledWith("id");
    expect(decks.select).not.toHaveBeenCalledWith(
      expect.stringContaining("description")
    );

    expect(decks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: REDEMPTIONCCG_USER_ID,
        name: "Timmy - 1st Place - Spring Open",
        // Main only — the 7 reserve cards in the snapshot don't count.
        card_count: 3,
        is_legal: true,
        deckcheck_issues: null,
        visibility: "public",
      })
    );

    // The bug this replaced: published copies from a snapshot got null covers
    // and rendered as blank tiles on the community decks page. Assert the
    // wiring, not just the helper — reverting the call site must fail here.
    const published = decks.insert.mock.calls[0][0];
    expect(published.preview_card_1).toBe("snap.jpg");
    expect(published.preview_card_1).not.toBeNull();

    expect(deckCards.insert).toHaveBeenCalledWith([
      {
        deck_id: "new-deck-1",
        card_name: "Snapshot Card",
        card_set: "TPC",
        card_img_file: "snap.jpg",
        quantity: 3,
        zone: "main",
      },
      {
        deck_id: "new-deck-1",
        card_name: "Reserve Card",
        card_set: "TPC",
        card_img_file: "res.jpg",
        quantity: 7,
        zone: "reserve",
      },
    ]);

    expect(tournamentDecklists.update).toHaveBeenCalledWith({ published_deck_id: "new-deck-1" });
  });

  it("no submission and no live deck (deck_id null) skips the participant without erroring", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });

    const tournaments = makeNode();
    tournaments.single.mockResolvedValue({ data: { name: "Spring Open" }, error: null });
    tournaments.maybeSingle.mockResolvedValue({ data: { id: "t1" }, error: null });
    tournaments._resp = { data: null, error: null };

    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = {
      data: [
        {
          id: "dl1",
          deck_id: null,
          published_deck_id: null,
          participant_id: "p1",
          participants: { name: "Ghost" },
        },
      ],
      error: null,
    };

    const participants = makeNode();
    participants._resp = { data: null, error: null };

    userClientImpl = makeClient({ tournaments, tournament_decklists: tournamentDecklists, participants });

    mockBuildStateFromSupabase.mockResolvedValue(null); // no state -> placementMap stays empty, that's fine

    const submissions = makeNode();
    submissions._resp = { data: [], error: null };
    const decks = makeNode();

    adminImpl = makeClient({
      tournament_deck_submissions: submissions,
      decks,
      tournament_decklists: tournamentDecklists,
    });

    const r = await publishTournamentDecklistsAction("t1", "Limited");

    expect(r).toEqual({ success: true });
    expect(decks.insert).not.toHaveBeenCalled();
  });
});

// ─── refreshFinalPlacesAction (repair after the end) ────────────────────

describe("refreshFinalPlacesAction", () => {
  it("is a no-op while the tournament is still running", async () => {
    const tournaments = makeNode();
    tournaments.maybeSingle.mockResolvedValue({ data: { name: "Spring Open", has_ended: false }, error: null });
    const participants = makeNode();
    userClientImpl = makeClient({ tournaments, participants });

    const r = await refreshFinalPlacesAction("t1");

    expect(r).toEqual({ success: true, renamed: 0 });
    expect(mockBuildStateFromSupabase).not.toHaveBeenCalled();
    expect(participants.update).not.toHaveBeenCalled();
  });

  it("ended tournament: re-persists places through persistFinalPlaces and renames published copies", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "host1" } } });

    const tournaments = makeNode();
    // First read: the has_ended probe; second: requireHost's ownership probe.
    tournaments.maybeSingle
      .mockResolvedValueOnce({ data: { name: "Spring Open", has_ended: true }, error: null })
      .mockResolvedValueOnce({ data: { id: "t1" }, error: null });
    const participants = makeNode();
    participants._resp = { data: null, error: null };
    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = {
      data: [
        { participant_id: "p1", published_deck_id: "pub-1", participants: { name: "Timmy" } },
        { participant_id: "p2", published_deck_id: "pub-2", participants: { name: "Sally" } },
      ],
      error: null,
    };
    userClientImpl = makeClient({ tournaments, participants, tournament_decklists: tournamentDecklists });

    const decks = makeNode();
    decks._resp = { data: null, error: null };
    adminImpl = makeClient({ decks });

    mockBuildStateFromSupabase.mockResolvedValue({ fake: "state" });
    // The corrected standings: Sally now 1st, Timmy 2nd.
    mockComputeFinalStandings.mockReturnValue([
      { participantId: "p2", place: 1 },
      { participantId: "p1", place: 2 },
    ]);

    const r = await refreshFinalPlacesAction("t1");

    expect(r).toEqual({ success: true, renamed: 2 });
    // Same placement-save path as publishing.
    expect(mockBuildStateFromSupabase).toHaveBeenCalledWith(userClientImpl, "t1");
    expect(participants.update).toHaveBeenCalledWith({ place: 1 });
    expect(participants.update).toHaveBeenCalledWith({ place: 2 });
    expect(participants.update).toHaveBeenCalledWith({ place: null });
    // Published copies renamed with the same "Name - Nth Place - Event" rule.
    expect(decks.update).toHaveBeenCalledWith({ name: "Sally - 1st Place - Spring Open" });
    expect(decks.update).toHaveBeenCalledWith({ name: "Timmy - 2nd Place - Spring Open" });
    expect(decks.eq).toHaveBeenCalledWith("id", "pub-1");
    expect(decks.eq).toHaveBeenCalledWith("id", "pub-2");
    expect(decks.eq).toHaveBeenCalledWith("user_id", REDEMPTIONCCG_USER_ID);
  });

  it("ended but nothing published: saves places, renames nothing, never touches the admin client", async () => {
    const tournaments = makeNode();
    tournaments.maybeSingle.mockResolvedValue({ data: { name: "Spring Open", has_ended: true }, error: null });
    const participants = makeNode();
    participants._resp = { data: null, error: null };
    const tournamentDecklists = makeNode();
    tournamentDecklists._resp = { data: [], error: null };
    userClientImpl = makeClient({ tournaments, participants, tournament_decklists: tournamentDecklists });

    mockBuildStateFromSupabase.mockResolvedValue({ fake: "state" });
    mockComputeFinalStandings.mockReturnValue([{ participantId: "p1", place: 1 }]);

    const r = await refreshFinalPlacesAction("t1");

    expect(r).toEqual({ success: true, renamed: 0 });
    expect(participants.update).toHaveBeenCalledWith({ place: 1 });
    expect(adminImpl).toBeNull();
  });
});
