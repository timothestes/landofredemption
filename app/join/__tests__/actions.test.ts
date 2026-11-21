import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock specifiers MUST match the implementation's "@/"-aliased imports
// exactly (plus "next/headers") or the mocks silently don't apply.

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

const mockGetUser = vi.fn();
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

const mockRateLimitForUnauthIp = vi.fn();
vi.mock("@/lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
  rateLimitForUnauthIp: (ip: string) => mockRateLimitForUnauthIp(ip),
}));

let mockAdminImpl: any = null;
vi.mock("@/lib/pricing/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => mockAdminImpl),
}));

const mockBuildDeckSubmission = vi.fn();
const mockCleanSnapshotCards = vi.fn();
const mockCheckSnapshotCards = vi.fn();
vi.mock("@/lib/tournament/deckSubmission", () => ({
  buildDeckSubmission: (...args: any[]) => mockBuildDeckSubmission(...args),
  cleanSnapshotCards: (...args: any[]) => mockCleanSnapshotCards(...args),
  checkSnapshotCards: (...args: any[]) => mockCheckSnapshotCards(...args),
}));

import {
  getJoinInfoAction,
  getMySubmissionAction,
  joinTournamentAction,
  resubmitDeckAction,
  updateMySubmissionAction,
} from "../actions";

// --- fake PostgREST chain: .from(table).select().eq()[.eq()][.in()].maybeSingle()/.single() ---
function chainFrom(data: any) {
  const node: any = {
    select: () => node,
    eq: () => node,
    in: () => node,
    maybeSingle: async () => ({ data, error: null }),
    single: async () => ({ data, error: data ? null : { message: "not found" } }),
  };
  return node;
}

function makeAdmin(tables: Record<string, any>, rpcResult?: { data?: any; error?: any }) {
  return {
    from: (table: string) => chainFrom(tables[table] ?? null),
    rpc: vi.fn(async (_name: string, _args: any) => rpcResult ?? { data: { ok: true }, error: null }),
  };
}

const VALID_CODE = "ABCDEF"; // 6 chars, all in the Crockford alphabet used by normalizeJoinCode

function baseTournament(overrides: Record<string, any> = {}) {
  return {
    id: "t1",
    name: "Spring Open",
    category: "Standard",
    deck_format: "Limited",
    require_decklists: false,
    has_started: false,
    host_id: "host1",
    code: VALID_CODE,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockRateLimitForUnauthIp.mockResolvedValue({ success: true, limit: 30, remaining: 29, reset: 0 });
  mockAdminImpl = null;
});

describe("getJoinInfoAction", () => {
  it("invalid code short-circuits before any client/limiter call", async () => {
    const r = await getJoinInfoAction("not-a-code");
    expect(r).toEqual({ success: false, error: "invalid_code" });
    expect(mockRateLimitForUnauthIp).not.toHaveBeenCalled();
  });

  it("rate-limited (anonymous only)", async () => {
    mockRateLimitForUnauthIp.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 });
    const r = await getJoinInfoAction(VALID_CODE);
    expect(r).toEqual({ success: false, error: "rate_limited" });
  });

  it("signed-in user skips the IP limiter entirely", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockRateLimitForUnauthIp.mockResolvedValue({ success: false, limit: 30, remaining: 0, reset: 0 });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament(),
      profiles: { username: "hosty" },
      participants: null,
    });
    const r = await getJoinInfoAction(VALID_CODE);
    expect(mockRateLimitForUnauthIp).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it("limiter throwing fails open (info still succeeds)", async () => {
    mockRateLimitForUnauthIp.mockImplementation(async () => {
      throw new Error("KV_REST_API_URL/TOKEN not set");
    });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament(),
      profiles: { username: "hosty" },
      participants: null,
    });
    const r = await getJoinInfoAction(VALID_CODE);
    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.tournamentName).toBe("Spring Open");
      expect(r.hostName).toBe("hosty");
      expect(r.joined).toBeNull();
    }
  });

  it("unknown code -> invalid_code", async () => {
    mockAdminImpl = makeAdmin({ tournaments: null });
    const r = await getJoinInfoAction(VALID_CODE);
    expect(r).toEqual({ success: false, error: "invalid_code" });
  });

  it("signed-in + already joined surfaces displayName and submission", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament({ require_decklists: true }),
      profiles: { username: "hosty" },
      participants: { id: "p1", name: "Timmy" },
      tournament_deck_submissions: {
        deck_snapshot: { deckName: "My Deck" },
        submitted_at: "2026-07-27T00:00:00Z",
        is_legal: true,
      },
    });
    const r = await getJoinInfoAction(VALID_CODE);
    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.requiresDecklist).toBe(true);
      expect(r.joined).toEqual({
        displayName: "Timmy",
        submission: { deckName: "My Deck", submittedAt: "2026-07-27T00:00:00Z", isLegal: true },
      });
    }
  });
});

