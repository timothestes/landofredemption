import { describe, it, expect } from "vitest";
import { getDaysUntil, hasBeenPlayed } from "../listingDates";

// Local-time "now" mid-afternoon on Tue 2026-09-29, matching how a player's
// browser sees the page. Listing dates are plain YYYY-MM-DD strings.
const now = new Date(2026, 8, 29, 15, 30);

describe("getDaysUntil", () => {
  it("is 0 for today, 1 for tomorrow, -1 for yesterday", () => {
    expect(getDaysUntil("2026-09-29", now)).toBe(0);
    expect(getDaysUntil("2026-09-30", now)).toBe(1);
    expect(getDaysUntil("2026-09-28", now)).toBe(-1);
  });

  it("counts whole calendar days regardless of the time of day", () => {
    expect(getDaysUntil("2026-09-29", new Date(2026, 8, 29, 0, 5))).toBe(0);
    expect(getDaysUntil("2026-09-29", new Date(2026, 8, 29, 23, 55))).toBe(0);
    expect(getDaysUntil("2026-10-02", now)).toBe(3);
  });

  it("is not thrown off by a DST change in between", () => {
    // US DST ends Sun 2026-11-01; Sat -> Mon is still two days.
    expect(getDaysUntil("2026-11-02", new Date(2026, 9, 31, 9, 0))).toBe(2);
  });
});

describe("hasBeenPlayed", () => {
  it("is false for today and later", () => {
    expect(hasBeenPlayed({ start_date: "2026-09-29", end_date: null }, now)).toBe(false);
    expect(hasBeenPlayed({ start_date: "2026-10-24", end_date: null }, now)).toBe(false);
  });

  it("is true once the start date is behind us", () => {
    expect(hasBeenPlayed({ start_date: "2026-09-28", end_date: null }, now)).toBe(true);
    expect(hasBeenPlayed({ start_date: "2026-09-26", end_date: "2026-09-26" }, now)).toBe(true);
  });

  it("uses the end date for multi-day events", () => {
    // Started yesterday, still running today: not played yet.
    expect(hasBeenPlayed({ start_date: "2026-09-28", end_date: "2026-09-29" }, now)).toBe(false);
    expect(hasBeenPlayed({ start_date: "2026-09-27", end_date: "2026-09-28" }, now)).toBe(true);
  });
});
