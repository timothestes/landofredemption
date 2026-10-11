import { describe, it, expect } from "vitest";
import { isOnScrollbar } from "../scrollbarHit";

// A scrollable box at (100, 50), 300x200 border-box with a 1px border and a
// 15px vertical scrollbar: the client area is 283 wide (300 - 2 - 15).
function scroller(overrides: Partial<Parameters<typeof isOnScrollbar>[0]> = {}) {
  return {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 300, height: 200 }) as DOMRect,
    clientLeft: 1,
    clientTop: 1,
    clientWidth: 283,
    clientHeight: 198,
    ...overrides,
  };
}

describe("isOnScrollbar", () => {
  it("is true when the pointer is in the vertical scrollbar gutter", () => {
    // 1px border + 283px client area = x 384; the gutter runs 384..399.
    expect(isOnScrollbar(scroller(), 390, 120)).toBe(true);
  });

  it("is false when the pointer is over the content", () => {
    expect(isOnScrollbar(scroller(), 200, 120)).toBe(false);
  });

  it("is true when the pointer is in the horizontal scrollbar gutter", () => {
    // Horizontal bar: client height shrinks to 183, gutter runs y 234..249.
    expect(isOnScrollbar(scroller({ clientHeight: 183 }), 200, 240)).toBe(true);
  });

  it("is false inside a box with no scrollbar at all", () => {
    expect(isOnScrollbar(scroller({ clientWidth: 298 }), 395, 120)).toBe(false);
  });
});
