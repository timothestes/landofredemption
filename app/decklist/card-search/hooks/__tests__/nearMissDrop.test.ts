import { describe, it, expect } from "vitest";
import { isNearMissDrop, type DragGrab } from "../useExternalDropTarget";

// Deck panel on the right half of a 1400px-wide window, below the nav.
const panel = { left: 1000, top: 100, right: 1400, bottom: 900 };
// A 140x200 card tile, grabbed dead centre.
const centre: DragGrab = { dx: 70, dy: 100, width: 140, height: 200 };
// The same tile, grabbed near its left edge.
const leftEdge: DragGrab = { dx: 10, dy: 100, width: 140, height: 200 };

describe("isNearMissDrop", () => {
  it("counts any drop with the pointer inside the panel", () => {
    expect(isNearMissDrop(1001, 500, null, panel)).toBe(true);
    expect(isNearMissDrop(1399, 101, centre, panel)).toBe(true);
  });

  it("counts a card mostly over the panel while the pointer is still outside", () => {
    // Grabbed at the left edge: pointer 5px short, 125px of the 140px card is in.
    expect(isNearMissDrop(995, 500, leftEdge, panel)).toBe(true);
  });

  it("counts a third of the card over the panel", () => {
    // Centre grab, pointer 20px short: the card's right 50px (36%) is in.
    expect(isNearMissDrop(980, 500, centre, panel)).toBe(true);
  });

  it("ignores a card that only clips the panel edge", () => {
    // Centre grab, pointer 50px short: 20px (14%) of the card is in.
    expect(isNearMissDrop(950, 500, centre, panel)).toBe(false);
  });

  it("ignores a card nowhere near the panel", () => {
    expect(isNearMissDrop(400, 500, centre, panel)).toBe(false);
  });

  it("measures overlap in both directions", () => {
    // Card fully right of the panel's left edge but mostly above it, in the nav.
    expect(isNearMissDrop(1100, 50, { dx: 70, dy: 150, width: 140, height: 200 }, panel)).toBe(false);
  });

  it("falls back to the pointer when the grab is unknown", () => {
    expect(isNearMissDrop(995, 500, null, panel)).toBe(false);
    expect(isNearMissDrop(995, 500, { dx: 0, dy: 0, width: 0, height: 0 }, panel)).toBe(false);
  });
});
