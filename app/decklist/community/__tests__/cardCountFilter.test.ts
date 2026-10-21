import { describe, it, expect } from "vitest";
import {
  parseCardCount,
  rangeFromDraft,
  draftFromRange,
  cardCountLabel,
} from "../cardCountFilter";

describe("parseCardCount", () => {
  it("accepts a positive integer, with surrounding whitespace", () => {
    expect(parseCardCount("57")).toBe(57);
    expect(parseCardCount(" 57 ")).toBe(57);
  });

  it("rejects empty, missing, non-numeric, zero, negative and fractional input", () => {
    expect(parseCardCount("")).toBeNull();
    expect(parseCardCount(null)).toBeNull();
    expect(parseCardCount(undefined)).toBeNull();
    expect(parseCardCount("abc")).toBeNull();
    expect(parseCardCount("0")).toBeNull();
    expect(parseCardCount("-3")).toBeNull();
    expect(parseCardCount("57.5")).toBeNull();
    expect(parseCardCount("1000")).toBeNull();
  });
});

describe("rangeFromDraft", () => {
  it("maps each mode to its bounds", () => {
    expect(rangeFromDraft("exact", "57", "")).toEqual({ min: 57, max: 57 });
    expect(rangeFromDraft("min", "52", "")).toEqual({ min: 52, max: null });
    expect(rangeFromDraft("max", "51", "")).toEqual({ min: null, max: 51 });
    expect(rangeFromDraft("between", "50", "56")).toEqual({ min: 50, max: 56 });
  });

  it("swaps a reversed between-range", () => {
    expect(rangeFromDraft("between", "56", "50")).toEqual({ min: 50, max: 56 });
  });

  it("treats a half-filled between as a single bound", () => {
    expect(rangeFromDraft("between", "50", "")).toEqual({ min: 50, max: null });
    expect(rangeFromDraft("between", "", "56")).toEqual({ min: null, max: 56 });
  });

  it("yields no filter for empty or invalid input", () => {
    expect(rangeFromDraft("exact", "", "")).toEqual({ min: null, max: null });
    expect(rangeFromDraft("exact", "abc", "")).toEqual({ min: null, max: null });
    expect(rangeFromDraft("min", "", "")).toEqual({ min: null, max: null });
  });
});

describe("draftFromRange", () => {
  it("recovers the mode and inputs from a URL range", () => {
    expect(draftFromRange({ min: 57, max: 57 })).toEqual({ mode: "exact", a: "57", b: "" });
    expect(draftFromRange({ min: 52, max: null })).toEqual({ mode: "min", a: "52", b: "" });
    expect(draftFromRange({ min: null, max: 51 })).toEqual({ mode: "max", a: "51", b: "" });
    expect(draftFromRange({ min: 50, max: 56 })).toEqual({ mode: "between", a: "50", b: "56" });
  });

  it("defaults to an empty exact draft", () => {
    expect(draftFromRange({ min: null, max: null })).toEqual({ mode: "exact", a: "", b: "" });
  });

  it("round-trips through rangeFromDraft", () => {
    for (const range of [
      { min: 57, max: 57 },
      { min: 52, max: null },
      { min: null, max: 51 },
      { min: 50, max: 56 },
      { min: null, max: null },
    ]) {
      const d = draftFromRange(range);
      expect(rangeFromDraft(d.mode, d.a, d.b)).toEqual(range);
    }
  });
});

describe("cardCountLabel", () => {
  it("describes each kind of range", () => {
    expect(cardCountLabel({ min: 57, max: 57 })).toBe("57 cards");
    expect(cardCountLabel({ min: 1, max: 1 })).toBe("1 card");
    expect(cardCountLabel({ min: 52, max: null })).toBe("52+ cards");
    expect(cardCountLabel({ min: null, max: 51 })).toBe("≤51 cards");
    expect(cardCountLabel({ min: 50, max: 56 })).toBe("50–56 cards");
  });

  it("is null when there is no filter", () => {
    expect(cardCountLabel({ min: null, max: null })).toBeNull();
  });
});
