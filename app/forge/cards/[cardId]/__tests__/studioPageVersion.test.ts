import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("../StudioEditor", () => ({ default: () => null }));
vi.mock("../ReviewPanel", () => ({ default: () => null }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));
vi.mock("@/app/forge/lib/cards", () => ({ getCard: vi.fn() }));
vi.mock("@/app/forge/lib/artCandidates", () => ({ listArtCandidates: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/sets", () => ({
  getSet: vi.fn(async () => ({ name: "Invented Set" })), listSets: vi.fn(async () => []), listSetCards: vi.fn(async () => []),
}));
vi.mock("@/app/forge/lib/proposals", () => ({ getOpenProposalDiffs: vi.fn(async () => []), listProposals: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/comments", () => ({ listComments: vi.fn(async () => []) }));
vi.mock("@/app/forge/lib/versions", () => ({
  listVersions: vi.fn(), listCardEvents: vi.fn(async () => []),
  artChangedSince: vi.fn(), getShelvedRecord: vi.fn(async () => ({ status: "draft", versionId: null })),
}));

import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
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
