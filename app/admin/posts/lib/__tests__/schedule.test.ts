import { describe, it, expect } from "vitest";
import { toDatetimeLocalValue, fromDatetimeLocalValue, isFutureIso } from "../schedule";

describe("toDatetimeLocalValue / fromDatetimeLocalValue", () => {
  it("returns '' for null", () => expect(toDatetimeLocalValue(null)).toBe(""));
  it("returns '' for an unparseable string", () => expect(toDatetimeLocalValue("not a date")).toBe(""));
  it("round-trips through the local-time conversion", () => {
    const iso = new Date(2026, 8, 25, 9, 5, 0).toISOString(); // local Sep 25 2026, 9:05am
    expect(fromDatetimeLocalValue(toDatetimeLocalValue(iso))).toBe(iso);
  });
  it("pads single-digit month/day/hour/minute", () => {
    const iso = new Date(2026, 0, 5, 3, 4, 0).toISOString();
    expect(toDatetimeLocalValue(iso)).toBe("2026-01-05T03:04");
  });

  it("returns null for an empty value", () => expect(fromDatetimeLocalValue("")).toBeNull());
  it("returns null for an invalid value", () => expect(fromDatetimeLocalValue("garbage")).toBeNull());
});

describe("isFutureIso", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  it("is false for null", () => expect(isFutureIso(null, now)).toBe(false));
  it("is false for an invalid string", () => expect(isFutureIso("nope", now)).toBe(false));
  it("is false for the past", () => expect(isFutureIso("2026-01-01T00:00:00.000Z", now)).toBe(false));
  it("is false for exactly now", () => expect(isFutureIso(now.toISOString(), now)).toBe(false));
  it("is true for the future", () => expect(isFutureIso("2027-01-01T00:00:00.000Z", now)).toBe(true));
});
