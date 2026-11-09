import { describe, it, expect } from "vitest";
import { tabScrollLeft } from "../tabStrip";

// A 263 px strip, like the Forge sub-nav on a 390 px phone, with the 28 px fade on its right edge.
const strip = { stripWidth: 263, fade: 28 };

describe("tabScrollLeft", () => {
  it("leaves a tab alone when it is already clear of the fade", () => {
    expect(tabScrollLeft({ ...strip, tabLeft: 60, tabRight: 120, scrollLeft: 0 })).toBeNull();
  });

  it("scrolls a tab past the right edge just clear of the fade", () => {
    expect(tabScrollLeft({ ...strip, tabLeft: 481, tabRight: 546, scrollLeft: 0 })).toBe(311);
  });

  it("counts a tab that only reaches the fade as hidden", () => {
    expect(tabScrollLeft({ ...strip, tabLeft: 180, tabRight: 240, scrollLeft: 0 })).toBe(5);
  });

  it("scrolls back to a tab left of the strip's scroll", () => {
    expect(tabScrollLeft({ ...strip, tabLeft: 40, tabRight: 100, scrollLeft: 200 })).toBe(40);
  });

  it("does nothing on a strip that fits, whatever the numbers, so a wide screen never moves", () => {
    expect(tabScrollLeft({ stripWidth: 1000, fade: 28, tabLeft: 500, tabRight: 600, scrollLeft: 0 })).toBeNull();
  });

  it("uses the tab's left edge when the tab is wider than the room", () => {
    expect(tabScrollLeft({ stripWidth: 100, fade: 28, tabLeft: 300, tabRight: 420, scrollLeft: 0 })).toBe(300);
  });
});
