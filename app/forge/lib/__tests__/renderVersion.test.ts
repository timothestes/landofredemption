import { describe, it, expect } from "vitest";
import { RENDER_VERSION, renderedToken, isCurrentRenderToken, renderedCacheKey } from "../renderVersion";

describe("renderVersion", () => {
  it("stamps the version id with the renderer version", () => {
    expect(renderedToken("v-1")).toBe(`v-1.r${RENDER_VERSION}`);
  });
  it("only calls this renderer's token current", () => {
    expect(isCurrentRenderToken(renderedToken("v-1"))).toBe(true);
    expect(isCurrentRenderToken(`v-1.r${RENDER_VERSION + 1}`)).toBe(false);
    expect(isCurrentRenderToken(`v-1.r${RENDER_VERSION}0`)).toBe(false);
    expect(isCurrentRenderToken("v-1")).toBe(false);
    expect(isCurrentRenderToken(null)).toBe(false);
  });
  it("keys the Blob cache by renderer version and version id", () => {
    expect(renderedCacheKey("abc")).toBe(`forge-rendered/r${RENDER_VERSION}/abc.jpg`);
  });
});
