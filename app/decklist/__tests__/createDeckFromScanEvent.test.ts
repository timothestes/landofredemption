import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: any) => fn }));

// Every deck insert is recorded, then fails: the tests only need to know whether a save was attempted, and with what.
const deckInserts: any[] = [];
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  from: (table: string) => ({
    insert: (row: any) => {
      if (table === "decks") deckInserts.push(row);
      return { select: () => ({ single: async () => ({ data: null, error: { message: "stop here" } }) }) };
    },
  }),
};
// actions.ts imports the server client by relative path; both specifiers resolve to the same module.
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn(async () => client) }));
vi.mock("@/lib/pricing/supabase-admin", () => ({ getSupabaseAdmin: vi.fn(() => client) }));

const mockCheckDeck = vi.fn();
vi.mock("@/utils/deckcheck", () => ({ checkDeck: (...args: any[]) => mockCheckDeck(...args) }));

import { CARDS } from "@/lib/cards/lookup";
import { createDeckFromScanAction } from "../actions";

const card = CARDS[0];
const input = {
  rows: [{ card_name: card.name, card_set: card.set, card_img_file: card.imgFile, quantity: 2, zone: "reserve" as const }],
  outcomesByScanId: {},
  name: "Deck from a photo",
  format: "Type 1" as const,
};
const verdict = (valid: boolean, rules: string[] = []) => ({
  valid,
  format: "x",
  issues: rules.map((rule) => ({ type: "error", rule, message: rule })),
  stats: {},
});

beforeEach(() => {
  deckInserts.length = 0;
  mockCheckDeck.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createDeckFromScanAction with an event format", () => {
  it("checks the rows against the event's format, not the deck's own", async () => {
    mockCheckDeck.mockResolvedValue(verdict(false, ["t1-deck-size"]));
    await createDeckFromScanAction({ ...input, eventFormat: "T2" });
    const [main, reserve, format] = mockCheckDeck.mock.calls[0];
    expect(format).toBe("T2");
    expect(main).toEqual([]);
    expect(reserve).toEqual([{ name: card.name, set: card.set, quantity: 2, imgFile: card.imgFile }]);
  });

  it("returns the issues and saves nothing when the deck is not legal there", async () => {
    mockCheckDeck.mockResolvedValue(verdict(false, ["t1-deck-size"]));
    const res = await createDeckFromScanAction({ ...input, eventFormat: "Limited" });
    expect(res).toMatchObject({ ok: false, code: "illegal", issues: [{ rule: "t1-deck-size" }] });
    expect(deckInserts).toEqual([]);
  });

  it("holds a deck with an unknown card to the same bar as the join, even when the check calls it valid", async () => {
    mockCheckDeck.mockResolvedValue(verdict(true, ["card-not-found"]));
    const res = await createDeckFromScanAction({ ...input, eventFormat: "Limited" });
    expect(res).toMatchObject({ ok: false, code: "illegal" });
    expect(deckInserts).toEqual([]);
  });

  it("saves a legal deck under the event's format", async () => {
    mockCheckDeck.mockResolvedValue(verdict(true));
    await createDeckFromScanAction({ ...input, eventFormat: "Paragon" });
    expect(deckInserts).toHaveLength(1);
    expect(deckInserts[0]).toMatchObject({ user_id: "u1", format: "Paragon" });
  });

  it("refuses a format that is not one of the site's, before checking or saving", async () => {
    const res = await createDeckFromScanAction({ ...input, eventFormat: "Other" as any });
    expect(res).toEqual({ ok: false, code: "bad_request" });
    expect(mockCheckDeck).not.toHaveBeenCalled();
    expect(deckInserts).toEqual([]);
  });

  it("without an event format, saves under the deck's own format with no check first", async () => {
    await createDeckFromScanAction(input);
    expect(mockCheckDeck).not.toHaveBeenCalled();
    expect(deckInserts[0]).toMatchObject({ format: "Type 1" });
  });
});
