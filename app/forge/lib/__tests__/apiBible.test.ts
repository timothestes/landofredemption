import { afterEach, describe, expect, it, vi } from "vitest";
import genesis6 from "./fixtures/apiBible/genesis-6.json";
import searchWells from "./fixtures/apiBible/search-wells.json";
import {
  NASB_2020_ID,
  UpstreamError,
  fetchChapter,
  repairSearchText,
  searchVerses,
  splitChapterText,
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
    const s = await searchVerses("wells Philistines");
    expect(s.total).toBe(5);
    expect(s.verses.find((v) => v.id === "GEN.26.18")!.text).not.toMatch(/L ord|  /);
    expect(s.copyright.startsWith("NEW AMERICAN STANDARD BIBLE")).toBe(true);
  });
});
