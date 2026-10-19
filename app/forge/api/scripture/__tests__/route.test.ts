import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
vi.mock("@/app/forge/lib/apiBible", async () => {
  const actual = await vi.importActual<typeof import("@/app/forge/lib/apiBible")>(
    "@/app/forge/lib/apiBible",
  );
  return { UpstreamError: actual.UpstreamError, fetchChapter: vi.fn(), searchVerses: vi.fn() };
});

import { GET } from "@/app/forge/api/scripture/route";
import { requireForge } from "@/app/forge/lib/auth";
import { fetchChapter, searchVerses, UpstreamError } from "@/app/forge/lib/apiBible";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const get = (qs: string) => GET(new Request(`http://localhost/forge/api/scripture?${qs}`));

function chapter(bookId: string, n: number) {
  return {
    bookId,
    chapter: 6,
    verses: Array.from({ length: n }, (_, i) => ({ n: i + 1, text: `v${i + 1}` })),
    prev: null,
    next: null,
    copyright: "c",
    fumsToken: "f",
  };
}

describe("GET /forge/api/scripture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asMock(requireForge).mockResolvedValue({ user: { id: "u1" } });
  });

  it("404s non-members without touching API.Bible", async () => {
    asMock(requireForge).mockResolvedValue(null);
    const res = await get("ref=Gen%206:2");
    expect(res.status).toBe(404);
    expect(fetchChapter).not.toHaveBeenCalled();
    expect(searchVerses).not.toHaveBeenCalled();
  });

  it("ref: returns the chapter, book name and requested range", async () => {
    asMock(fetchChapter).mockResolvedValue(chapter("GEN", 22));
    const res = await get("ref=Gen%206:2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requested).toEqual({ from: 2, to: 2 });
    expect(body.book).toBe("Genesis");
    expect(body.verses).toHaveLength(22);
    expect(fetchChapter).toHaveBeenCalledWith("GEN.6");
  });

  it("ref: 400 unrecognized_reference and no fetch", async () => {
    const res = await get("ref=Pslam%2023");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unrecognized_reference" });
    expect(fetchChapter).not.toHaveBeenCalled();
  });

  it("ref: 404 verse_out_of_range with verseCount", async () => {
    asMock(fetchChapter).mockResolvedValue(chapter("GEN", 22));
    const res = await get("ref=Genesis%206:30");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "verse_out_of_range", verseCount: 22 });
  });

  it("chapter: requested defaults to 1..1", async () => {
    asMock(fetchChapter).mockResolvedValue(chapter("GEN", 24));
    const res = await get("chapter=GEN.7");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requested).toEqual({ from: 1, to: 1 });
    expect(body.book).toBe("Genesis");
    expect(fetchChapter).toHaveBeenCalledWith("GEN.7");
  });

  it("chapter: 400 bad_request on a malformed id", async () => {
    const res = await get("chapter=..%2Fetc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
    expect(fetchChapter).not.toHaveBeenCalled();
  });

  it("q: trims and collapses whitespace", async () => {
    const payload = { total: 0, verses: [], fumsToken: "f" };
    asMock(searchVerses).mockResolvedValue(payload);
    const res = await get("q=%20wells%20%20Philistines%20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(searchVerses).toHaveBeenCalledWith("wells Philistines", 20);
  });

  it("q: 400 empty_query on blank", async () => {
    const res = await get("q=%20%20");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_query" });
    expect(searchVerses).not.toHaveBeenCalled();
  });

  it("502 upstream when the client throws, without leaking upstream text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const err of [
      new UpstreamError("secret-key-abc rate limited", 429),
      new UpstreamError("API_BIBLE_KEY is not set"),
      new Error("boom"),
    ]) {
      asMock(fetchChapter).mockRejectedValueOnce(err);
      const res = await get("ref=Gen%206:2");
      expect(res.status).toBe(502);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "upstream" });
      expect(text).not.toContain("secret");
    }
    asMock(searchVerses).mockRejectedValueOnce(new UpstreamError("x", 429));
    expect((await get("q=wells")).status).toBe(502);
    expect(warn).toHaveBeenCalledWith("[scripture] upstream", 429);
    warn.mockRestore();
  });

  it("400 when none or more than one of ref/chapter/q is given", async () => {
    for (const qs of ["", "ref=Gen%206:2&q=wells", "chapter=GEN.7&q=x", "ref=Gen%206&chapter=GEN.6"]) {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(fetchChapter).not.toHaveBeenCalled();
    expect(searchVerses).not.toHaveBeenCalled();
  });
});
