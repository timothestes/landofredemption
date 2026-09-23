import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(),
  uploadForgeArt: vi.fn(),
  uploadForgeFinished: vi.fn(),
  readForgeUpload: vi.fn(),
  deleteForgeArt: vi.fn(),
}));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeFinished, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
import { saveCard, getCard, listForgeCards, uploadArt, uploadFinished } from "../cards";

function ctx(rpcImpl?: any, queryRows?: any[]) {
  const order = vi.fn(async () => ({ data: queryRows ?? [], error: null }));
  const eqList = vi.fn(() => ({ order }));
  const maybeSingle = vi.fn(async () => ({ data: (queryRows ?? [])[0] ?? null, error: null }));
  const eqOne = vi.fn(() => ({ maybeSingle }));
  const isFn = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq: vi.fn(() => ({ order, maybeSingle, is: isFn })) }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(rpcImpl ?? (async () => ({ data: "2026-06-23T00:00:00Z", error: null }))),
      from: vi.fn(() => ({ select })),
    },
    isFn,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("saveCard", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await saveCard("c1", { name: "x" })).ok).toBe(false);
  });
  it("calls forge_save_card with the card id + snapshot and returns updatedAt", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await saveCard("c1", { name: "Goliath", cardType: ["EvilCharacter"] });
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_save_card", { p_card_id: "c1", p_snapshot: { name: "Goliath", cardType: ["EvilCharacter"] } },
    ]);
    expect(r.updatedAt).toBe("2026-06-23T00:00:00Z");
  });
});

describe("getCard / listForgeCards", () => {
  it("returns null when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await getCard("c1")).toBeNull();
    expect(await listForgeCards()).toEqual([]);
  });
  it("maps a row into ForgeCardFull", async () => {
    const row = { id: "c1", title: "Goliath", working_snapshot: { name: "Goliath" }, working_art_key: "k", working_art_is_placeholder: false, status: "private_idea", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    const got = await getCard("c1");
    expect(got).toMatchObject({ id: "c1", title: "Goliath", snapshot: { name: "Goliath" }, hasArt: true, status: "private_idea", setId: null });
  });
  it("exposes current owner, original creator, and when (owner_id / creator_id / created_at)", async () => {
    const row = { id: "c1", title: "Goliath", working_snapshot: {}, status: "draft", updated_at: "t", set_id: "s1", owner_id: "u9", creator_id: "u1", created_at: "2026-07-01T00:00:00Z" };
    const c = ctx(undefined, [row]);
    (requireForge as any).mockResolvedValue(c);
    const got = await getCard("c1");
    // owner_id and creator_id diverge once a card is pulled into someone else's
    // Ideas (forge_send_card_to_private reassigns owner_id, never creator_id) —
    // regression check for the set-import "wrong idea land" bug.
    expect(got).toMatchObject({ ownerId: "u9", creatorId: "u1", createdAt: "2026-07-01T00:00:00Z" });
    const cols = (c.supabase.from as any).mock.results[0].value.select.mock.calls[0][0] as string;
    expect(cols).toContain("owner_id");
    expect(cols).toContain("creator_id");
    expect(cols).toContain("created_at");
  });
  it("listForgeCards selects only private ideas (set_id IS NULL)", async () => {
    const c = ctx(undefined, []);
    (requireForge as any).mockResolvedValue(c);
    await listForgeCards();
    expect(c.isFn).toHaveBeenCalledWith("set_id", null);
  });
});

describe("uploadArt", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadArt("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(false);
  });
  it("rejects a pathname outside forge-art-raw/", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await uploadArt("c1", "forge-art/someone-elses-key");
    expect(r).toEqual({ ok: false, error: "Invalid upload" });
    expect(readForgeUpload).not.toHaveBeenCalled();
  });
  it("uploads and calls forge_set_working_art with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockResolvedValue("forge-art/abc");
    const r = await uploadArt("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(true);
    expect(validateArtFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png" }),
    );
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_art", { p_card_id: "c1", p_key: "forge-art/abc", p_original_key: "forge-art/abc" },
    ]);
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
  });
  it("returns the validation error and cleans up the raw upload when the file is invalid", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue("File too large. Maximum 50MB.");
    const r = await uploadArt("c1", "forge-art-raw/x.png");
    expect(r).toEqual({ ok: false, error: "File too large. Maximum 50MB." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});

describe("uploadFinished", () => {
  it("rejects when caller is not an elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(false);
  });
  it("rejects a pathname outside forge-art-raw/", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await uploadFinished("c1", "forge-art/someone-elses-key");
    expect(r).toEqual({ ok: false, error: "Invalid upload" });
    expect(readForgeUpload).not.toHaveBeenCalled();
  });
  it("uploads and calls forge_set_working_finished with the returned key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockResolvedValue("forge-finished/abc");
    const r = await uploadFinished("c1", "forge-art-raw/x.png");
    expect(r.ok).toBe(true);
    expect(validateArtFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png" }),
    );
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual([
      "forge_set_working_finished", { p_card_id: "c1", p_key: "forge-finished/abc" },
    ]);
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
  });
  it("returns the validation error and cleans up the raw upload when the file is invalid", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue("File too large. Maximum 50MB.");
    const r = await uploadFinished("c1", "forge-art-raw/x.png");
    expect(r).toEqual({ ok: false, error: "File too large. Maximum 50MB." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/x.png");
    expect(uploadForgeFinished).not.toHaveBeenCalled();
  });
  it("returns an error when the raw upload can't be read back", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue(null);
    const r = await uploadFinished("c1", "forge-art-raw/gone.png");
    expect(r).toEqual({ ok: false, error: "Could not read uploaded image" });
    expect(uploadForgeFinished).not.toHaveBeenCalled();
  });
});

describe("getCard maps hasFinished", () => {
  it("hasFinished true when working_finished_key present", async () => {
    const row = { id: "c1", title: "T", working_snapshot: {}, working_art_key: null, working_art_is_placeholder: false, working_finished_key: "forge-finished/x", status: "draft", updated_at: "t", set_id: null, published_version_id: null, approved_version_id: null };
    (requireForge as any).mockResolvedValue(ctx(undefined, [row]));
    expect((await getCard("c1"))?.hasFinished).toBe(true);
  });
});

describe("upload decode failures", () => {
  it("uploadArt returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeArt as any).mockRejectedValue(new Error("unsupported image format"));
    const r = await uploadArt("c1", "forge-art-raw/a.png");
    expect(r).toEqual({ ok: false, error: "Could not read image file." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/a.png");
  });

  it("uploadFinished returns a clear error when the image cannot be decoded", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    (readForgeUpload as any).mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: "image/png" });
    (validateArtFile as any).mockReturnValue(null);
    (uploadForgeFinished as any).mockRejectedValue(new Error("unsupported image format"));
    const r = await uploadFinished("c1", "forge-art-raw/c.png");
    expect(r).toEqual({ ok: false, error: "Could not read image file." });
    expect(deleteForgeArt).toHaveBeenCalledWith("forge-art-raw/c.png");
  });
});
