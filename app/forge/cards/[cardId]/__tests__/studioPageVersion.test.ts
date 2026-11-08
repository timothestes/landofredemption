import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("../StudioEditor", () => ({ default: () => null }));
vi.mock("../ReviewPanel", () => ({ default: () => null }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));
vi.mock("@/app/forge/lib/cards", () => ({ getCard: vi.fn() }));
vi.mock("@/app/forge/lib/artCandidates", () => ({ listArtCandidates: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/sets", () => ({
  getSet: vi.fn(async () => ({ name: "Invented Set" })), listWritableSets: vi.fn(async () => []), listSetCards: vi.fn(async () => []),
  canDesignSet: vi.fn(async () => true),
}));
vi.mock("@/app/forge/lib/proposals", () => ({ getOpenProposalDiffs: vi.fn(async () => []), listProposals: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/comments", () => ({ listComments: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/versions", () => ({
  listVersions: vi.fn(), listCardEvents: vi.fn(async () => []),
  artChangedSince: vi.fn(), getShelvedRecord: vi.fn(async () => ({ status: "draft", versionId: null })),
}));

import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { canDesignSet, listWritableSets } from "@/app/forge/lib/sets";
import { artChangedSince, listVersions } from "@/app/forge/lib/versions";
import StudioPage from "../page";

function ctx() {
  const chain: any = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { display_name: "Elder" } })),
    maybeSingle: vi.fn(async () => ({ data: null })),
  };
  return { role: "elder", user: { id: "u1" }, supabase: { from: vi.fn(() => chain) } };
}

const released = { id: "v3", versionNumber: 3, status: "published", data: { name: "Invented Shield" } };
const older = { id: "v2", versionNumber: 2, status: "approved", data: { name: "Older Shield" } };

async function versionProp(card: Record<string, unknown>, versions: unknown[]) {
  (requireForge as any).mockResolvedValue(ctx());
  (getCard as any).mockResolvedValue({ id: "c1", setId: "s1", snapshot: {}, creatorId: "u1", createdAt: "2026-01-01", ...card });
  (listVersions as any).mockResolvedValue(versions);
  const el: any = await StudioPage({ params: Promise.resolve({ cardId: "c1" }) });
  return el.props.version;
}

describe("studio page version prop", () => {
  beforeEach(() => vi.mocked(artChangedSince).mockReset());

  it("reports images unchanged when the release matches the draft's images", async () => {
    vi.mocked(artChangedSince).mockResolvedValue(false);
    expect(await versionProp({ publishedVersionId: "v3", approvedVersionId: null }, [released]))
      .toEqual({ number: 3, releasedData: { name: "Invented Shield" }, imagesMoved: false });
  });

  it("reports images moved when the art changed after the release", async () => {
    vi.mocked(artChangedSince).mockResolvedValue(true);
    const version = await versionProp({ publishedVersionId: "v3", approvedVersionId: null }, [released]);
    expect(version.imagesMoved).toBe(true);
  });

  it("asks once when the released version is the newest release", async () => {
    vi.mocked(artChangedSince).mockResolvedValue(false);
    await versionProp({ publishedVersionId: "v3", approvedVersionId: "v3" }, [released]);
    expect(artChangedSince).toHaveBeenCalledTimes(1);
    expect(artChangedSince).toHaveBeenCalledWith("c1", "v3");
  });

  it("compares against the approved version when it isn't the newest release", async () => {
    vi.mocked(artChangedSince).mockImplementation(async (_card, versionId) => versionId === "v3");
    const version = await versionProp({ publishedVersionId: "v3", approvedVersionId: "v2" }, [released, older]);
    expect(version).toEqual({ number: 2, releasedData: { name: "Older Shield" }, imagesMoved: false });
    expect(artChangedSince).toHaveBeenCalledWith("c1", "v2");
  });

  it("does not look at images when nothing is released", async () => {
    const version = await versionProp({ publishedVersionId: null, approvedVersionId: null }, [{ ...released, status: "draft" }]);
    expect(version).toEqual({ number: 3, releasedData: null, imagesMoved: false });
    expect(artChangedSince).not.toHaveBeenCalled();
  });
});

describe("studio page write access", () => {
  async function page(card: Record<string, unknown>, design: boolean) {
    (requireForge as any).mockResolvedValue(ctx());
    (getCard as any).mockResolvedValue({ id: "c1", setId: "s1", snapshot: {}, creatorId: "u1", createdAt: "2026-01-01", ownerId: "u2", status: "draft", ...card });
    (listVersions as any).mockResolvedValue([]);
    vi.mocked(canDesignSet).mockResolvedValue(design);
    return (await StudioPage({ params: Promise.resolve({ cardId: "c1" }) })) as any;
  }

  it("lets a designer of the set write and review", async () => {
    const el = await page({}, true);
    expect(el.props.canEdit).toBe(true);
    expect(el.props.review.props.canReview).toBe(true);
  });

  it("keeps someone who can only read the set out of both", async () => {
    const el = await page({}, false);
    expect(el.props.canEdit).toBe(false);
    expect(el.props.review.props.canReview).toBe(false);
  });

  it("lets the card's owner edit, but not review, when they can't design the set", async () => {
    const el = await page({ ownerId: "u1" }, false);
    expect(el.props.canEdit).toBe(true);
    expect(el.props.review.props.canReview).toBe(false);
  });

  it("makes a promoted card read-only, even for a designer", async () => {
    expect((await page({ status: "promoted" }, true)).props.canEdit).toBe(false);
  });

  it("offers an idea's share picker only the sets it can go into", async () => {
    vi.mocked(listWritableSets).mockResolvedValue([{ id: "s9" }] as any);
    const el = await page({ setId: null, ownerId: "u1" }, false);
    expect(el.props.sets).toEqual([{ id: "s9" }]);
    expect(el.props.canEdit).toBe(true);
  });
});
