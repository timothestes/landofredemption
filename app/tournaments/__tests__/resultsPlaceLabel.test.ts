import { describe, it, expect } from "vitest";
import { placeLabel } from "../results/[id]/placeLabel";

describe("placeLabel (public results page)", () => {
  it("gives a placed player their ordinal, shared places included", () => {
    expect(placeLabel({ place: 1, dropped: false })).toBe("1st");
    expect(placeLabel({ place: 2, dropped: false })).toBe("2nd");
    expect(placeLabel({ place: 3, dropped: false })).toBe("3rd");
    expect(placeLabel({ place: 11, dropped: false })).toBe("11th");
    expect(placeLabel({ place: 22, dropped: false })).toBe("22nd");
  });

  it("says Dropped for a player who left, who has no place", () => {
    expect(placeLabel({ place: null, dropped: true })).toBe("Dropped");
  });

  it("keeps the dash for a player with no place who did not drop", () => {
    expect(placeLabel({ place: null, dropped: false })).toBe("—");
  });
});
