import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// The route builds its own Supabase client; mock the factory so each test can
// shape auth + RPC results hermetically.
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn() }));
// Blob read must never be reached on denied paths; stub it so an accidental
// call would be obvious (and to avoid importing the real @vercel/blob).
vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn() }));
// The renderer is never loaded in these tests (it would pull in resvg); the route imports it
// dynamically only on a cache miss.
vi.mock("@/app/forge/lib/renderedCard", () => ({ renderAndStore: vi.fn() }));

import { GET } from "@/app/forge/api/art/[cardId]/route";
import { createClient } from "@/utils/supabase/server";
import { readForgeArt } from "@/app/forge/lib/art";
import { renderAndStore } from "@/app/forge/lib/renderedCard";
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";

/**
 * One `forge_art_key` RPC now does the member gate + version resolution + key
 * lookup server-side (SECURITY INVOKER, RLS-checked — migration 066). The
 * route only distinguishes: session valid? key returned? blob readable?
 */
function mockSupabase(opts: {
  user?: boolean; artKey?: string | null; candidateKey?: string | null; rpcError?: boolean;
  role?: string | null; card?: unknown; version?: unknown;
}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "forge_art_key") {
      return Promise.resolve(
        opts.rpcError
          ? { data: null, error: { message: "boom" } }
          : { data: opts.artKey ?? null, error: null },
      );
    }
    if (fn === "forge_candidate_art_key") {
      return Promise.resolve({ data: opts.candidateKey ?? null, error: null });
    }
    if (fn === "my_forge_role") {
      return Promise.resolve({ data: opts.role === undefined ? "playtester" : opts.role, error: null });
    }
    // forge_log_art_download audit
    return Promise.resolve({ data: null, error: null });
  });
  const from = vi.fn((table: string) => {
    const chain: Record<string, Mock> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: (table === "forge_cards" ? opts.card : opts.version) ?? null, error: null }),
    );
    return chain;
  });
  const getUser = vi.fn().mockResolvedValue(
    opts.user === false
      ? { data: { user: null }, error: { message: "no session" } }
      : { data: { user: { id: "u1" } }, error: null },
  );
  const client = { auth: { getUser }, rpc, from };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

const okBlob = () => ({
  statusCode: 200,
  stream: new ReadableStream(),
  blob: { contentType: "image/png" },
});

