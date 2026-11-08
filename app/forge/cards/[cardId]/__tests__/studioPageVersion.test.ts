import { describe, it, expect, vi } from "vitest";

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
vi.mock("@/app/forge/lib/versions", () => ({ listVersions: vi.fn(), listCardEvents: vi.fn(async () => []) }));

import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listVersions } from "@/app/forge/lib/versions";
import StudioPage from "../page";

const SECRET_KEY = "forge-art/invented-secret-blob-key.jpg";

function ctxWith(imagesRow: unknown) {
  const select = vi.fn(() => chain);
  const chain: any = {
    select, eq: vi.fn(() => chain), single: vi.fn(async () => ({ data: { display_name: "Elder" } })),
    maybeSingle: vi.fn(async () => ({ data: imagesRow })),
  };
  return { role: "elder", user: { id: "u1" }, supabase: { from: vi.fn(() => chain) }, select };
}

const released = { id: "v3", versionNumber: 3, status: "published", data: { name: "Invented Shield" } };

async function versionProp(card: Record<string, unknown>, versions: unknown[], imagesRow: unknown) {
  const ctx = ctxWith(imagesRow);
  (requireForge as any).mockResolvedValue(ctx);
  (getCard as any).mockResolvedValue({ id: "c1", setId: "s1", snapshot: {}, creatorId: "u1", createdAt: "2026-01-01", ...card });
  (listVersions as any).mockResolvedValue(versions);
  const el: any = await StudioPage({ params: Promise.resolve({ cardId: "c1" }) });
  return { props: el.props, ctx };
}

const working = { working_art_key: SECRET_KEY, working_art_is_placeholder: false, working_finished_key: null };
const frozen = { art_key: SECRET_KEY, art_is_placeholder: false, finished_key: null };

describe("studio page version prop", () => {
  it("reports images unchanged when the release froze the working keys", async () => {
    const { props } = await versionProp({ publishedVersionId: "v3" }, [released], { ...working, approved: null, published: frozen });
    expect(props.version).toEqual({ number: 3, releasedData: { name: "Invented Shield" }, imagesMoved: false });
  });

  it("reports images moved when the art changed after the release", async () => {
    const { props } = await versionProp(
      { publishedVersionId: "v3" }, [released],
      { ...working, approved: null, published: { ...frozen, art_key: "forge-art/older.jpg" } },
    );
    expect(props.version.imagesMoved).toBe(true);
  });

  it("compares against the approved version when there is one", async () => {
    const { props } = await versionProp(
      { publishedVersionId: "v3", approvedVersionId: "v3" }, [released],
      { ...working, approved: frozen, published: { ...frozen, art_key: "forge-art/older.jpg" } },
    );
    expect(props.version.imagesMoved).toBe(false);
  });

  it("does not look at images when nothing is released", async () => {
    const { props, ctx } = await versionProp({ publishedVersionId: null, approvedVersionId: null }, [{ ...released, status: "draft" }], null);
    expect(props.version).toEqual({ number: 3, releasedData: null, imagesMoved: false });
    expect(ctx.select.mock.calls.flat().join(",")).not.toMatch(/working_art_key/);
  });

  it("keeps blob keys out of what the client receives", async () => {
    const { props } = await versionProp({ publishedVersionId: "v3" }, [released], { ...working, approved: null, published: frozen });
    expect(JSON.stringify(props.version)).not.toContain(SECRET_KEY);
  });
});
