import { describe, it, expect } from "vitest";
import {
  normalizeName,
  nameMatches,
  findParticipants,
  clockOffsetMs,
  remainingSecondsWithOffset,
  roundPhase,
  buildLiveStandings,
  buildPairings,
  pairingFor,
  tableLabel,
  formatAgo,
  type PublicRoundView,
  type PublicParticipant,
} from "../liveRound";

// ─── Fixtures ────────────────────────────────────────────────────────

const SERVER_NOW = "2026-09-26T18:00:00.000Z";
const serverNowMs = Date.parse(SERVER_NOW);

function participant(id: string, name: string, dropped = false): PublicParticipant {
  return { id, name, match_points: null, differential: null, dropped_out: dropped };
}

function view(overrides: Partial<PublicRoundView> = {}): PublicRoundView {
  return {
    server_now: SERVER_NOW,
    tournament: {
      id: "t1",
      name: "Test Event",
      current_round: 2,
      n_rounds: 3,
      round_length: 45,
      max_score: 5,
      has_started: true,
      has_ended: false,
      results_published: false,
      deck_format: "Limited",
      category: null,
      starting_table_number: 1,
      numbering_mode: "tables",
    },
    rounds: [
      { id: "r1", round_number: 1, started_at: "2026-09-26T16:00:00.000Z", is_completed: true },
      { id: "r2", round_number: 2, started_at: "2026-09-26T17:50:00.000Z", is_completed: false },
    ],
    matches: [
      // Round 1: alice beat bob 5-2, carol tied dave 3-3
      m("m1", 1, 1, "alice", "bob", 5, 2, "alice", false),
      m("m2", 1, 2, "carol", "dave", 3, 3, null, true),
      // Round 2: alice vs carol (unscored), bob vs dave (bob partial win 4-1)
      m("m3", 2, 1, "alice", "carol", null, null, null, false),
      m("m4", 2, 2, "bob", "dave", 4, 1, "bob", false),
    ],
    byes: [{ id: "b1", round_number: 2, participant_id: "erin" }],
    participants: [
      participant("alice", "Alice Anderson"),
      participant("bob", "Bob Brown"),
      participant("carol", "Carol Clark"),
      participant("dave", "Dave Davis"),
      participant("erin", "Erin Evans"),
      participant("frank", "Frank Fox", true),
    ],
    ...overrides,
  };
}

function m(
  id: string,
  round: number,
  table: number | null,
  p1: string,
  p2: string,
  s1: number | null,
  s2: number | null,
  winner: string | null,
  tie: boolean,
) {
  return {
    id,
    round,
    match_order: table,
    table_number: table,
    player1_id: p1,
    player2_id: p2,
    player1_score: s1,
    player2_score: s2,
    winner_id: winner,
    is_tie: tie,
  };
}

// ─── Name matching ───────────────────────────────────────────────────

describe("normalizeName", () => {
  it("lowercases, collapses whitespace, trims", () => {
    expect(normalizeName("  Alice   ANDERSON ")).toBe("alice anderson");
  });
});

describe("nameMatches", () => {
  it("is case- and whitespace-insensitive", () => {
    expect(nameMatches("ALICE  and", "Alice Anderson")).toBe(true);
  });
  it("matches a prefix of the full name", () => {
    expect(nameMatches("ali", "Alice Anderson")).toBe(true);
  });
  it("matches a prefix of any word (surname lookup)", () => {
    expect(nameMatches("anders", "Alice Anderson")).toBe(true);
  });
  it("does not match mid-word substrings", () => {
    expect(nameMatches("lice", "Alice Anderson")).toBe(false);
  });
  it("never matches an empty query", () => {
    expect(nameMatches("   ", "Alice Anderson")).toBe(false);
  });
  it("tolerates a null name", () => {
    expect(nameMatches("a", null)).toBe(false);
  });
});