describe("joinTournamentAction", () => {
  it("signed-out -> not_signed_in", async () => {
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "not_signed_in" });
  });

  it("started -> started", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: baseTournament({ has_started: true }) });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "started" });
  });

  it("decklist required but no deckId -> decklist_required", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: baseTournament({ require_decklists: true }) });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "decklist_required" });
    expect(mockBuildDeckSubmission).not.toHaveBeenCalled();
  });

  it("format Other + require_decklists -> decklist_required (misconfigured event), never calls buildDeckSubmission", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament({ require_decklists: true, deck_format: "Draft" }),
    });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy", deckId: "d1" });
    expect(r).toEqual({ success: false, error: "decklist_required" });
    expect(mockBuildDeckSubmission).not.toHaveBeenCalled();
  });

  it("illegal deck -> deck_illegal with issues passed through", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament({ require_decklists: true, deck_format: "Limited" }),
    });
    const issues = [{ type: "error", rule: "min-main", message: "too few cards", cards: [] }];
    mockBuildDeckSubmission.mockResolvedValue({
      success: true,
      snapshot: { deckName: "D", deckFormat: "Limited", cards: [] },
      isLegal: false,
      issues,
      hasUnresolvedCards: false,
    });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy", deckId: "d1" });
    expect(r).toEqual({ success: false, error: "deck_illegal", issues });
  });

  it("unresolved cards also -> deck_illegal even if isLegal is true", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament({ require_decklists: true, deck_format: "Limited" }),
    });
    const issues = [{ type: "warning", rule: "card-not-found", message: "?", cards: ["Bogus"] }];
    mockBuildDeckSubmission.mockResolvedValue({
      success: true,
      snapshot: { deckName: "D", deckFormat: "Limited", cards: [] },
      isLegal: true,
      issues,
      hasUnresolvedCards: true,
    });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy", deckId: "d1" });
    expect(r).toEqual({ success: false, error: "deck_illegal", issues });
  });

  it("deck_not_found / deck_not_accessible pass through from the builder", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({
      tournaments: baseTournament({ require_decklists: true, deck_format: "Limited" }),
    });
    mockBuildDeckSubmission.mockResolvedValue({ success: false, error: "deck_not_accessible" });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy", deckId: "d1" });
    expect(r).toEqual({ success: false, error: "deck_not_accessible" });
  });

  it("legal path: rpc called with p_resubmit=false and the SAME snapshot object the builder returned", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const admin = makeAdmin(
      { tournaments: baseTournament({ require_decklists: true, deck_format: "Limited" }) },
      { data: { ok: true, participant_id: "p1" }, error: null }
    );
    mockAdminImpl = admin;
    const snapshotObj = { deckName: "D", deckFormat: "Limited", cards: [] };
    mockBuildDeckSubmission.mockResolvedValue({
      success: true,
      snapshot: snapshotObj,
      isLegal: true,
      issues: [],
      hasUnresolvedCards: false,
    });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "  Timmy  ", deckId: "d1" });
    expect(r).toEqual({ success: true });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = admin.rpc.mock.calls[0];
    expect(rpcName).toBe("tournament_qr_join");
    expect(rpcArgs.p_snapshot).toBe(snapshotObj); // reference equality, not deep-equal
    expect(rpcArgs.p_resubmit).toBe(false);
    expect(rpcArgs.p_display_name).toBe("Timmy");
    expect(rpcArgs.p_deck_id).toBe("d1");
    expect(rpcArgs.p_code).toBe(VALID_CODE);
  });

  it("display name sanitized: control chars stripped, trimmed, capped at 40", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const admin = makeAdmin({ tournaments: baseTournament() });
    mockAdminImpl = admin;
    // Real C0 control chars (BEL, NUL) spliced in on purpose -- the point of
    // this test is to exercise the strip-control-chars path, not just
    // trim/slice. "  Tim" + BEL + "my" + NUL + 50 x's + "  "
    const dirty = "  Tim" + String.fromCharCode(7) + "my" + String.fromCharCode(0) + "x".repeat(50) + "  ";
    const r = await joinTournamentAction(VALID_CODE, { displayName: dirty });
    expect(r).toEqual({ success: true });
    const rpcArgs = admin.rpc.mock.calls[0][1];
    // Literal expected string (not re-derived via the same strip/trim/slice
    // pipeline as the implementation) so a regression in that pipeline --
    // including the control-char strip specifically -- actually fails this.
    expect(rpcArgs.p_display_name).toBe("Timmy" + "x".repeat(35));
  });

  it("blank display name after sanitization -> invalid_name", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: baseTournament() });
    const r = await joinTournamentAction(VALID_CODE, { displayName: "      " });
    expect(r).toEqual({ success: false, error: "invalid_name" });
  });

  it("RPC already_joined surfaces verbatim", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: { ok: false, error: "already_joined" }, error: null }
    );
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "already_joined" });
  });

  it("RPC blocked surfaces verbatim", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: { ok: false, error: "blocked" }, error: null }
    );
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "blocked" });
  });

  it("RPC not_found maps to invalid_code", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: { ok: false, error: "not_found" }, error: null }
    );
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "invalid_code" });
  });

  it("unknown RPC error string maps to join_failed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: { ok: false, error: "some_new_sql_error" }, error: null }
    );
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "join_failed" });
  });

  it("rpc-level transport error -> join_failed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: null, error: { message: "connection reset" } }
    );
    const r = await joinTournamentAction(VALID_CODE, { displayName: "Timmy" });
    expect(r).toEqual({ success: false, error: "join_failed" });
  });
});

