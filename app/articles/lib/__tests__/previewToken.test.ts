import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PREVIEW_TOKEN_RE } from "../queries";

describe("PREVIEW_TOKEN_RE", () => {
  it("accepts every token createPreviewLinkAction mints", () => {
    for (let i = 0; i < 200; i++) expect(randomBytes(24).toString("base64url")).toMatch(PREVIEW_TOKEN_RE);
  });

  it("rejects short or out-of-alphabet tokens before they reach the database", () => {
    expect("abc").not.toMatch(PREVIEW_TOKEN_RE);
    expect("a".repeat(31)).not.toMatch(PREVIEW_TOKEN_RE);
    expect("a".repeat(31) + "%").not.toMatch(PREVIEW_TOKEN_RE);
  });
});