describe("findParticipants", () => {
  const roster = view().participants;
  it("returns nothing for an empty query", () => {
    expect(findParticipants("", roster)).toEqual([]);
  });
  it("returns the unique prefix match", () => {
    expect(findParticipants("car", roster).map((p) => p.id)).toEqual(["carol"]);
  });
  it("returns every candidate while the query is ambiguous", () => {
    // "d" is a prefix of Dave and of the surname Davis, plus... only dave.
    // Use "a": Alice, Anderson — but also nothing else starts with "a".
    // Pick "b": Bob, Brown → bob only. Ambiguity needs two players: use
    // "e" → Erin Evans only; so build an explicit ambiguous roster.
    const two = [participant("x", "Sam Hill"), participant("y", "Samantha Reed")];
    expect(findParticipants("sam", two).map((p) => p.id)).toEqual(["x", "y"]);
  });
  it("prefers an exact match over other prefix matches", () => {
    const two = [participant("x", "Sam Hill"), participant("y", "Sam")];
    expect(findParticipants("sam", two).map((p) => p.id)).toEqual(["y"]);
  });
});

// ─── Timer math ──────────────────────────────────────────────────────

describe("clockOffsetMs", () => {
  it("is server minus local", () => {
    expect(clockOffsetMs(SERVER_NOW, serverNowMs - 5 * 60_000)).toBe(5 * 60_000);
    expect(clockOffsetMs(SERVER_NOW, serverNowMs + 90_000)).toBe(-90_000);
  });
  it("falls back to zero on an unparseable timestamp", () => {
    expect(clockOffsetMs("garbage", serverNowMs)).toBe(0);
  });
});

describe("remainingSecondsWithOffset", () => {
  // Round started 10 minutes before server-now; 45-minute round → 35:00 left.
  const startedAt = new Date(serverNowMs - 10 * 60_000).toISOString();

  it("uses the server clock, not the phone's", () => {
    // Phone is 5 minutes slow: without the offset it would claim 40:00 left.
    const slowPhoneNow = serverNowMs - 5 * 60_000;
    const offset = clockOffsetMs(SERVER_NOW, slowPhoneNow);
    expect(remainingSecondsWithOffset(startedAt, 45, slowPhoneNow, offset)).toBe(35 * 60);
  });
  it("agrees for a phone 12 minutes fast", () => {
    const fastPhoneNow = serverNowMs + 12 * 60_000;
    const offset = clockOffsetMs(SERVER_NOW, fastPhoneNow);
    expect(remainingSecondsWithOffset(startedAt, 45, fastPhoneNow, offset)).toBe(35 * 60);
  });
  it("clamps at zero", () => {
    const late = serverNowMs + 60 * 60_000;
    expect(remainingSecondsWithOffset(startedAt, 45, late, 0)).toBe(0);
  });
  it("treats a null round length as zero", () => {
    expect(remainingSecondsWithOffset(startedAt, null, serverNowMs, 0)).toBe(0);
  });
});

// ─── Round phase ─────────────────────────────────────────────────────

describe("roundPhase", () => {
  it("is running while the current round has started and not completed", () => {
    expect(roundPhase(view())).toEqual({
      kind: "running",
      round: 2,
      startedAt: "2026-09-26T17:50:00.000Z",
    });
  });
  it("is waiting when the current round has no rounds row yet (pairings staged by End Round)", () => {
    const v = view();
    v.tournament.current_round = 3;
    expect(roundPhase(v)).toEqual({ kind: "waiting", round: 3 });
  });
  it("is waiting when the rounds row exists without started_at", () => {
    const v = view();
    v.rounds[1] = { ...v.rounds[1], started_at: null };
    expect(roundPhase(v)).toEqual({ kind: "waiting", round: 2 });
  });
  it("is complete once the current round is completed but the event is not over", () => {
    const v = view();
    v.rounds[1] = { ...v.rounds[1], is_completed: true };
    expect(roundPhase(v)).toEqual({ kind: "complete", round: 2 });
  });
  it("is ended when the tournament has ended", () => {
    const v = view();
    v.tournament.has_ended = true;
    expect(roundPhase(v)).toEqual({ kind: "ended" });
  });
});

// ─── Standings mapping ───────────────────────────────────────────────

