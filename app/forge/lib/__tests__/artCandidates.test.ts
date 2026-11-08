import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(() => null),
  uploadForgeArt: vi.fn(),
  uploadForgeArtRaw: vi.fn(),
  readForgeArt: vi.fn(),
  readForgeUpload: vi.fn(),
  deleteForgeArt: vi.fn(),
}));
vi.mock("@/app/forge/lib/imageCrop", () => ({
  clampCropRect: vi.fn((r) => r),
  cropCardImage: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeArtRaw, readForgeArt, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
import { clampCropRect, cropCardImage } from "@/app/forge/lib/imageCrop";
import { activateCandidate, addArtCandidate, applyCrop, deleteArtCandidate, listArtCandidates, setArtCandidateSource } from "../artCandidates";

/** Supabase mock: from() returns a self-chaining builder resolving to `rows`
 * keyed by table name; rpc() resolves from `rpcResults` keyed by fn name. */
function mockCtx(opts: {
  rows?: Record<string, unknown>;
  rpcResults?: Record<string, { error: null | { message: string } }>;
}) {
  const from = vi.fn((table: string) => {
    const result = { data: opts.rows?.[table] ?? null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) builder[m] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
  const rpc = vi.fn((fn: string) =>
    Promise.resolve(opts.rpcResults?.[fn] ?? { data: null, error: null })
  );
  const ctx = { supabase: { from, rpc }, user: { id: "u1" }, role: "elder" };
  (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return { from, rpc };
}

const pathname = "forge-art-raw/a.png";

describe("addArtCandidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readForgeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from([1]), contentType: "image/png" });
    // vi.clearAllMocks() clears call history but NOT a prior mockReturnValue — the
    // validation-failure test below overrides this to a string, so restore the default
    // "valid" passthrough here or that override leaks into later tests.
    (validateArtFile as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("uploads, registers the candidate, and auto-activates on an art-less card", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: null } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(true);
    expect(validateArtFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png" }),
    );
    expect(rpc).toHaveBeenCalledWith("forge_add_art_candidate", { p_card_id: "card1", p_key: "forge-art/k1" });
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", { p_card_id: "card1", p_key: "forge-art/k1", p_original_key: "forge-art/k1" });
    expect(deleteForgeArt).toHaveBeenCalledWith(pathname);
  });

  it("returns the validation error and cleans up the raw upload when the file is invalid", async () => {
    mockCtx({});
    (validateArtFile as ReturnType<typeof vi.fn>).mockReturnValue("File too large. Maximum 50MB.");
    const r = await addArtCandidate("card1", pathname);
    expect(r).toEqual({ ok: false, error: "File too large. Maximum 50MB." });
    expect(deleteForgeArt).toHaveBeenCalledWith(pathname);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });

  it("rejects a pathname outside forge-art-raw/", async () => {
    mockCtx({});
    const r = await addArtCandidate("card1", "forge-art/someone-elses-key");
    expect(r).toEqual({ ok: false, error: "Invalid upload" });
    expect(readForgeUpload).not.toHaveBeenCalled();
  });

  it("surfaces an auto-activate failure even though the candidate row was saved", async () => {
    mockCtx({
      rows: { forge_cards: { working_art_key: null } },
      rpcResults: { forge_set_working_art: { error: { message: "boom" } } },
    });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k1");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Image saved but could not be set as artwork");
  });

  it("does not auto-activate when the card already has art", async () => {
    const { rpc } = mockCtx({ rows: { forge_cards: { working_art_key: "forge-art/existing" } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k2");
    await addArtCandidate("card1", pathname);
    expect(rpc).not.toHaveBeenCalledWith("forge_set_working_art", expect.anything());
  });

  it("maps the cap error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_add_art_candidate: { error: { message: "candidate limit reached (12)" } } } });
    (uploadForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/k3");
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/12 images/);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", pathname);
    expect(r.ok).toBe(false);
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });

  it("returns an error when the raw upload can't be read back", async () => {
    mockCtx({});
    (readForgeUpload as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await addArtCandidate("card1", pathname);
    expect(r).toEqual({ ok: false, error: "Could not read uploaded image" });
    expect(uploadForgeArt).not.toHaveBeenCalled();
  });
});

describe("deleteArtCandidate", () => {
  beforeEach(() => vi.clearAllMocks());
  it("maps the active-source refusal to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_delete_art_candidate: { error: { message: "candidate is the source of the current artwork" } } } });
    const r = await deleteArtCandidate("card1", "cand1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source of the current artwork/i);
  });
});

describe("listArtCandidates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps source_url to sourceUrl, defaulting missing ones to null", async () => {
    mockCtx({
      rows: {
        forge_card_art_candidates: [
          { id: "c1", key: "forge-art/1", created_at: "t1", source_url: "https://example.com/a" },
          { id: "c2", key: "forge-art/2", created_at: "t2", source_url: null },
        ],
        forge_cards: { working_art_key: "forge-art/1", working_art_original_key: "forge-art/1" },
      },
    });
    const rows = await listArtCandidates("card1");
    expect(rows).toEqual([
      { id: "c1", createdAt: "t1", isActiveSource: true, sourceUrl: "https://example.com/a" },
      { id: "c2", createdAt: "t2", isActiveSource: false, sourceUrl: null },
    ]);
  });
});

describe("setArtCandidateSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("trims the url and saves it via the RPC", async () => {
    const { rpc } = mockCtx({});
    const r = await setArtCandidateSource("card1", "cand1", "  https://example.com/art  ");
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_art_candidate_source", {
      p_candidate_id: "cand1",
      p_source_url: "https://example.com/art",
    });
  });

  it("clears the url when given null", async () => {
    const { rpc } = mockCtx({});
    const r = await setArtCandidateSource("card1", "cand1", null);
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_art_candidate_source", {
      p_candidate_id: "cand1",
      p_source_url: null,
    });
  });

  it("rejects a non-http(s) url without calling the RPC", async () => {
    const { rpc } = mockCtx({});
    const r = await setArtCandidateSource("card1", "cand1", "javascript:alert(1)");
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC error to friendly copy", async () => {
    mockCtx({ rpcResults: { forge_set_art_candidate_source: { error: { message: "not authorized to edit this card" } } } });
    const r = await setArtCandidateSource("card1", "cand1", "https://example.com");
    expect(r.ok).toBe(false);
  });

  it("refuses when not an elder", async () => {
    (requireElder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await setArtCandidateSource("card1", "cand1", "https://example.com");
    expect(r.ok).toBe(false);
  });
});

