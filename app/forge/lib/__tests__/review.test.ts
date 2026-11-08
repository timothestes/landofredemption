import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { getSetReviewQueue } from "../review";

function ctx(rows: Record<string, any[]>) {
  return {
    user: { id: "me" },
    supabase: {
      from: (table: string) => {
        const chain: any = { select: () => chain, eq: () => chain, in: () => chain, not: () => chain };
        chain.then = (done: any) => done({ data: rows[table] ?? [] });
        return chain;
      },
    },
  };
}

const ROWS = {
  forge_cards: [
    { id: "c1", title: "Invented Shield", status: "playtesting" },
    { id: "c2", title: "Invented Relic", status: "draft" },
    { id: "c3", title: "Nothing open", status: "draft" },
  ],
  card_proposals: [{
    id: "p1", card_id: "c1", created_at: "2026-09-01T00:00:00Z", created_by: "u2",
    summary: "Draw more", base_version_id: "v3", proposed_snapshot: { rawText: "Secret new text." },
  }],
  card_comments: [
    { id: "m1", card_id: "c2", created_at: "2026-09-02T00:00:00Z", created_by: "me", field: "toughness", suggested_value: 2 },
  ],
  card_versions: [{ id: "v3", version_number: 3, data: { rawText: "Secret old text." } }],
  playtest_members: [{ user_id: "u2", display_name: "Rhoda" }],
};

beforeEach(() => vi.clearAllMocks());

describe("getSetReviewQueue", () => {
  it("keeps only cards with something open", async () => {
    (requireForge as any).mockResolvedValue(ctx(ROWS));
    const { cards } = await getSetReviewQueue("s1");
    expect(cards.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("says who, against what, and what changed", async () => {
    (requireForge as any).mockResolvedValue(ctx(ROWS));
    const { items } = await getSetReviewQueue("s1");
    expect(items.find((i) => i.id === "p1")).toMatchObject({
      cardId: "c1", kind: "proposal", who: "Rhoda", summary: "Draw more", baseVersion: 3, changed: "Changed Card text.",
    });
  });

  it("calls your own item yours", async () => {
    (requireForge as any).mockResolvedValue(ctx(ROWS));
    const { items } = await getSetReviewQueue("s1");
    expect(items.find((i) => i.id === "m1")).toMatchObject({ who: "You", changed: "Suggested Toughness: 2" });
  });

  // The row needs the labels, not the text: a page payload stays small on a big set.
  it("sends no snapshots to the page", async () => {
    (requireForge as any).mockResolvedValue(ctx(ROWS));
    expect(JSON.stringify(await getSetReviewQueue("s1"))).not.toContain("Secret");
  });

  it("returns nothing for a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await getSetReviewQueue("s1")).toEqual({ cards: [], items: [] });
  });
});
