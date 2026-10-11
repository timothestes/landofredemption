import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAllRnrsData } from "./fetch";
import { SEASONS, FORMATS, SEASON_SHEETS } from "./config";

// Seasons without a sheet for a format (e.g. type1Unlimited before 2027) are skipped.
const CONFIGURED_SHEETS = SEASONS.reduce(
  (n, s) => n + FORMATS.filter((f) => SEASON_SHEETS[s][f.key]).length,
  0,
);

const okResponse = { ok: true, text: async () => "" } as Response;

describe("fetchAllRnrsData", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  // A hung (never-resolving) worker request stalled page prerender past Next's
  // 60s static-generation limit and failed the whole production build — every
  // sheet request must carry an abort/timeout signal so it can't hang.
  it("passes an abort signal to every sheet request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    global.fetch = fetchMock as typeof fetch;

    await fetchAllRnrsData();

    expect(fetchMock).toHaveBeenCalledTimes(CONFIGURED_SHEETS);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit)?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("degrades a timed-out sheet to an empty array instead of throwing", async () => {
    const timedOutKey = FORMATS[0].key;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes(`sheet=${timedOutKey}`)) {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      return okResponse;
    });
    global.fetch = fetchMock as typeof fetch;

    const data = await fetchAllRnrsData();

    expect(data[SEASONS[0]]?.[timedOutKey]).toEqual([]);
    // Healthy sheets are unaffected by the sick one.
    expect(data[SEASONS[0]]?.[FORMATS[1].key]).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(CONFIGURED_SHEETS);
  });
});
