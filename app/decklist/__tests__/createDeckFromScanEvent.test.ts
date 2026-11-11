import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: any) => fn }));

const mockFrom = vi.fn((_table: string) => ({ select: async () => ({ data: [], error: null }) }));
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    from: mockFrom,
    rpc: mockFrom,
  })),
}));
vi.mock("../../../utils/supabase/server", async () => await import("@/utils/supabase/server"));
vi.mock("@/lib/pricing/supabase-admin", () => ({ getSupabaseAdmin: vi.fn(() => ({ from: mockFrom })) }));

import { CARDS } from "@/lib/cards/lookup";
import { createDeckFromScanAction } from "../actions";

// checkDeck reads the duplicate-card tables through the same client; only a deck write counts as a save.
const deckWrites = () => mockFrom.mock.calls.filter(([t]) => t === "decks" || t === "deck_cards" || t === "replace_deck_cards");
beforeEach(() => mockFrom.mockClear());

describe("createDeckFromScanAction with an event format", () => {
  const card = CARDS[0];
  const input = {
    rows: [{ card_name: card.name, card_set: card.set, card_img_file: card.imgFile, quantity: 1, zone: "main" as const }],
    outcomesByScanId: {},
    name: "Deck from a photo",
    format: "Type 1" as const,
  };

  it("returns the issues and saves nothing when the deck is not legal for the event", async () => {
    const res = await createDeckFromScanAction({ ...input, eventFormat: "Limited" });
    expect(res.ok).toBe(false);
    if (res.ok === false && res.code === "illegal") expect(res.issues.some((i) => i.type === "error")).toBe(true);
    else throw new Error(`expected illegal, got ${JSON.stringify(res)}`);
    expect(deckWrites()).toEqual([]);
  });

  it("refuses a format that is not one of the site's", async () => {
    const res = await createDeckFromScanAction({ ...input, eventFormat: "Other" as any });
    expect(res).toEqual({ ok: false, code: "bad_request" });
    expect(deckWrites()).toEqual([]);
  });
});
