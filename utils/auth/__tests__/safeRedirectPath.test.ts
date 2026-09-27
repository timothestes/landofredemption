import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../safeRedirectPath";

describe("safeRedirectPath", () => {
  it("returns a plain same-origin path unchanged", () => {
    expect(safeRedirectPath("/decklist/card-search")).toBe("/decklist/card-search");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("keeps a query string", () => {
    expect(safeRedirectPath("/a?b=c")).toBe("/a?b=c");
  });

  it("allows an @ after the first ? (it is query data, not a userinfo separator)", () => {
    expect(safeRedirectPath("/a?next=user@example.com")).toBe("/a?next=user@example.com");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
  });

  it("rejects a backslash right after the slash (browsers normalise it to //)", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
  });

  it("rejects a backslash anywhere in the path", () => {
    expect(safeRedirectPath("/foo\\bar")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects a bare host with userinfo (origin + '@evil.com' would leave the site)", () => {
    expect(safeRedirectPath("@evil.com")).toBe("/");
  });

  it("rejects an @ before the first ? even after a leading slash", () => {
    expect(safeRedirectPath("/@evil.com")).toBe("/");
  });

  it("rejects CR/LF (header injection)", () => {
    expect(safeRedirectPath("/foo\r\nSet-Cookie: a=b")).toBe("/");
    expect(safeRedirectPath("/foo\nbar")).toBe("/");
  });

  it("falls back for empty and non-string input", () => {
    expect(safeRedirectPath("")).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(42)).toBe("/");
    expect(safeRedirectPath(["/a"])).toBe("/");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("//evil.com", "/tracker")).toBe("/tracker");
    expect(safeRedirectPath(undefined, "")).toBe("");
  });
});