describe("buildLiveStandings", () => {
  it("maps the RPC JSON into the host's buildStandings and ranks identically", () => {
    const rows = buildLiveStandings(view());
    // alice: r1 full win (3) = 3 MP, +3 diff (r2 unscored)
    // bob:   r1 full loss (0) + r2 partial win (2) = 2 MP, -3 + 3 = 0 diff
    // carol: r1 tie 1.5, diff 0
    // dave:  r1 tie 1.5 + r2 partial loss 1 = 2.5 MP, diff -3
    // erin:  r2 bye, round 2 started → 3 MP, diff 0
    // frank: dropped → excluded
    expect(rows.map((r) => [r.participant.id, r.place, r.mp, r.diff])).toEqual([
      ["alice", 1, 3, 3],
      ["erin", 2, 3, 0],
      ["dave", 3, 2.5, -3],
      ["bob", 4, 2, 0],
      ["carol", 5, 1.5, 0],
    ]);
    expect(rows.find((r) => r.participant.id === "frank")).toBeUndefined();
  });

  it("only scores a bye once its round has started", () => {
    const v = view();
    // Round 2 staged but not started: erin's bye must not count yet.
    v.rounds[1] = { ...v.rounds[1], started_at: null };
    const erin = buildLiveStandings(v).find((r) => r.participant.id === "erin")!;
    expect(erin.mp).toBe(0);
    expect(erin.byes).toBe(0);
  });

  it("falls back to a 5-soul win threshold when max_score is null", () => {
    const v = view();
    v.tournament.max_score = null;
    const alice = buildLiveStandings(v).find((r) => r.participant.id === "alice")!;
    expect(alice.mp).toBe(3); // 5-2 is still a full win at the default cap
  });

  it("ignores matches with a missing side rather than crashing", () => {
    const v = view();
    v.matches.push({ ...m("m5", 2, 3, "alice", "bob", 5, 0, "alice", false), player2_id: null });
    expect(() => buildLiveStandings(v)).not.toThrow();
  });
});

// ─── Pairings ────────────────────────────────────────────────────────

describe("buildPairings", () => {
  it("lists the round's matches by table with names, scores and outcome, byes last", () => {
    const { matches, byes } = buildPairings(view(), 2);
    expect(matches.map((p) => [p.tableNumber, p.p1?.name, p.p2?.name, p.score1, p.score2, p.outcome])).toEqual([
      [1, "Alice Anderson", "Carol Clark", null, null, "pending"],
      [2, "Bob Brown", "Dave Davis", 4, 1, "p1"],
    ]);
    expect(byes.map((b) => b.participant?.name)).toEqual(["Erin Evans"]);
  });

  it("reports ties", () => {
    const { matches } = buildPairings(view(), 1);
    expect(matches[1].outcome).toBe("tie");
  });

  it("numbers legacy rows positionally from starting_table_number when table_number is null", () => {
    const v = view();
    v.tournament.starting_table_number = 10;
    v.matches = [
      m("a", 2, null, "alice", "carol", null, null, null, false),
      m("b", 2, null, "bob", "dave", null, null, null, false),
    ];
    v.matches[0].match_order = 1;
    v.matches[1].match_order = 2;
    expect(buildPairings(v, 2).matches.map((p) => p.tableNumber)).toEqual([10, 11]);
  });

  it("sorts by table number even when rows arrive out of order", () => {
    const v = view();
    v.matches = [v.matches[3], v.matches[2]];
    expect(buildPairings(v, 2).matches.map((p) => p.tableNumber)).toEqual([1, 2]);
  });
});

describe("tableLabel", () => {
  it("labels tables and seat pairs like the host page", () => {
    expect(tableLabel(3, false)).toBe("Table 3");
    expect(tableLabel(3, true)).toBe("Seats 5·6");
  });
});

describe("pairingFor", () => {
  it("finds a player's match with the opponent from their perspective", () => {
    const pairings = buildPairings(view(), 2);
    const mine = pairingFor(pairings, "dave");
    expect(mine).toMatchObject({
      kind: "match",
      tableNumber: 2,
      opponent: { id: "bob" },
      myScore: 1,
      theirScore: 4,
      result: "lost",
    });
  });
  it("reports a bye", () => {
    expect(pairingFor(buildPairings(view(), 2), "erin")).toEqual({ kind: "bye" });
  });
  it("reports unpaired players", () => {
    expect(pairingFor(buildPairings(view(), 2), "frank")).toEqual({ kind: "none" });
  });
  it("reports a pending result", () => {
    expect(pairingFor(buildPairings(view(), 2), "alice")).toMatchObject({ result: "pending" });
  });
});

// ─── "Updated Xs ago" ────────────────────────────────────────────────

describe("formatAgo", () => {
  it("rounds to a friendly unit", () => {
    expect(formatAgo(2)).toBe("just now");
    expect(formatAgo(12)).toBe("12s ago");
    expect(formatAgo(125)).toBe("2m ago");
  });
});