describe("resubmitDeckAction", () => {
  it("passes p_resubmit=true and p_display_name=null (no display-name requirement)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const admin = makeAdmin(
      { tournaments: baseTournament({ require_decklists: true, deck_format: "Limited" }) },
      { data: { ok: true, participant_id: "p1" }, error: null }
    );
    mockAdminImpl = admin;
    const snapshotObj = { deckName: "D2", deckFormat: "Limited", cards: [] };
    mockBuildDeckSubmission.mockResolvedValue({
      success: true,
      snapshot: snapshotObj,
      isLegal: true,
      issues: [],
      hasUnresolvedCards: false,
    });
    const r = await resubmitDeckAction(VALID_CODE, "d2");
    expect(r).toEqual({ success: true });
    const rpcArgs = admin.rpc.mock.calls[0][1];
    expect(rpcArgs.p_resubmit).toBe(true);
    expect(rpcArgs.p_display_name).toBeNull();
    expect(rpcArgs.p_snapshot).toBe(snapshotObj);
  });

  it("RPC not_joined surfaces verbatim", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin(
      { tournaments: baseTournament() },
      { data: { ok: false, error: "not_joined" }, error: null }
    );
    const r = await resubmitDeckAction(VALID_CODE, "d2");
    expect(r).toEqual({ success: false, error: "not_joined" });
  });
});

