import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/pricing/supabase-admin", () => ({ // MUST match the implementation's "@/" specifier exactly or the mock silently doesn't apply
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { loadPublicResultsAction, loadPublicResultsIndexAction } from "../actions";

// Minimal PostgREST chain stub, same shape as Task 4's deckSubmission.test.ts:
// .from().select().eq().maybeSingle() for the single-tournament lookup,
// .from().select().eq() resolving directly for plain filtered lists,
// .from().select().eq().in() for the index's grouped participant count.
// `calls` records how many times participants/decklists were queried so gating
// (early-return on unpublished; decklists skipped when not published) is
// actually asserted, not just inferred from the output.
function fakeAdmin(opts: {
  tournament?: any;
  tournamentsIndex?: any[];
  participants?: any[];
  decklists?: any[];
  calls?: { participants: number; decklists: number };
  /** Collects the column list of every select, keyed by table. */
  selects?: Record<string, string>;
}) {
  const calls = opts.calls ?? { participants: 0, decklists: 0 };
  return {
    from: (table: string) => ({
      select: (columns?: string) => {
        if (opts.selects) opts.selects[table] = columns ?? "";
        return {
          eq: (col: string) => {
            if (table === "tournaments" && col === "id") {
              return {
                maybeSingle: async () => ({ data: opts.tournament ?? null, error: null }),
              };
            }
            if (table === "tournaments") {
              // results_published index filter
              return Promise.resolve({ data: opts.tournamentsIndex ?? [], error: null });
            }
            if (table === "participants") {
              calls.participants++;
              return Promise.resolve({ data: opts.participants ?? [], error: null });
            }
            if (table === "tournament_decklists") {
              calls.decklists++;
              return Promise.resolve({ data: opts.decklists ?? [], error: null });
            }
            return Promise.resolve({ data: [], error: null });
          },
          in: () => {
            calls.participants++;
            return Promise.resolve({ data: opts.participants ?? [], error: null });
          },
        };
      },
    }),
  } as any;
}

beforeEach(() => {
  vi.mocked(getSupabaseAdmin).mockReset();
});

