import { describe, it, expect } from "vitest";
import { typedNameMatches } from "../confirmName";

// Generated names join the location with a long dash, which a phone keyboard
// has no key for. The End tournament gate must accept a plain hyphen there.
const NAME = "Aug 2, 2026 Regional Type 2 Tournament — Wichita, KS";

describe("typedNameMatches", () => {
  it("accepts a plain hyphen where the name has a long dash", () => {
    expect(
      typedNameMatches("Aug 2, 2026 Regional Type 2 Tournament - Wichita, KS", NAME),
    ).toBe(true);
  });

  it("accepts an en dash or the long dash itself", () => {
    expect(typedNameMatches("Aug 2, 2026 Regional Type 2 Tournament – Wichita, KS", NAME)).toBe(true);
    expect(typedNameMatches(NAME, NAME)).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(
      typedNameMatches("  aug 2, 2026 regional type 2 tournament - wichita, ks ", NAME),
    ).toBe(true);
  });

  it("still refuses anything that is not the name", () => {
    expect(typedNameMatches("", NAME)).toBe(false);
    expect(typedNameMatches("Aug 2, 2026 Regional Type 2 Tournament", NAME)).toBe(false);
    expect(typedNameMatches("Aug 2, 2026 Regional Type 2 Tournament Wichita, KS", NAME)).toBe(false);
    expect(typedNameMatches("end", NAME)).toBe(false);
  });
});
