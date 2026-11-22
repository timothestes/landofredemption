import { describe, it, expect, vi, beforeEach } from "vitest";

// Must match the specifier actions.ts imports, or the mock silently doesn't
// apply and this test hits the network.
vi.mock("../../../utils/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/utils/deckcheck", () => ({
  checkDeck: vi.fn(async () => ({ valid: true, issues: [] })),
}));

import { createClient } from "../../../utils/supabase/server";
import { setDeckPinnedAction } from "../actions";
import { MAX_PINNED_DECKS, PIN_LIMIT_MESSAGE, pinnedFirst } from "../my-decks/pinning";

type Row = Record<string, any>;

/** Tiny in-memory PostgREST: eq filters, update applied on resolve. */
function makeQuery(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let pendingUpdate: Row | null = null;
  const q: any = {};
  q.select = () => q;
  q.eq = (col: string, val: any) => { filters.push((r) => r[col] === val); return q; };
  q.update = (values: Row) => { pendingUpdate = values; return q; };
  const resolve = () => {
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    if (pendingUpdate) for (const r of matched) Object.assign(r, pendingUpdate);
    return { data: matched.map((r) => ({ ...r })), error: null };
  };
  q.then = (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return q;
}

function fakeClient(userId: string | null, decks: Row[]) {
  return {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from: () => makeQuery(decks),
  } as any;
}

const ME = "me";
const OTHER = "someone-else";

function seed(pinnedCount: number) {
  const decks: Row[] = [];
  for (let i = 0; i < 5; i++) {
    decks.push({ id: `mine-${i}`, user_id: ME, is_pinned: i < pinnedCount });
  }
  // Another user's pins never count toward mine.
  decks.push({ id: "theirs-0", user_id: OTHER, is_pinned: true });
  decks.push({ id: "theirs-1", user_id: OTHER, is_pinned: false });
  return decks;
}

const pinnedIds = (decks: Row[], userId = ME) =>
  decks.filter((d) => d.user_id === userId && d.is_pinned).map((d) => d.id);

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

describe("setDeckPinnedAction", () => {
  it("pins a deck while under the cap", async () => {
    const decks = seed(MAX_PINNED_DECKS - 1);
    vi.mocked(createClient).mockResolvedValue(fakeClient(ME, decks));

    const result = await setDeckPinnedAction("mine-4", true);

    expect(result.success).toBe(true);
    expect(pinnedIds(decks)).toContain("mine-4");
    expect(pinnedIds(decks)).toHaveLength(MAX_PINNED_DECKS);
  });

  it("refuses one more pin at the cap and leaves the deck unpinned", async () => {
    const decks = seed(MAX_PINNED_DECKS);
    vi.mocked(createClient).mockResolvedValue(fakeClient(ME, decks));

    const result = await setDeckPinnedAction("mine-4", true);

    expect(result).toEqual({ success: false, error: PIN_LIMIT_MESSAGE });
    expect(pinnedIds(decks)).not.toContain("mine-4");
  });

  it("re-pinning a deck that is already pinned at the cap is not refused", async () => {
    const decks = seed(MAX_PINNED_DECKS);
    vi.mocked(createClient).mockResolvedValue(fakeClient(ME, decks));

    const result = await setDeckPinnedAction("mine-0", true);

    expect(result.success).toBe(true);
    expect(pinnedIds(decks)).toHaveLength(MAX_PINNED_DECKS);
  });

  it("unpins at the cap", async () => {
    const decks = seed(MAX_PINNED_DECKS);
    vi.mocked(createClient).mockResolvedValue(fakeClient(ME, decks));

    const result = await setDeckPinnedAction("mine-0", false);

    expect(result.success).toBe(true);
    expect(pinnedIds(decks)).not.toContain("mine-0");
  });

  it("cannot pin or unpin another user's deck", async () => {
    const decks = seed(0);
    vi.mocked(createClient).mockResolvedValue(fakeClient(ME, decks));

    const pin = await setDeckPinnedAction("theirs-1", true);
    const unpin = await setDeckPinnedAction("theirs-0", false);

    expect(pin).toEqual({ success: false, error: "Deck not found" });
    expect(unpin).toEqual({ success: false, error: "Deck not found" });
    expect(pinnedIds(decks, OTHER)).toEqual(["theirs-0"]);
  });

  it("refuses a signed-out caller", async () => {
    const decks = seed(0);
    vi.mocked(createClient).mockResolvedValue(fakeClient(null, decks));

    const result = await setDeckPinnedAction("mine-0", true);

    expect(result.success).toBe(false);
    expect(pinnedIds(decks)).toEqual([]);
  });
});

describe("pinnedFirst", () => {
  type D = { name: string; is_pinned?: boolean };
  const byName = (a: D, b: D) => a.name.localeCompare(b.name);

  it("puts pinned decks first and keeps the chosen sort inside each group", () => {
    const decks: D[] = [
      { name: "Delta", is_pinned: false },
      { name: "Charlie", is_pinned: true },
      { name: "Alpha", is_pinned: false },
      { name: "Bravo", is_pinned: true },
      { name: "Echo" },
    ];

    const sorted = [...decks].sort(pinnedFirst(byName)).map((d) => d.name);

    expect(sorted).toEqual(["Bravo", "Charlie", "Alpha", "Delta", "Echo"]);
  });
});
