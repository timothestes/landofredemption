import { afterEach, describe, expect, it, vi } from "vitest";
import genesis6 from "./fixtures/apiBible/genesis-6.json";
import searchWells from "./fixtures/apiBible/search-wells.json";
import {
  NASB_2020_ID,
  UpstreamError,
  fetchChapter,
  normalizeNeighbour,
  repairSearchText,
  searchVerses,
  isValidRange,
  splitChapterText,
  NASB_1995_ID,
  NASB_1995_COPYRIGHT,
  NASB_COPYRIGHT,
  stripNasbMarkers,
} from "../apiBible";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiBible", () => {
  it("splits [n] markers into 22 verses with exact text", () => {
    const v = splitChapterText(genesis6.data.content);
    expect(v).toHaveLength(22);
    expect(v[1]).toEqual({
      n: 2,
      text: "that the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose.",
    });
    expect(v[2].text.startsWith("Then the Lord said, “My Spirit")).toBe(true);
  });

  it("only [digits] split; other brackets survive", () =>
    expect(splitChapterText(" [1] Praise Him [Selah] now [2] again")).toEqual([
      { n: 1, text: "Praise Him [Selah] now" },
      { n: 2, text: "again" },
    ]));

  it("drops NASB's historical-present asterisk from chapter and search text", () => {
    expect(splitChapterText(" [36] After dismissing the crowd, they *took Him along [37] And a fierce gale *developed")).toEqual([
      { n: 36, text: "After dismissing the crowd, they took Him along" },
      { n: 37, text: "And a fierce gale developed" },
    ]);
    expect(repairSearchText("Jesus *said to them")).toBe("Jesus said to them");
    expect(stripNasbMarkers("5 * 3 and *x")).toBe("5 * 3 and x");
  });

  it("repairs small-caps artefacts and doubled spaces for display", () => {
    expect(repairSearchText("to the L ord ; and  then")).toBe("to the Lord; and then");
    expect(repairSearchText("Says the Lord  G od .")).toBe("Says the Lord God.");
  });

  it("fetchChapter sends the key and the exact params, returns prev/next and the token", async () => {
    process.env.API_BIBLE_KEY = "k";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(genesis6), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const c = await fetchChapter("GEN.6");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://rest.api.bible/v1/bibles/${NASB_2020_ID}/chapters/GEN.6?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`,
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "api-key": "k" });
    expect(c).toMatchObject({ bookId: "GEN", chapter: 6, prev: "GEN.5", next: "GEN.7", fumsToken: "fixture-token" });
    expect(c.copyright.startsWith("NEW AMERICAN STANDARD BIBLE")).toBe(true);
  });

  it("fetchChapter throws UpstreamError with the status on non-2xx, and without the key before fetching", async () => {
    process.env.API_BIBLE_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 429 })));
    await expect(fetchChapter("GEN.6")).rejects.toMatchObject({ status: 429 });
    delete process.env.API_BIBLE_KEY;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(fetchChapter("GEN.6")).rejects.toBeInstanceOf(UpstreamError);
    expect(f).not.toHaveBeenCalled();
  });

  it("searchVerses repairs text, collapses whitespace, and forwards total", async () => {
    process.env.API_BIBLE_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(searchWells), { status: 200 })));
    const s = await searchVerses("wells Philistines", {});
    expect(s.total).toBe(5);
    expect(s.verses.find((v) => v.id === "GEN.26.18")!.text).not.toMatch(/L ord|  /);
    expect(s.copyright.startsWith("NEW AMERICAN STANDARD BIBLE")).toBe(true);
    expect(s.verses.find((v) => v.id === "AMO.1.8")!.text.endsWith("Says the Lord God.")).toBe(true);
  });

  it("searchVerses forwards range, sort, exact and offset and fixes limit at 25", async () => {
    process.env.API_BIBLE_KEY = "k";
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(searchWells), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const s = await searchVerses("shepherd", { offset: 25, range: "PSA", sort: "canonical", exact: true });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("limit=25");
    expect(url).toContain("offset=25");
    expect(url).toContain("range=PSA");
    expect(url).toContain("sort=canonical");
    expect(url).toContain("fuzziness=0");
    expect(s).toMatchObject({ offset: 25, limit: 25 });
  });

  it("searchVerses sends fuzziness=AUTO by default and omits range and sort", async () => {
    process.env.API_BIBLE_KEY = "k";
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(searchWells), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await searchVerses("shepherd", {});
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("fuzziness=AUTO");
    expect(url).toContain("offset=0");
    expect(url).not.toContain("range=");
    expect(url).not.toContain("sort=");
  });

  it("searchVerses resolves an upstream 400 to zero matches", async () => {
    process.env.API_BIBLE_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("search error", { status: 400 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await searchVerses("ark gopher zebra", {});
    expect(s).toMatchObject({ total: 0, verses: [], offset: 0, limit: 25, fumsToken: "" });
    expect(s.copyright).toBe(NASB_COPYRIGHT);
    expect(warn).toHaveBeenCalledWith("[scripture] search 400", "ark gopher zebra".length);
    warn.mockRestore();
  });

  it("searchVerses still throws on other upstream statuses", async () => {
    process.env.API_BIBLE_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 429 })));
    await expect(searchVerses("x", {})).rejects.toBeInstanceOf(UpstreamError);
  });

  it("isValidRange accepts ids and canonical spans, rejects reversed and unknown", () => {
    expect(isValidRange("PSA")).toBe(true);
    expect(isValidRange("GEN-MAL")).toBe(true);
    expect(isValidRange("MAT-JHN")).toBe(true);
    expect(isValidRange("MAL-GEN")).toBe(false);
    expect(isValidRange("XYZ")).toBe(false);
    expect(isValidRange("GEN-")).toBe(false);
  });

  it("normalizeNeighbour maps .intro pseudo-chapters to real chapters", () => {
    expect(normalizeNeighbour("GEN.intro", "prev")).toBeNull();
    expect(normalizeNeighbour("EXO.intro", "prev")).toBe("GEN.50");
    expect(normalizeNeighbour("MAT.intro", "next")).toBe("MAT.1");
    expect(normalizeNeighbour("GEN.7", "next")).toBe("GEN.7");
    expect(normalizeNeighbour(null, "next")).toBeNull();
  });

  it("fetchChapter normalizes an .intro previous at Genesis 1 to null", async () => {
    process.env.API_BIBLE_KEY = "k";
    const body = { ...genesis6, data: { ...genesis6.data, previous: { id: "GEN.intro" } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
    expect((await fetchChapter("GEN.1")).prev).toBeNull();
  });

  it("fetchChapter and searchVerses target the 1995 edition on request, with its own notice", async () => {
    process.env.API_BIBLE_KEY = "k";
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(genesis6), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await fetchChapter("GEN.6", "1995");
    expect(f.mock.calls[0][0]).toContain(`/bibles/${NASB_1995_ID}/chapters/GEN.6?`);
    f.mockResolvedValue(new Response(JSON.stringify(searchWells), { status: 200 }));
    const s = await searchVerses("wells Philistines", {}, "1995");
    expect(f.mock.calls[1][0]).toContain(`/bibles/${NASB_1995_ID}/search?`);
    expect(s.copyright).toBe(NASB_1995_COPYRIGHT);
    expect(NASB_1995_COPYRIGHT).not.toBe(NASB_COPYRIGHT);
  });
});