describe("GET /forge/api/art/[cardId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the caller has no session, even if a key would resolve", async () => {
    mockSupabase({ user: false, artKey: "forge-art/x" });
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("returns 404 when the RPC yields no key (non-member, unknown card, placeholder…)", async () => {
    mockSupabase({ artKey: null });
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("returns 404 when the RPC errors (e.g. malformed card id)", async () => {
    mockSupabase({ rpcError: true });
    const req = new Request("http://localhost/forge/api/art/not-a-uuid") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "not-a-uuid" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("maps query params onto the RPC (approved + finished)", async () => {
    const client = mockSupabase({ artKey: "forge-finished/k" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?v=approved&kind=finished") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_art_key", {
      p_card_id: "abc",
      p_approved: true,
      p_kind: "finished",
    });
    expect(readForgeArt).toHaveBeenCalledWith("forge-finished/k");
  });

  it("defaults to the working art view when no params are given", async () => {
    const client = mockSupabase({ artKey: "forge-art/w" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_art_key", {
      p_card_id: "abc",
      p_approved: false,
      p_kind: "art",
    });
  });

  it("returns 404 when the blob read returns null (dangling key)", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the blob read throws", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("blob down"));
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
  });

  it("streams the art with private no-store cache when present", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves an immutable private cache header when a t cache-buster is present", async () => {
    mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?v=approved&t=v1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });

  it("sets attachment disposition and logs the audit on ?download=1", async () => {
    const client = mockSupabase({ artKey: "forge-art/x" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?download=1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(client.rpc).toHaveBeenCalledWith("forge_log_art_download", { p_card_id: "abc" });
    // download responses must never be cached
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("routes candidate requests through forge_candidate_art_key", async () => {
    const client = mockSupabase({ candidateKey: "forge-art/cand" });
    (readForgeArt as ReturnType<typeof vi.fn>).mockResolvedValue(okBlob());
    const req = new Request("http://localhost/forge/api/art/abc?candidate=cand-1") as never;
    await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(client.rpc).toHaveBeenCalledWith("forge_candidate_art_key", {
      p_card_id: "abc",
      p_candidate_id: "cand-1",
    });
    expect(readForgeArt).toHaveBeenCalledWith("forge-art/cand");
  });

  it("returns 404 when the candidate RPC yields no key (non-elder, wrong card…)", async () => {
    mockSupabase({ candidateKey: null });
    const req = new Request("http://localhost/forge/api/art/abc?candidate=cand-1") as never;
    const res = await GET(req, { params: Promise.resolve({ cardId: "abc" }) });
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });
});

describe("GET /forge/api/art/[cardId]?kind=rendered", () => {
  beforeEach(() => vi.clearAllMocks());

  const VID = "22222222-3333-4444-5555-666666666666";
  const TOKEN = `${VID}.r${RENDER_VERSION}`;
  const KEY = `forge-rendered/r${RENDER_VERSION}/${VID}.jpg`;
  const released = { approved: null, published: { id: VID } };
  const get = (qs: string) =>
    GET(new Request(`http://localhost/forge/api/art/abc?${qs}`) as never, { params: Promise.resolve({ cardId: "abc" }) });
  const jpegBlob = () => ({ statusCode: 200, stream: new ReadableStream(), blob: { contentType: "image/jpeg" } });

  // The leak adversarial review found: RLS does not check membership, so a removed member
  // (leftover forge_set_grants row, or owner_id) still gets the card row back.
  it("404s a signed-in non-member even when RLS returns the card, before touching Blob or the renderer", async () => {
    mockSupabase({ role: null, card: released });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
    expect(renderAndStore).not.toHaveBeenCalled();
  });

  it("404s without a session", async () => {
    mockSupabase({ user: false, card: released });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("404s unless v=approved, and for download=1", async () => {
    mockSupabase({ card: released });
    expect((await get(`kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect((await get(`v=approved&kind=rendered&download=1`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("404s when no released version is visible", async () => {
    mockSupabase({ card: { approved: null, published: null } });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    mockSupabase({ card: null });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("serves a cached render, immutable only for this renderer's token", async () => {
    mockSupabase({ card: released });
    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(readForgeArt).toHaveBeenCalledWith(KEY);
    expect(renderAndStore).not.toHaveBeenCalled();

    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    const skewed = await get(`v=approved&kind=rendered&t=${VID}.r${RENDER_VERSION + 1}`);
    expect(skewed.headers.get("cache-control")).toBe("private, no-store");
  });

  it("prefers the approved version over the published one", async () => {
    const client = mockSupabase({ card: { approved: { id: "approved-v" }, published: { id: "published-v" } } });
    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    await get(`v=approved&kind=rendered&t=approved-v.r${RENDER_VERSION}`);
    expect(readForgeArt).toHaveBeenCalledWith(`forge-rendered/r${RENDER_VERSION}/approved-v.jpg`);
    const cardsFrom = (client.from as Mock).mock.results.find((_, i) => (client.from as Mock).mock.calls[i][0] === "forge_cards");
    const select = cardsFrom?.value.select as Mock;
    const selectArg = select.mock.calls[0][0] as string;
    expect(selectArg).toContain("fk_approved");
    expect(selectArg).toContain("fk_published");
  });

  it("404s on a Blob outage without rendering", async () => {
    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockRejectedValue(new Error("blob down"));
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(renderAndStore).not.toHaveBeenCalled();
  });

  it("renders on a miss from the version's data, art key and release year", async () => {
    mockSupabase({ card: released, version: { data: { name: "Holy Writ" }, art_key: "forge-art/k", created_at: "2025-11-02T10:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue({ jpeg: Buffer.from([1, 2, 3]), degraded: false });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(renderAndStore).toHaveBeenCalledWith({
      cacheKey: KEY, cardId: "abc", versionId: VID, data: { name: "Holy Writ" }, artKey: "forge-art/k", year: 2025,
    });
  });

  it("never lets the browser keep a degraded render", async () => {
    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue({ jpeg: Buffer.from([1]), degraded: true });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("404s when the version row is not visible or the render fails", async () => {
    mockSupabase({ card: released, version: null });
    (readForgeArt as Mock).mockResolvedValue(null);
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(renderAndStore).not.toHaveBeenCalled();

    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue(null);
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
  });
});