describe("applyCrop", () => {
  // vi.clearAllMocks() clears call history but NOT a prior mockReturnValue —
  // the first test below overrides clampCropRect to return null, so restore
  // its passthrough default here or that override leaks into later tests.
  beforeEach(() => {
    vi.clearAllMocks();
    (clampCropRect as ReturnType<typeof vi.fn>).mockImplementation((r) => r);
  });

  it("rejects an invalid rect before touching the blob store", async () => {
    mockCtx({});
    (clampCropRect as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const r = await applyCrop("card1", "cand1", { x: 0, y: 0, width: 0, height: 0 });
    expect(r.ok).toBe(false);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("crops, uploads raw, and saves cropped-as-working with the candidate as original", async () => {
    const { rpc } = mockCtx({ rows: { forge_card_art_candidates: { key: "forge-art/src" } } });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([new Uint8Array([1, 2])]).stream(),
    });
    (cropCardImage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from([3]), contentType: "image/jpeg" });
    (uploadForgeArtRaw as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/cropped");
    const r = await applyCrop("card1", "cand1", { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("forge_set_working_art", {
      p_card_id: "card1",
      p_key: "forge-art/cropped",
      p_original_key: "forge-art/src",
    });
  });
});

// Migration 128 (#603) makes these RPCs raise on a promoted card, on top of the refusals they
// already raise. The member reads what the database said, before and after that goes on.
describe("a refusal from the RPC reaches the member", () => {
  const refused = { error: { code: "P0001", message: "a promoted card is read-only" } };
  const said = { ok: false, error: "A promoted card is read-only." };

  beforeEach(() => {
    vi.clearAllMocks();
    (clampCropRect as ReturnType<typeof vi.fn>).mockImplementation((r) => r);
  });

  it("deleteArtCandidate", async () => {
    mockCtx({ rpcResults: { forge_delete_art_candidate: refused } });
    expect(await deleteArtCandidate("card1", "cand1")).toEqual(said);
  });

  it("activateCandidate", async () => {
    mockCtx({
      rows: { forge_card_art_candidates: { key: "forge-art/k1" } },
      rpcResults: { forge_set_working_art: refused },
    });
    expect(await activateCandidate("card1", "cand1")).toEqual(said);
  });

  it("applyCrop", async () => {
    mockCtx({
      rows: { forge_card_art_candidates: { key: "forge-art/k1" } },
      rpcResults: { forge_set_working_art: refused },
    });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 200, stream: new Blob([new Uint8Array([1])]).stream() });
    (cropCardImage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: Buffer.from([1]), contentType: "image/jpeg" });
    (uploadForgeArtRaw as ReturnType<typeof vi.fn>).mockResolvedValue("forge-art/cropped");
    expect(await applyCrop("card1", "cand1", { x: 0.1, y: 0.1, width: 0.5, height: 0.5 })).toEqual(said);
  });

  it("keeps a connection error general", async () => {
    mockCtx({
      rows: { forge_card_art_candidates: { key: "forge-art/k1" } },
      rpcResults: { forge_set_working_art: { error: { message: "fetch failed" } } },
    });
    expect(await activateCandidate("card1", "cand1")).toEqual({ ok: false, error: "Could not set artwork" });
  });
});
