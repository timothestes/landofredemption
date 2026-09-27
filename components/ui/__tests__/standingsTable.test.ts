import { describe, it, expect } from "vitest";
import { buildStandings, explainTiebreak } from "../StandingsTable";

type Participant = {
  id: string;
  name: string;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean;
};

type MatchRow = {
  id: string;
  round: number;
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: string | null;
  is_tie: boolean | null;
};

type ByeRow = { participant_id: string; round_number: number };

// match_points/differential on the participant are now IGNORED by buildStandings
// (MP/DIFF are computed live from matches + byes). We still pass them to keep the
// Participant shape, but they should never drive the displayed numbers or sort.
function p(
  id: string,
  match_points = 0,
  differential = 0,
  dropped_out = false,
): Participant {
  return { id, name: id, match_points, differential, dropped_out };
}

const MAX = 5;

function fullWin(round: number, winner: string, loser: string): MatchRow {
  return {
    id: `${round}-${winner}-${loser}`,
    round,
    player1_id: winner,
    player2_id: loser,
    player1_score: MAX,
    player2_score: 0,
    winner_id: winner,
    is_tie: false,
  };
}

function match(
  round: number,
  p1: string,
  p2: string,
  s1: number | null,
  s2: number | null,
): MatchRow {
  const isTie = s1 !== null && s2 !== null && s1 === s2;
  let winner: string | null = null;
  if (s1 !== null && s2 !== null && !isTie) winner = s1 > s2 ? p1 : p2;
  return {
    id: `${round}-${p1}-${p2}`,
    round,
    player1_id: p1,
    player2_id: p2,
    player1_score: s1,
    player2_score: s2,
    winner_id: winner,
    is_tie: isTie,
  };
}

