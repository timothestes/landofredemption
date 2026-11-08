import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { listVersions, listCardEvents, listSetActivity, artChangedSince, getShelvedRecord } from "../versions";

// Chainable query stub: every method returns the builder; awaiting it yields
// the row payload for its table (thenable, like the supabase-js builder).
function table(rows: any[]) {
  const b: any = {};
  for (const m of ["select", "eq", "in", "is", "order"]) b[m] = vi.fn(() => b);
  b.then = (res: any) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}
function ctxWith(tables: Record<string, any[]>) {
  return {
    role: "elder", user: { id: "u1" },
    supabase: { from: vi.fn((name: string) => table(tables[name] ?? [])) },
  };
}
beforeEach(() => vi.clearAllMocks());

describe("listVersions", () => {
  it("returns [] for a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listVersions("c1")).toEqual([]);
  });
  it("maps rows and resolves author names", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      card_versions: [{
        id: "v2", card_id: "c1", version_number: 2, status: "published",
        data: { name: "Goliath" }, note: "buffed", created_by: "u9",
        created_at: "2026-07-02T00:00:00Z",
      }],
      playtest_members: [{ user_id: "u9", display_name: "Tim" }],
    }));
    const rows = await listVersions("c1");
    expect(rows).toEqual([{
      id: "v2", versionNumber: 2, status: "published", data: { name: "Goliath" },
      note: "buffed", createdBy: "u9", createdAt: "2026-07-02T00:00:00Z", authorName: "Tim",
    }]);
  });
  it("maps draft iteration rows intact", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      card_versions: [{
        id: "v1", card_id: "c1", version_number: 1, status: "draft",
        data: { name: "WIP" }, note: null, created_by: "u9",
        created_at: "2026-07-01T00:00:00Z",
      }],
      playtest_members: [{ user_id: "u9", display_name: "Tim" }],
    }));
    const rows = await listVersions("c1");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].data).toEqual({ name: "WIP" });
  });
});

describe("listCardEvents", () => {
  it("maps audit rows with actor names", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      forge_audit: [{ id: 7, actor: "u9", action: "card_approved", target: "c1", at: "2026-07-03T00:00:00Z" }],
      playtest_members: [{ user_id: "u9", display_name: "Tim" }],
    }));
    expect(await listCardEvents("c1")).toEqual([
      { id: 7, action: "card_approved", actor: "u9", actorName: "Tim", at: "2026-07-03T00:00:00Z" },
    ]);
  });
});

describe("listSetActivity", () => {
  it("returns {} for no ids without querying", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({}));
    expect(await listSetActivity([])).toEqual({});
  });
  it("keeps only the latest version per card, draft iterations included", async () => {
    (requireForge as any).mockResolvedValue(ctxWith({
      card_versions: [
        { card_id: "c1", version_number: 3, status: "draft", created_at: "2026-07-05T00:00:00Z" },
        { card_id: "c1", version_number: 2, status: "published", created_at: "2026-07-01T00:00:00Z" },
        { card_id: "c2", version_number: 1, status: "published", created_at: "2026-06-20T00:00:00Z" },
      ],
    }));
    expect(await listSetActivity(["c1", "c2"])).toEqual({
      c1: { versionNumber: 3, releasedAt: "2026-07-05T00:00:00Z", status: "draft" },
      c2: { versionNumber: 1, releasedAt: "2026-06-20T00:00:00Z", status: "published" },
    });
  });
});

describe("artChangedSince", () => {
  const ART = { working_art_key: "a", working_art_is_placeholder: false, working_art_original_key: "o", working_finished_key: "f" };
  const VERSION = { art_key: "a", art_is_placeholder: false, art_original_key: "o", finished_key: "f" };
  // Each table's single row, read by .maybeSingle().
  function ctx(card: any, version: any) {
    const rows: Record<string, any> = { forge_cards: card, card_versions: version };
    return {
      role: "elder", user: { id: "u1" },
      supabase: {
        from: (name: string) => {
          const b: any = {};
          b.select = () => b;
          b.eq = () => b;
          b.maybeSingle = async () => ({ data: rows[name], error: null });
          return b;
        },
      },
    };
  }

  it("is false when every art field matches", async () => {
    (requireForge as any).mockResolvedValue(ctx(ART, VERSION));
    expect(await artChangedSince("c1", "v1")).toBe(false);
  });

  it("is false when neither has art", async () => {
    (requireForge as any).mockResolvedValue(ctx(
      { working_art_key: null, working_art_is_placeholder: false, working_art_original_key: null, working_finished_key: null },
      { art_key: null, art_is_placeholder: false, art_original_key: null, finished_key: null },
    ));
    expect(await artChangedSince("c1", "v1")).toBe(false);
  });

  it("is true when any art field differs, placeholder flag included", async () => {
    for (const patch of [{ working_art_key: "b" }, { working_art_key: null }, { working_art_original_key: "p" }, { working_finished_key: "g" }, { working_art_is_placeholder: true }]) {
      (requireForge as any).mockResolvedValue(ctx({ ...ART, ...patch }, VERSION));
      expect(await artChangedSince("c1", "v1")).toBe(true);
    }
  });

  it("returns false for a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await artChangedSince("c1", "v1")).toBe(false);
  });
});

describe("getShelvedRecord", () => {
  function ctx(row: any, error: any = null) {
    const b: any = {};
    b.select = () => b;
    b.eq = () => b;
    b.maybeSingle = async () => ({ data: row, error });
    return { role: "elder", user: { id: "u1" }, supabase: { from: () => b } };
  }

  it("reads an In playtest record", async () => {
    (requireForge as any).mockResolvedValue(ctx({ shelved_status: "playtesting", shelved_published_version_id: "v1", shelved_approved_version_id: null }));
    expect(await getShelvedRecord("c1")).toEqual({ status: "playtesting", versionId: "v1" });
  });

  it("prefers the approved version on a Final record", async () => {
    (requireForge as any).mockResolvedValue(ctx({ shelved_status: "approved", shelved_published_version_id: "v1", shelved_approved_version_id: "v1" }));
    expect(await getShelvedRecord("c1")).toEqual({ status: "approved", versionId: "v1" });
  });

  it("falls back to Draft with no record, as forge_unarchive_card does", async () => {
    (requireForge as any).mockResolvedValue(ctx({ shelved_status: null, shelved_published_version_id: null, shelved_approved_version_id: null }));
    expect(await getShelvedRecord("c1")).toEqual({ status: "draft", versionId: null });
  });

  it("falls back to Draft when the read fails", async () => {
    (requireForge as any).mockResolvedValue(ctx(null, { message: "column does not exist" }));
    expect(await getShelvedRecord("c1")).toEqual({ status: "draft", versionId: null });
    (requireForge as any).mockResolvedValue(null);
    expect(await getShelvedRecord("c1")).toEqual({ status: "draft", versionId: null });
  });
});
