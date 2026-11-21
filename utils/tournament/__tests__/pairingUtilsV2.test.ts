import { describe, it, expect, vi, beforeEach } from "vitest";
import { rngForRound } from "../../../lib/tournament/rng";
import { pairFirstRound } from "../../../lib/tournament/pairing";
import { assignTables } from "../../../lib/tournament/tableAssignment";

// createPairing talks to Supabase from the browser. These tests swap the client
// for an in-memory stand-in that can fail one request on demand, the way a
// dropped connection or a rejected write does at a venue.

type Row = Record<string, any>;
type FailMode = "error" | "lost";

interface PlannedFailure {
  table: string;
  op: string;
  mode: FailMode;
  /** Let this many matching requests through before failing one. */
  skip: number;
}

let tables: Record<string, Row[]>;
let failures: PlannedFailure[];
let nextId = 1;

/**
 * Fail one request. "error" rejects it and writes nothing. "lost" applies a
 * write but still reports an error: the request landed, the reply did not.
 */
function failOnce(table: string, op: string, mode: FailMode = "error", skip = 0) {
  failures.push({ table, op, mode, skip });
}

function takeFailure(table: string, op: string): FailMode | null {
  const planned = failures.find((f) => f.table === table && f.op === op);
  if (!planned) return null;
  if (planned.skip > 0) {
    planned.skip -= 1;
    return null;
  }
  failures.splice(failures.indexOf(planned), 1);
  return planned.mode;
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private one = false;
  private max: number | null = null;

  constructor(
    private table: string,
    private op: "select" | "insert" | "upsert" | "delete",
    private payload?: any,
    private onConflict?: string,
  ) {}

  select() { return this; }
  eq(col: string, val: any) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: any[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.one = true; return this; }

  private matching() {
    return tables[this.table].filter((r) => this.filters.every((f) => f(r)));
  }

  private write() {
    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const r of rows) tables[this.table].push({ id: `${this.table}-${nextId++}`, ...r });
    } else if (this.op === "upsert") {
      const keys = (this.onConflict ?? "").split(",");
      const exists = tables[this.table].some((r) => keys.every((k) => r[k] === this.payload[k]));
      if (!exists) tables[this.table].push({ id: `${this.table}-${nextId++}`, ...this.payload });
    } else if (this.op === "delete") {
      const doomed = new Set(this.matching());
      tables[this.table] = tables[this.table].filter((r) => !doomed.has(r));
    }
  }

  private run() {
    const mode = takeFailure(this.table, this.op);
    if (mode === "error") return { data: null, error: { message: `${this.table} ${this.op} failed` } };
    if (this.op !== "select") {
      this.write();
      if (mode === "lost") return { data: null, error: { message: "TypeError: Failed to fetch" } };
      return { data: null, error: null };
    }
    let rows = this.matching();
    if (this.max != null) rows = rows.slice(0, this.max);
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }

  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

const fakeClient = {
  from: (table: string) => ({
    select: () => new Query(table, "select"),
    insert: (payload: any) => new Query(table, "insert", payload),
    upsert: (payload: any, opts?: { onConflict?: string }) =>
      new Query(table, "upsert", payload, opts?.onConflict),
    delete: () => new Query(table, "delete"),
  }),
};

vi.mock("../../supabase/client", () => ({ createClient: () => fakeClient }));

import { createPairing } from "../pairingUtilsV2";

const T = "tournament-1";