describe("the player's own submitted list", () => {
  const CARDS = [{ name: "Card A", set: "TPC", imgFile: "a", quantity: 50, zone: "main" }];
  const stored = {
    deck_id: "d1",
    deck_snapshot: { deckName: "My deck", deckFormat: "Type 1", cards: CARDS },
    is_legal: true,
    deckcheck_issues: null,
  };
  const joinedAdmin = (tournament: Record<string, any> = {}, rpc?: { data?: any; error?: any }) =>
    makeAdmin(
      {
        tournaments: baseTournament({ require_decklists: true, ...tournament }),
        participants: { id: "p1" },
        tournament_deck_submissions: stored,
      },
      rpc
    );

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockCleanSnapshotCards.mockImplementation((c: any) => c);
    mockCheckSnapshotCards.mockResolvedValue({ isLegal: true, issues: [], hasUnresolvedCards: false });
  });

  it("reads back the cards that were handed in", async () => {
    mockAdminImpl = joinedAdmin();
    expect(await getMySubmissionAction(VALID_CODE)).toEqual({
      success: true,
      deckName: "My deck",
      cards: CARDS,
      hasStarted: false,
    });
  });

  it("signed out, or not in the event: nothing is read", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockAdminImpl = joinedAdmin();
    expect(await getMySubmissionAction(VALID_CODE)).toEqual({ success: false, error: "not_signed_in" });
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockAdminImpl = makeAdmin({ tournaments: baseTournament(), participants: null });
    expect(await getMySubmissionAction(VALID_CODE)).toEqual({ success: false, error: "not_joined" });
  });

  it("a legal edit is saved as a resubmit that keeps the deck's name and where it came from", async () => {
    const admin = joinedAdmin();
    mockAdminImpl = admin;
    const edited = [{ ...CARDS[0], quantity: 49 }, { name: "Card B", set: "TPC", imgFile: "b", quantity: 1, zone: "main" }];
    expect(await updateMySubmissionAction(VALID_CODE, edited)).toEqual({ success: true });
    expect(mockCheckSnapshotCards).toHaveBeenCalledWith(edited, "Limited");
    const args = admin.rpc.mock.calls[0][1];
    expect(admin.rpc.mock.calls[0][0]).toBe("tournament_qr_join");
    expect(args).toMatchObject({ p_code: VALID_CODE, p_user_id: "u1", p_display_name: null, p_deck_id: "d1", p_resubmit: true, p_is_legal: true, p_issues: null });
    expect(args.p_snapshot).toEqual({ deckName: "My deck", deckFormat: "Type 1", cards: edited });
  });

  it("an edit that fails the deck check is not saved, and its issues come back", async () => {
    const admin = joinedAdmin();
    mockAdminImpl = admin;
    const issues = [{ type: "error", rule: "t1-deck-size", message: "Too few cards" }];
    mockCheckSnapshotCards.mockResolvedValue({ isLegal: false, issues, hasUnresolvedCards: false });
    expect(await updateMySubmissionAction(VALID_CODE, CARDS)).toEqual({ success: false, error: "deck_illegal", issues });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("a card the catalog does not have blocks the save even when the check passes", async () => {
    const admin = joinedAdmin();
    mockAdminImpl = admin;
    mockCheckSnapshotCards.mockResolvedValue({ isLegal: true, issues: [], hasUnresolvedCards: true });
    expect((await updateMySubmissionAction(VALID_CODE, CARDS)).success).toBe(false);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("locked once the event has started, before anything is checked", async () => {
    const admin = joinedAdmin({ has_started: true });
    mockAdminImpl = admin;
    expect(await updateMySubmissionAction(VALID_CODE, CARDS)).toEqual({ success: false, error: "started" });
    expect(mockCheckSnapshotCards).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("the start landing mid-save is reported as started", async () => {
    mockAdminImpl = joinedAdmin({}, { data: { ok: false, error: "started" }, error: null });
    expect(await updateMySubmissionAction(VALID_CODE, CARDS)).toEqual({ success: false, error: "started" });
  });

  it("refuses input that is not a card list, a player with no submission, and a signed-out caller", async () => {
    const admin = joinedAdmin();
    mockAdminImpl = admin;
    mockCleanSnapshotCards.mockReturnValue(null);
    expect(await updateMySubmissionAction(VALID_CODE, "nope")).toEqual({ success: false, error: "join_failed" });
    expect(admin.rpc).not.toHaveBeenCalled();

    mockCleanSnapshotCards.mockImplementation((c: any) => c);
    mockAdminImpl = makeAdmin({ tournaments: baseTournament({ require_decklists: true }), participants: { id: "p1" }, tournament_deck_submissions: null });
    expect(await updateMySubmissionAction(VALID_CODE, CARDS)).toEqual({ success: false, error: "not_joined" });

    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await updateMySubmissionAction(VALID_CODE, CARDS)).toEqual({ success: false, error: "not_signed_in" });
  });
});
