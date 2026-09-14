import { describe, it, expect, vi, afterEach } from "vitest";
import { warmForgeRenders } from "../warmForgeRenders";

describe("warmForgeRenders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches every URL, never more than `concurrency` at once, and swallows failures", async () => {
    let active = 0, peak = 0;
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (url === "/u3") throw new Error("network");
      return { arrayBuffer: async () => new ArrayBuffer(0) };
    }));
    const urls = Array.from({ length: 10 }, (_, i) => `/u${i}`);
    warmForgeRenders(urls, 4);
    await vi.waitFor(() => expect(seen).toHaveLength(10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBeLessThanOrEqual(4);
    expect(new Set(seen)).toEqual(new Set(urls));
  });

  it("does nothing for an empty list", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warmForgeRenders([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