describe("StandingsTable buildStandings", () => {
  it("shares the place across a head-to-head cycle with identical MP and differential", () => {
    // Exact tie at 3 MP / 0 diff for all three, and the head-to-head results
    // form a cycle (p06 > p12 > p99 > p06), so no player defeated all the
    // others. Nothing is left to separate them — they share the place.
    //   r1: p06 beats p12  → p06 3MP/+5, p12 0MP/-5
    //   r2: p99 beats p06  → p99 3MP/+5, p06 0MP/-5 (p06 total 3MP/0)
    //   r3: p12 beats p99  → p12 3MP/+5 (p12 total 3MP/0), p99 total 3MP/0
    const rows = buildStandings(
      [p("p12"), p("p06"), p("p99")],
      [
        fullWin(1, "p06", "p12"),
        fullWin(2, "p99", "p06"),
        fullWin(3, "p12", "p99"),
      ],
      [],
      null,
      null,
      MAX,
    );
    expect(rows.map((r) => r.mp)).toEqual([3, 3, 3]);
    expect(rows.map((r) => r.diff)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 1]);
    expect(rows[0].tiebreak.by).toBe("shared");
  });

  it("ranks A above B on head-to-head even when B has the better differential", () => {
    // The head-to-head step comes BEFORE differential in the host guide.
    //   r1: C beats A 5-0   → A 0MP/-5 ; C 3MP/+5
    //   r1: B beats D 5-1   → B 3MP/+4 ; D 0MP/-4
    //   r2: A beats B 5-4   → A 3MP/+1 (total 3MP/-4) ; B 0MP/-1 (total 3MP/+3)
    //   r2: C beats D 5-0   → C 6MP/+10 ; D 0MP/-9
    // The 3MP tie group is exactly {A, B}. B's differential (+3) beats A's
    // (-4), but A beat B head-to-head, so A places above B.
    const rows = buildStandings(
      [p("A"), p("B"), p("C"), p("D")],
      [
        match(1, "C", "A", 5, 0),
        match(1, "B", "D", 5, 1),
        match(2, "A", "B", 5, 4),
        match(2, "C", "D", 5, 0),
      ],
      [],
      null,
      null,
      MAX,
    );
    const a = rows.find((r) => r.participant.id === "A")!;
    const b = rows.find((r) => r.participant.id === "B")!;
    expect(a.mp).toBe(3);
    expect(b.mp).toBe(3);
    expect(a.diff).toBe(-4);
    expect(b.diff).toBe(3);
    expect(a.place).toBe(2);
    expect(b.place).toBe(3);
    expect(a.tiebreak.by).toBe("head_to_head");
    expect(a.tiebreak.others).toEqual(["B"]);
  });

  it("gives tied players the same place and skips the next place", () => {
    // A and B both 3MP/+5 and never played each other → they share 1st, and
    // the next players start at 3rd.
    const rows = buildStandings(
      [p("A"), p("B"), p("x"), p("y")],
      [fullWin(1, "A", "x"), fullWin(1, "B", "y")],
      [],
      null,
      null,
      MAX,
    );
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3, 3]);
    expect(rows[0].tiebreak.by).toBe("shared");
    expect(rows[0].tiebreak.others).toEqual(["B"]);
  });

  it("uses live MP as the primary sort and live differential second", () => {
    // mid: 1 full win (3MP/+5). high: 1 full win (3MP) but smaller diff.
    // low: tie only (1.5MP). Order by MP then diff: high/mid (3MP) before low.
    const participants: Participant[] = [p("low"), p("high"), p("mid")];
    const matches: MatchRow[] = [
      match(1, "high", "x", 5, 3), // high: 3MP/+2 (full win, opp not at cap=full win since high=5)
      match(1, "mid", "y", 5, 0), // mid: 3MP/+5
      match(1, "low", "z", 2, 2), // low: 1.5MP/0
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    // mid (3MP/+5) > high (3MP/+2) > low (1.5MP/0)
    expect(rows.map((r) => r.participant.id)).toEqual(["mid", "high", "low"]);
  });

  it("excludes dropped participants from standings", () => {
    const participants: Participant[] = [
      p("A"),
      p("B", 0, 0, /* dropped */ true),
      p("C"),
    ];
    const matches: MatchRow[] = [
      fullWin(1, "A", "C"), // A: 3MP/+5, C: 0/-5
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    expect(rows.map((r) => r.participant.id)).toEqual(["A", "C"]);
  });

  it("leaves order stable when there is no head-to-head between tied players", () => {
    // Both win the same way over different opponents → identical live totals,
    // no direct match → comparator returns 0 → stable order.
    const participants: Participant[] = [p("first"), p("second")];
    const matches: MatchRow[] = [
      fullWin(1, "first", "x"),
      fullWin(1, "second", "y"),
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    expect(rows.map((r) => r.participant.id)).toEqual(["first", "second"]);
  });

  it("computes live MP/DIFF that agree with the W-L-T record mid-round", () => {
    // The core fix: mid-round, a 2-0-0 player must show MP/DIFF reflecting both
    // wins, not stale stored values. Stored props are intentionally wrong here.
    const participants: Participant[] = [
      p("winner", /* stale */ 0, /* stale */ 0),
      p("loserA"),
      p("loserB"),
    ];
    const matches: MatchRow[] = [
      fullWin(1, "winner", "loserA"), // 3MP/+5
      fullWin(2, "winner", "loserB"), // 3MP/+5
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const w = rows.find((r) => r.participant.id === "winner")!;
    expect(`${w.wins}-${w.losses}-${w.ties}`).toBe("2-0-0");
    expect(w.mp).toBe(6); // live, not the stale stored 0
    expect(w.diff).toBe(10);
  });

  it("scores a tie as 1.5 MP / 0 DIFF for both players", () => {
    const participants: Participant[] = [p("a"), p("b")];
    const matches: MatchRow[] = [match(1, "a", "b", 3, 3)];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const a = rows.find((r) => r.participant.id === "a")!;
    const b = rows.find((r) => r.participant.id === "b")!;
    expect(a.mp).toBe(1.5);
    expect(a.diff).toBe(0);
    expect(b.mp).toBe(1.5);
    expect(b.diff).toBe(0);
  });

  it("scores a partial win 2 MP / partial loss 1 MP with real differential", () => {
    // Neither reaches max_score (5): 4 vs 2 → ahead is partial win.
    const participants: Participant[] = [p("ahead"), p("behind")];
    const matches: MatchRow[] = [match(1, "ahead", "behind", 4, 2)];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const ahead = rows.find((r) => r.participant.id === "ahead")!;
    const behind = rows.find((r) => r.participant.id === "behind")!;
    expect(ahead.mp).toBe(2);
    expect(ahead.diff).toBe(2);
    expect(behind.mp).toBe(1);
    expect(behind.diff).toBe(-2);
  });

  it("ignores pre-staged next-round matches with NULL scores", () => {
    const participants: Participant[] = [p("a"), p("b")];
    const matches: MatchRow[] = [
      fullWin(1, "a", "b"), // a: 3MP/+5
      match(2, "a", "b", null, null), // staged R2 pairing, no scores yet
    ];
    const rows = buildStandings(participants, matches, [], null, null, MAX);
    const a = rows.find((r) => r.participant.id === "a")!;
    expect(a.mp).toBe(3);
    expect(a.diff).toBe(5);
  });

  it("W-L-T and live MP exclude byes pre-staged for the upcoming round", () => {
    // Bob lost R1 to Alice and has a bye staged for R2 (round not started).
    // The bye must NOT add +3 MP or a win until R2 starts.
    const participants: Participant[] = [p("alice"), p("bob")];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    // startedRounds = [1] only; R2's bye is gated out.
    const rows = buildStandings(participants, matches, byes, null, [1], MAX);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("0-1-0");
    expect(bob.mp).toBe(0); // bye did NOT add +3
    expect(bob.byes).toBe(0);
  });

  it("adds +3 MP for a bye once its round has started", () => {
    const participants: Participant[] = [p("alice"), p("bob")];
    const matches: MatchRow[] = [fullWin(1, "alice", "bob")];
    const byes: ByeRow[] = [{ participant_id: "bob", round_number: 2 }];
    // R2 now started → bye counts.
    const rows = buildStandings(participants, matches, byes, null, [1, 2], MAX);
    const bob = rows.find((r) => r.participant.id === "bob")!;
    expect(`${bob.wins}-${bob.losses}-${bob.ties}`).toBe("1-1-0");
    expect(bob.mp).toBe(3); // bye added +3
    expect(bob.diff).toBe(-5); // bye contributes 0 diff; R1 loss is -5
    expect(bob.byes).toBe(1);
  });

  it("counts all byes when tournament has ended (currentRound null, no startedRounds)", () => {
    const participants: Participant[] = [p("solo")];
    const byes: ByeRow[] = [
      { participant_id: "solo", round_number: 1 },
      { participant_id: "solo", round_number: 2 },
      { participant_id: "solo", round_number: 3 },
    ];
    const rows = buildStandings(participants, [], byes, null, null, MAX);
    expect(rows[0].wins).toBe(3);
    expect(rows[0].mp).toBe(9); // 3 byes × 3 MP
  });
});

describe("explainTiebreak", () => {
  const nameOf = (id: string) => ({ b: "Bob", c: "Carl", d: "Dave" })[id] ?? id;
  const row = (
    place: number,
    mp: number,
    diff: number,
    tiebreak: any,
  ): any => ({ place, mp, diff, tiebreak });

  it("says nothing when the player was not tied with anyone", () => {
    expect(
      explainTiebreak(
        row(1, 12, 4, { tiedWith: [], by: "none", others: [] }),
        nameOf,
      ),
    ).toBeNull();
  });

  it("names the players beaten head-to-head", () => {
    const text = explainTiebreak(
      row(2, 12, -4, { tiedWith: ["b", "c"], by: "head_to_head", others: ["b", "c"] }),
      nameOf,
    )!;
    expect(text).toContain("Tied on 12 MP with Bob and Carl");
    expect(text).toContain("beating Bob and Carl head-to-head");
  });

  it("explains a differential win as the fallback after head-to-head", () => {
    const text = explainTiebreak(
      row(1, 12, 6, { tiedWith: ["b"], by: "lost_soul_score", others: ["b"] }),
      nameOf,
    )!;
    expect(text).toContain("head-to-head");
    expect(text).toContain("differential");
    expect(text).toContain("Bob");
  });

  it("explains a shared place and the split", () => {
    const text = explainTiebreak(
      row(3, 12, 4, { tiedWith: ["b"], by: "shared", others: ["b"] }),
      nameOf,
    )!;
    expect(text).toContain("share 3rd");
    expect(text).toContain("split");
  });

  it("explains being placed behind the rest of the tie", () => {
    const text = explainTiebreak(
      row(4, 12, -4, { tiedWith: ["b", "c"], by: "behind", others: [] }),
      nameOf,
    )!;
    expect(text).toContain("Bob and Carl");
    expect(text).toContain("behind");
  });

  it("abbreviates a long list of tied players", () => {
    const many = ["b", "c", "d", "e", "f", "g"];
    const text = explainTiebreak(
      row(7, 6, 0, { tiedWith: many, by: "behind", others: [] }),
      nameOf,
    )!;
    expect(text).toContain("Bob, Carl, Dave and 3 others");
  });
});

// ─── Forfeits (migration 110) ─────────────────────────────────────────

describe("buildStandings — forfeits", () => {
  const forfeitRow = (
    round: number,
    p1: string,
    p2: string,
    side: "player1" | "player2" | "both",
  ) => ({
    id: `${round}-${p1}-${p2}-ff`,
    round,
    player1_id: p1,
    player2_id: p2,
    player1_score: 0,
    player2_score: 0,
    winner_id: side === "player1" ? p2 : side === "player2" ? p1 : null,
    is_tie: false,
    player1_forfeit: side !== "player2",
    player2_forfeit: side !== "player1",
  });

  it("forfeiter gets 0 MP / −5 and a loss; opponent gets 3 MP / 0 and a win", () => {
    const rows = buildStandings(
      [p("A"), p("B")],
      [forfeitRow(1, "A", "B", "player1")],
      [],
      null,
      [1],
      MAX,
    );
    const a = rows.find((r) => r.participant.id === "A")!;
    const b = rows.find((r) => r.participant.id === "B")!;
    expect(b.mp).toBe(3);
    expect(b.diff).toBe(0);
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(0);
    expect(a.mp).toBe(0);
    expect(a.diff).toBe(-5);
    expect(a.losses).toBe(1);
    expect(a.wins).toBe(0);
    expect(a.ties).toBe(0);
    expect(b.place).toBe(1);
    expect(a.place).toBe(2);
  });

  it("0–0 souls with a forfeit flag is never counted as a tie", () => {
    const rows = buildStandings(
      [p("A"), p("B")],
      [forfeitRow(1, "A", "B", "player2")],
      [],
      null,
      [1],
      MAX,
    );
    for (const r of rows) expect(r.ties).toBe(0);
    expect(rows.find((r) => r.participant.id === "A")!.mp).toBe(3);
    expect(rows.find((r) => r.participant.id === "B")!.diff).toBe(-5);
  });

  it("double forfeit: both lose, 0 MP / −5 each, nobody awarded the win", () => {
    const rows = buildStandings(
      [p("A"), p("B")],
      [forfeitRow(1, "A", "B", "both")],
      [],
      null,
      [1],
      MAX,
    );
    for (const r of rows) {
      expect(r.mp).toBe(0);
      expect(r.diff).toBe(-5);
      expect(r.losses).toBe(1);
      expect(r.wins).toBe(0);
    }
  });
});