describe("loadPublicResultsAction", () => {
  it("unpublished tournament returns success:false and never touches participants/decklists", async () => {
    const calls = { participants: 0, decklists: 0 };
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournament: {
          id: "t1",
          name: "Spring Open",
          category: "State",
          deck_format: "Limited",
          ended_at: "2026-01-01",
          results_published: false,
          decklists_published: true,
        },
        participants: [{ id: "p1", place: 1, name: "Alice", match_points: 12, differential: 10 }],
        decklists: [{ participant_id: "p1", published_deck_id: "d1" }],
        calls,
      })
    );

    const r = await loadPublicResultsAction("t1");

    expect(r.success).toBe(false);
    expect(calls.participants).toBe(0);
    expect(calls.decklists).toBe(0);
  });

  it("published tournament returns standings ordered place-nulls-last then match_points desc", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournament: {
          id: "t1",
          name: "Spring Open",
          category: "State",
          deck_format: "Limited",
          ended_at: "2026-01-01",
          results_published: true,
          decklists_published: false,
        },
        participants: [
          { id: "p1", place: null, name: "Zeke", match_points: 9, differential: -2 },
          { id: "p2", place: 1, name: "Alice", match_points: 12, differential: 10 },
          { id: "p3", place: null, name: "Sam", match_points: 15, differential: 5 },
          { id: "p4", place: 2, name: "Bob", match_points: 9, differential: 3 },
        ],
      })
    );

    const r = await loadPublicResultsAction("t1");

    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.standings.map((s) => s.name)).toEqual(["Alice", "Bob", "Sam", "Zeke"]);
    }
  });

  it("marks players who dropped, so the page can say so instead of showing a bare dash", async () => {
    const selects: Record<string, string> = {};
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournament: {
          id: "t1",
          name: "Spring Open",
          category: "State",
          deck_format: "Limited",
          ended_at: "2026-01-01",
          results_published: true,
          decklists_published: false,
        },
        participants: [
          { id: "p1", place: 1, name: "Alice", match_points: 12, differential: 10, dropped_out: false },
          { id: "p2", place: null, name: "Zeke", match_points: 3, differential: -4, dropped_out: true },
        ],
        selects,
      })
    );

    const r = await loadPublicResultsAction("t1");

    expect(selects.participants).toContain("dropped_out");
    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.standings.map((s) => [s.name, s.dropped])).toEqual([
        ["Alice", false],
        ["Zeke", true],
      ]);
    }
  });

  it("publishedDeckId is null when decklists_published is false, even though the row has one", async () => {
    const calls = { participants: 0, decklists: 0 };
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournament: {
          id: "t1",
          name: "Spring Open",
          category: "State",
          deck_format: "Limited",
          ended_at: "2026-01-01",
          results_published: true,
          decklists_published: false,
        },
        participants: [{ id: "p1", place: 1, name: "Alice", match_points: 12, differential: 10 }],
        decklists: [{ participant_id: "p1", published_deck_id: "d1" }],
        calls,
      })
    );

    const r = await loadPublicResultsAction("t1");

    expect(r.success).toBe(true);
    if (r.success === true) {
      expect(r.standings[0].publishedDeckId).toBeNull();
      // The results page drops the whole Decklist column off this flag, so it
      // has to reach the UI rather than being inferred from all-null rows.
      expect(r.decklistsPublished).toBe(false);
    }
    expect(calls.decklists).toBe(0); // gated on decklists_published, never queried
  });

  it("payload never contains a deck_snapshot field, even when the underlying rows carry one", async () => {
    // Hostile-input guard: these rows carry deck_snapshot/deckcheck_issues
    // (as if a careless `.select("*")` or a row spread let them through the
    // query layer). If the loader ever starts spreading raw participant/
    // decklist rows into its output instead of naming fields explicitly,
    // this fixture data would leak and the assertion below would catch it.
    // Without these fields present here, the assertion could only ever
    // prove "the mock lacks the key" — not "the loader strips it."
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournament: {
          id: "t1",
          name: "Spring Open",
          category: "State",
          deck_format: "Limited",
          ended_at: "2026-01-01",
          results_published: true,
          decklists_published: true,
        },
        participants: [
          {
            id: "p1",
            place: 1,
            name: "Alice",
            match_points: 12,
            differential: 10,
            deck_snapshot: { deckName: "Secret Deck", cards: [{ name: "Hidden Card" }] },
            deckcheck_issues: [{ type: "warning", rule: "x", message: "y", cards: [] }],
          },
        ],
        decklists: [
          {
            participant_id: "p1",
            published_deck_id: "d1",
            deck_snapshot: { deckName: "Other Secret Deck", cards: [{ name: "Other Hidden Card" }] },
          },
        ],
      })
    );

    const r = await loadPublicResultsAction("t1");

    expect(r.success).toBe(true);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("deck_snapshot");
    expect(serialized).not.toContain("deckcheck_issues");
    expect(serialized).not.toContain("Secret Deck");
    expect(serialized).not.toContain("Hidden Card");
  });
});

describe("loadPublicResultsIndexAction", () => {
  it("returns published events sorted by ended_at desc with grouped player counts", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      fakeAdmin({
        tournamentsIndex: [
          { id: "t1", name: "Event A", category: "State", deck_format: "Limited", ended_at: "2026-01-10" },
          { id: "t2", name: "Event B", category: "Regional", deck_format: "T2", ended_at: "2026-02-01" },
        ],
        participants: [
          { tournament_id: "t1" },
          { tournament_id: "t1" },
          { tournament_id: "t2" },
        ],
      })
    );

    const r = await loadPublicResultsIndexAction();

    expect(r.success).toBe(true);
    expect(r.events.map((e) => e.id)).toEqual(["t2", "t1"]);
    expect(r.events.find((e) => e.id === "t1")?.playerCount).toBe(2);
    expect(r.events.find((e) => e.id === "t2")?.playerCount).toBe(1);
  });
});
