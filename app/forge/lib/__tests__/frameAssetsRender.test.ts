import { describe, it, expect } from "vitest";
import { washBands, framePaths } from "../frameAssets";

describe("washBands", () => {
  it("has no fade for the top wash", () => {
    expect(washBands(1)).toEqual([null]);
  });
  it("fades a second brigade in from 40% to 60%", () => {
    expect(washBands(2)).toEqual([null, { from: 40, to: 60 }]);
  });
  it("puts three brigades' edges at thirds, each fade 40% / 3 wide", () => {
    const [top, a, b] = washBands(3);
    expect(top).toBeNull();
    expect(a!.from).toBeCloseTo(100 / 3 - 20 / 3, 6);
    expect(a!.to).toBeCloseTo(40, 6);
    expect(b!.from).toBeCloseTo(60, 6);
    expect(b!.to).toBeCloseTo(200 / 3 + 20 / 3, 6);
  });
});

describe("framePaths", () => {
  it("lists a hero's washes, box icon and class icons once each, in draw order", () => {
    expect(framePaths({
      cardType: ["Hero"], brigades: ["Blue", "Green"], strength: 5, toughness: 5,
      class: ["Warrior", "Weapon"], icons: ["Territory"],
    })).toEqual([
      "/forge/frames/washes/blue.webp",
      "/forge/frames/washes/green.webp",
      "/forge/frames/icons/cross.png",
      "/forge/frames/icons/warrior.png",
      "/forge/frames/icons/weapon.png",
      "/forge/frames/icons/territory.png",
    ]);
  });
  it("includes a Covenant's left icon and right chalice badge", () => {
    const paths = framePaths({ cardType: ["Covenant"], alignment: "Good" });
    expect(paths).toContain("/forge/frames/icons/bible.png");
    expect(paths).toContain("/forge/frames/badges/artifact.webp");
  });
  it("has nothing to load for a Lost Soul's box (it has none) beyond its wash", () => {
    expect(framePaths({ cardType: ["LostSoul"] })).toEqual(["/forge/frames/washes/lost-soul.webp"]);
  });
});
