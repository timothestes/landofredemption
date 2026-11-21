import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveObjectURL } from "node:buffer";

// The standings reads go through the browser Supabase client. `failReads`
// makes every read come back the way supabase-js reports a dropped
// connection: no data and an error, never a throw.
let failReads = false;
let readCount = 0;
function result(data: unknown) {
  readCount++;
  return Promise.resolve(
    failReads
      ? { data: null, error: { message: "TypeError: Failed to fetch" } }
      : { data, error: null },
  );
}
vi.mock("../../../utils/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "tournaments"
            ? { single: () => result({ max_score: 5 }) }
            : result([]),
      }),
    }),
  }),
}));

import { printFinalStandingsFor } from "../StandingsTable";

const players = [
  { id: "a", name: "Alice", match_points: 0, differential: 0, dropped_out: false },
];

let printWindow: { location: { href: string }; close: ReturnType<typeof vi.fn> };
let open: ReturnType<typeof vi.fn>;
let alert: ReturnType<typeof vi.fn>;

beforeEach(() => {
  failReads = false;
  readCount = 0;
  printWindow = { location: { href: "" }, close: vi.fn() };
  open = vi.fn(() => printWindow);
  alert = vi.fn();
  vi.stubGlobal("window", { open, location: { origin: "https://example.test" } });
  vi.stubGlobal("alert", alert);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("printFinalStandingsFor", () => {
  it("opens the print tab during the click, before the standings are read", async () => {
    const printing = printFinalStandingsFor("t1", players, "Spring Open");
    // Nothing has been awaited yet: a browser still counts this as the click.
    expect(open).toHaveBeenCalledTimes(1);
    await printing;
    expect(printWindow.location.href).toMatch(/^blob:/);
    expect(printWindow.close).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("closes the tab and says so when the standings cannot be read", async () => {
    failReads = true;
    await printFinalStandingsFor("t1", players, "Spring Open");
    expect(printWindow.close).toHaveBeenCalledTimes(1);
    expect(printWindow.location.href).toBe("");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("declares UTF-8, so the long dash in a generated name does not print as mojibake", async () => {
    await printFinalStandingsFor("t1", players, "Aug 2, 2026 Type 2 Tournament — Wichita, KS");
    const blob = resolveObjectURL(printWindow.location.href);
    expect(blob?.type).toBe("text/html;charset=utf-8");
    expect(await blob?.text()).toContain("Tournament — Wichita, KS - Final Standings");
  });

  it("reads nothing when the browser blocks the tab", async () => {
    open.mockReturnValue(null);
    await printFinalStandingsFor("t1", players, "Spring Open");
    expect(alert).toHaveBeenCalledWith("Please allow popups for this site to print");
    expect(readCount).toBe(0);
  });
});
