import { describe, it, expect } from "vitest";
import { parseStatInput } from "../designCard";

describe("parseStatInput", () => {
  it("returns null for empty / whitespace / junk", () => {
    expect(parseStatInput("")).toBeNull();
    expect(parseStatInput("   ")).toBeNull();
    expect(parseStatInput("abc")).toBeNull();
    expect(parseStatInput("6-0")).toBeNull();
  });

  it("passes plain numbers through as numbers", () => {
    expect(parseStatInput("6")).toBe(6);
    expect(parseStatInput(" 12 ")).toBe(12);
    expect(parseStatInput("0")).toBe(0);
  });

  it("normalizes a variable stat to X", () => {
    expect(parseStatInput("x")).toBe("X");
    expect(parseStatInput("X")).toBe("X");
  });

  it("normalizes canonical parenthesized dual-side stats", () => {
    expect(parseStatInput("6 (0)")).toBe("6 (0)");
    expect(parseStatInput("3(2)")).toBe("3 (2)");
    expect(parseStatInput("x(0)")).toBe("X (0)");
  });

  it("accepts slash-separated dual-side stats and normalizes to N (M)", () => {
    expect(parseStatInput("6/0")).toBe("6 (0)");
    expect(parseStatInput("6 / 0")).toBe("6 (0)");
    expect(parseStatInput("x/0")).toBe("X (0)");
    expect(parseStatInput("6/x")).toBe("6 (X)");
  });

  it("keeps every form the catalog prints", () => {
    expect(parseStatInput("-3")).toBe(-3);
    expect(parseStatInput("*")).toBe("*");
    expect(parseStatInput("-X")).toBe("-X");
    expect(parseStatInput("-x")).toBe("-X");
    expect(parseStatInput("4/11")).toBe("4 (11)");
    expect(parseStatInput("2/2")).toBe("2 (2)");
    expect(parseStatInput("-/0")).toBe("- (0)");
    expect(parseStatInput("-(5)")).toBe("- (5)");
    expect(parseStatInput("X(7)")).toBe("X (7)");
    expect(parseStatInput("4(X)")).toBe("4 (X)");
    expect(parseStatInput("08")).toBe(8);
    expect(parseStatInput("+2")).toBe(2);
  });

  it("refuses what Number() would quietly accept", () => {
    expect(parseStatInput("7.")).toBeNull();
    expect(parseStatInput("6.5")).toBeNull();
    expect(parseStatInput("1e3")).toBeNull();
    expect(parseStatInput("0x10")).toBeNull();
    expect(parseStatInput("Infinity")).toBeNull();
    expect(parseStatInput("-")).toBeNull();
  });
});
