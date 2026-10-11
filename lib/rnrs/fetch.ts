import { FORMATS, RNRS_PROXY, SEASONS, SEASON_SHEETS } from "./config";
import { parseSheetCsv } from "./parse";
import type { FormatKey, NormalizedData, PlayerFormatResult } from "./types";

/**
 * Fetch and parse every season × format sheet through the proxy, in parallel.
 * Runs server-side; results are cached for an hour (`revalidate: 3600`). A sheet
 * that fails to load — or hangs past SHEET_TIMEOUT_MS — degrades to an empty
 * array rather than breaking the page. The timeout is load-bearing for deploys:
 * this page prerenders at build time, and a hung worker request once stalled it
 * past Next's 60s static-generation limit, failing the whole production build.
 */
const SHEET_TIMEOUT_MS = 15_000;

export async function fetchAllRnrsData(): Promise<NormalizedData> {
  const data: NormalizedData = {};

  await Promise.all(
    SEASONS.map(async (season) => {
      const formats: Partial<Record<FormatKey, PlayerFormatResult[]>> = {};
      await Promise.all(
        FORMATS.map(async ({ key }) => {
          const id = SEASON_SHEETS[season][key];
          if (!id) {
            formats[key] = [];
            return;
          }
          try {
            const res = await fetch(
              `${RNRS_PROXY}/?sheet=${key}&season=${season}&id=${id}`,
              { next: { revalidate: 3600 }, signal: AbortSignal.timeout(SHEET_TIMEOUT_MS) },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            formats[key] = parseSheetCsv(await res.text());
          } catch {
            formats[key] = [];
          }
        }),
      );
      data[season] = formats;
    }),
  );

  return data;
}
