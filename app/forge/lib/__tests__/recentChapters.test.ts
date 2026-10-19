import { afterEach, describe, expect, it, vi } from "vitest";
import { pushRecent, readRecent, type RecentChapter } from "../recentChapters";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recentChapters", () => {
  it("pushRecent puts the newest first, dedupes by id, caps at 3", () => {
    const a = { id: "GEN.5", label: "Genesis 5" },
      b = { id: "GEN.6", label: "Genesis 6" },
      c = { id: "EZR.4", label: "Ezra 4" },
      d = { id: "NEH.3", label: "Nehemiah 3" };
    expect(pushRecent([a, b, c], d)).toEqual([d, a, b]);
    expect(pushRecent([a, b, c], b)).toEqual([b, a, c]);
  });

  it("pushRecent does not mutate its input", () => {
    const list: RecentChapter[] = [{ id: "GEN.5", label: "Genesis 5" }];
    const next = pushRecent(list, { id: "GEN.6", label: "Genesis 6" });
    expect(next).not.toBe(list);
    expect(list).toEqual([{ id: "GEN.5", label: "Genesis 5" }]);
  });

  it("readRecent returns [] when storage is unavailable or corrupt", () => {
    expect(readRecent()).toEqual([]); // no window in node
    vi.stubGlobal("window", { sessionStorage: { getItem: () => "{not json" } });
    expect(readRecent()).toEqual([]);
  });

  it("readRecent returns [] when the stored JSON is not a valid chapter list", () => {
    vi.stubGlobal("window", { sessionStorage: { getItem: () => JSON.stringify({ id: "GEN.6" }) } });
    expect(readRecent()).toEqual([]);
    vi.stubGlobal("window", { sessionStorage: { getItem: () => JSON.stringify([{ id: 1 }]) } });
    expect(readRecent()).toEqual([]);
  });

  it("readRecent returns [] when sessionStorage throws", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readRecent()).toEqual([]);
  });
});
