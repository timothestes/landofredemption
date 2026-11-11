import { describe, expect, it } from "vitest";
import { parsePage, parseQuery } from "./list";

describe("parsePage", () => {
  it("defaults to 1 for missing or junk values", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
  });
  it("reads a valid page", () => {
    expect(parsePage("7")).toBe(7);
    expect(parsePage(["4", "9"])).toBe(4);
  });
});

describe("parseQuery", () => {
  it("trims and caps length", () => {
    expect(parseQuery("  errata ")).toBe("errata");
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery("x".repeat(500))).toHaveLength(100);
  });
});