function seed(playerCount: number) {
  tables = {
    tournaments: [{
      id: T, n_rounds: 3, current_round: 1, max_score: 5, has_started: true,
      has_ended: false, starting_table_number: 1, numbering_mode: "tables",
    }],
    participants: Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i + 1}`,
      tournament_id: T,
      name: `Player ${i + 1}`,
      joined_at: new Date(2026, 0, 1, 12, i).toISOString(),
      dropped_out: false,
      assigned_seat: null,
    })),
    matches: [],
    byes: [],
    rounds: [],
  };
}

const roundMatches = (round: number) => tables.matches.filter((m) => m.round === round);
const roundByes = (round: number) => tables.byes.filter((b) => b.round_number === round);

/** Everyone who has a seat or the bye in the round, sorted. */
function placed(round: number) {
  return [
    ...roundMatches(round).flatMap((m) => [m.player1_id, m.player2_id]),
    ...roundByes(round).map((b) => b.participant_id),
  ].sort();
}

/** Give round 1 results so a later round has a history to pair from. */
async function playRoundOne() {
  expect(await createPairing(T, 1)).toBe(true);
  for (const m of roundMatches(1)) {
    Object.assign(m, { player1_score: 5, player2_score: 2, is_tie: false, winner_id: m.player1_id });
  }
  tables.rounds[0].started_at = "2026-01-01T13:00:00.000Z";
}

beforeEach(() => {
  failures = [];
  nextId = 1;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createPairing — the normal path", () => {
  it("writes the same rows the pairing functions produce, one bye and a round row", async () => {
    seed(5);
    expect(await createPairing(T, 1)).toBe(true);

    const state = tables.participants.map((p) => ({
      id: p.id, name: p.name, joinedAt: p.joined_at, droppedOut: false, assignedSeat: undefined,
    }));
    const expected = pairFirstRound(state, rngForRound(T, 1));
    const assigned = assignTables(expected.matches, new Map(), { startingTableNumber: 1, mode: "tables" });

    expect(roundMatches(1).map(({ id, ...row }) => row)).toEqual(
      assigned.matches.map((m) => ({
        tournament_id: T,
        round: 1,
        player1_id: m.player1Id,
        player2_id: m.player2Id,
        player1_score: null,
        player2_score: null,
        match_order: m.matchOrder,
        table_number: m.tableNumber,
        player1_pin_overridden: false,
        player2_pin_overridden: false,
      })),
    );
    expect(roundByes(1).map(({ id, ...row }) => row)).toEqual([
      { tournament_id: T, round_number: 1, match_points: 3, differential: 0, participant_id: expected.bye },
    ]);
    expect(tables.rounds.map(({ id, ...row }) => row)).toEqual([
      { tournament_id: T, round_number: 1, started_at: null },
    ]);
  });

  it("pairs a later round without a rematch", async () => {
    seed(4);
    await playRoundOne();
    expect(await createPairing(T, 2)).toBe(true);

    const key = (m: Row) => [m.player1_id, m.player2_id].sort().join("|");
    const played = new Set(roundMatches(1).map(key));
    expect(roundMatches(2)).toHaveLength(2);
    for (const m of roundMatches(2)) expect(played.has(key(m))).toBe(false);
    expect(placed(2)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("createPairing — a round is only ever paired once", () => {
  it("a second call for the same round adds no matches and no bye", async () => {
    seed(5);
    expect(await createPairing(T, 1)).toBe(true);
    const first = JSON.stringify([tables.matches, tables.byes, tables.rounds]);

    expect(await createPairing(T, 1)).toBe(true);
    expect(JSON.stringify([tables.matches, tables.byes, tables.rounds])).toBe(first);
    expect(roundMatches(1)).toHaveLength(2);
    expect(roundByes(1)).toHaveLength(1);
  });

  it("does not pair when it cannot tell whether the round is already paired", async () => {
    seed(4);
    failOnce("matches", "select");
    expect(await createPairing(T, 1)).toBe(false);
    expect(tables.matches).toHaveLength(0);
  });
});

describe("createPairing — a failed write is reported, not hidden", () => {
  it("reports failure when the matches cannot be saved", async () => {
    seed(4);
    failOnce("matches", "insert");
    expect(await createPairing(T, 1)).toBe(false);
    expect(tables.matches).toHaveLength(0);
  });

  it("reports failure when the bye cannot be saved, and saves no matches", async () => {
    seed(5);
    failOnce("byes", "insert");
    expect(await createPairing(T, 1)).toBe(false);
    expect(tables.byes).toHaveLength(0);
    expect(tables.matches).toHaveLength(0);
  });

  it("reports failure when the round row cannot be saved", async () => {
    seed(4);
    failOnce("rounds", "upsert");
    expect(await createPairing(T, 1)).toBe(false);
  });

  it("reports failure when the players cannot be read, instead of an empty round", async () => {
    seed(4);
    await playRoundOne();
    failOnce("participants", "select");
    expect(await createPairing(T, 2)).toBe(false);
    expect(roundMatches(2)).toHaveLength(0);
    expect(tables.rounds.filter((r) => r.round_number === 2)).toHaveLength(0);
  });

  it("reports failure when earlier results cannot be read, instead of pairing as if nobody had played", async () => {
    seed(4);
    await playRoundOne();
    // The first matches read is the already-paired check; the second is the history.
    failOnce("matches", "select", "error", 1);
    expect(await createPairing(T, 2)).toBe(false);
    expect(roundMatches(2)).toHaveLength(0);
  });
});

describe("createPairing — trying again after a failure", () => {
  it("after the matches failed to save: one bye, everyone else paired once", async () => {
    seed(5);
    failOnce("matches", "insert");
    expect(await createPairing(T, 1)).toBe(false);
    expect(roundByes(1)).toHaveLength(1);

    expect(await createPairing(T, 1)).toBe(true);
    expect(roundByes(1)).toHaveLength(1);
    expect(roundMatches(1)).toHaveLength(2);
    expect(placed(1)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("after the reply to the matches write was lost: the round is not doubled", async () => {
    seed(5);
    failOnce("matches", "insert", "lost");
    expect(await createPairing(T, 1)).toBe(false);

    expect(await createPairing(T, 1)).toBe(true);
    expect(roundMatches(1)).toHaveLength(2);
    expect(roundByes(1)).toHaveLength(1);
    expect(tables.rounds).toHaveLength(1);
  });

  it("after the reply to the bye write was lost: the bye is not doubled", async () => {
    seed(5);
    failOnce("byes", "insert", "lost");
    expect(await createPairing(T, 1)).toBe(false);
    expect(roundByes(1)).toHaveLength(1);

    expect(await createPairing(T, 1)).toBe(true);
    expect(roundByes(1)).toHaveLength(1);
    expect(placed(1)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });

  it("a bye left by the failed attempt is replaced when that player has since dropped", async () => {
    seed(5);
    failOnce("matches", "insert");
    expect(await createPairing(T, 1)).toBe(false);
    const leftover = roundByes(1)[0].participant_id;
    tables.participants.find((p) => p.id === leftover)!.dropped_out = true;

    expect(await createPairing(T, 1)).toBe(true);
    expect(roundByes(1)).toHaveLength(0);
    expect(roundMatches(1)).toHaveLength(2);
    expect(placed(1)).not.toContain(leftover);
  });

  it("after only the round row failed: the retry adds the round row and nothing else", async () => {
    seed(4);
    failOnce("rounds", "upsert");
    expect(await createPairing(T, 1)).toBe(false);
    expect(roundMatches(1)).toHaveLength(2);

    expect(await createPairing(T, 1)).toBe(true);
    expect(roundMatches(1)).toHaveLength(2);
    expect(tables.rounds).toHaveLength(1);
  });
});
