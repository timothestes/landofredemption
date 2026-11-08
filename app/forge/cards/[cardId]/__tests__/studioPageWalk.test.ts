import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("../StudioEditor", () => ({ default: () => null }));
vi.mock("../ReviewPanel", () => ({ default: () => null }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));
vi.mock("@/app/forge/lib/cards", () => ({ getCard: vi.fn() }));
vi.mock("@/app/forge/lib/artCandidates", () => ({ listArtCandidates: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/sets", () => ({
  getSet: vi.fn(async () => ({ name: "Invented Set" })), listWritableSets: vi.fn(async () => []), listSetSiblings: vi.fn(),
  canDesignSet: vi.fn(async () => true),
}));
vi.mock("@/app/forge/lib/proposals", () => ({ getOpenProposalDiffs: vi.fn(async () => []), listProposals: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/comments", () => ({ listComments: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/versions", () => ({
  listVersions: vi.fn(async () => []), listCardEvents: vi.fn(async () => []), listSetActivity: vi.fn(),
  artChangedSince: vi.fn(async () => false), getShelvedRecord: vi.fn(async () => ({ status: "draft", versionId: null })),
}));

import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listSetSiblings } from "@/app/forge/lib/sets";
import { listSetActivity } from "@/app/forge/lib/versions";
import StudioPage from "../page";

function ctx() {
  const chain: any = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { display_name: "Elder" } })),
    maybeSingle: vi.fn(async () => ({ data: null })),
  };
  return { role: "elder", user: { id: "u1" }, supabase: { from: vi.fn(() => chain) } };
}

const sibling = (id: string, cardType: string[], title = id) => ({ id, title, status: "draft", setId: "s1", snapshot: { cardType } });
// Same section, so the default sort falls through to the name.
const set = [sibling("a", ["Hero"]), sibling("b", ["GE"]), sibling("c", ["Hero"]), sibling("d", ["GE"]), sibling("e", ["Hero"])];

async function props(cardId: string, searchParams: Record<string, string>) {
  (requireForge as any).mockResolvedValue(ctx());
  (getCard as any).mockResolvedValue({ id: cardId, setId: "s1", snapshot: {}, creatorId: "u1", createdAt: "2026-01-01" });
  (listSetSiblings as any).mockResolvedValue(set);
  const el: any = await StudioPage({ params: Promise.resolve({ cardId }), searchParams: Promise.resolve(searchParams) });
  return el.props;
}

describe("studio page arrows", () => {
  beforeEach(() => vi.mocked(listSetActivity).mockReset());

  it("walks the whole set with no filter, and asks for no version data", async () => {
    const p = await props("c", {});
    expect(p.position).toEqual({ index: expect.any(Number), total: 5, filtered: false });
    expect(p.walkQuery).toBe("");
    expect(p.gridHref).toBe("/forge/sets/s1/cards#card-c");
    expect(listSetActivity).not.toHaveBeenCalled();
  });

  it("walks only the filtered cards and hands the filter to the arrows and the way back", async () => {
    const p = await props("c", { brigade: "Blue", type: "Hero" });
    expect(p.walkQuery).toBe("?type=Hero&brigade=Blue");
    expect(p.gridHref).toBe("/forge/sets/s1/cards?type=Hero&brigade=Blue#card-c");
    // No card here is Blue, so this one has fallen out of the filter.
    expect(p.position).toEqual({ index: 0, total: 0, filtered: true });
    const q = await props("c", { type: "Hero" });
    expect(q.position.total).toBe(3);
    expect(q.position.filtered).toBe(true);
    expect([q.prevId, q.nextId].filter(Boolean).every((id: string) => ["a", "e"].includes(id))).toBe(true);
    expect(listSetActivity).not.toHaveBeenCalled();
  });

  it("reads version dates only for a date filter, and walks newest first", async () => {
    vi.mocked(listSetActivity).mockResolvedValue({
      a: { versionNumber: 1, releasedAt: "2026-10-05T00:00:00Z", status: "published" },
      c: { versionNumber: 1, releasedAt: "2026-10-20T00:00:00Z", status: "published" },
      e: { versionNumber: 1, releasedAt: "2026-09-01T00:00:00Z", status: "published" },
    });
    const p = await props("a", { since: "2026-10-01" });
    expect(listSetActivity).toHaveBeenCalledTimes(1);
    expect(p.prevId).toBe("c");
    expect(p.nextId).toBe(null);
    expect(p.position).toEqual({ index: 2, total: 2, filtered: true });
  });
});
