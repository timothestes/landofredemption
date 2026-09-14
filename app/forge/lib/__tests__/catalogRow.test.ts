import { describe, it, expect } from "vitest";
import type { DesignCard } from "../designCard";
import {
  catalogImgFileSlug, designCardToCatalogRow, parseImageTransform, PRINTER_PRESETS,
  CARD_IMAGE_ASPECT,
} from "../catalogRow";

describe("catalogImgFileSlug", () => {
  it("underscores spaces and appends the set-code suffix", () => {
    expect(catalogImgFileSlug("A Child is Born", "EoT")).toBe("A_Child_is_Born_(EoT)");
  });

  it("strips commas (the historical crop-script rename)", () => {
    expect(catalogImgFileSlug("Go, and Sin No More", "EoT")).toBe("Go_and_Sin_No_More_(EoT)");
  });

  it("collapses filesystem-unsafe characters", () => {
    expect(catalogImgFileSlug('What? A/B\\C:"D"', "X")).toBe("What_A_B_C_D_(X)");
  });

  it("keeps apostrophes, matching upstream imgFile convention", () => {
    expect(catalogImgFileSlug("Devil's Snare", "X")).toBe("Devil's_Snare_(X)");
  });

  it("falls back to 'card' for an empty name", () => {
    expect(catalogImgFileSlug("", "X")).toBe("card_(X)");
  });
});

describe("designCardToCatalogRow", () => {
  const ctx = { name: "Test Hero", set: "EoT", officialSet: "Eve of Tribulation", imageFile: "Test_Hero_(EoT)" };

  it("maps a full card onto the 15 public fields", () => {
    const card: DesignCard = {
      name: "Test Hero",
      cardType: ["Hero"],
      alignment: "Good",
      brigades: ["Purple", "Crimson"],
      strength: 6,
      toughness: 5,
      class: ["Warrior"],
      icons: ["Star"],
      identifiers: ["Judge", "Musician"],
      rawText: "Protect from capture.",
      rarity: "Rare",
      reference: "Judges 6:12",
      legality: "Rotation",
    };
    const row = designCardToCatalogRow(card, ctx);
    expect(row).toEqual({
      name: "Test Hero",
      set: "EoT",
      imgFile: "Test_Hero_(EoT)",
      officialSet: "Eve of Tribulation",
      type: "Hero",
      brigade: "Purple/Crimson",
      strength: "6",
      toughness: "5",
      class: "Warrior/Star", // class + icons recombine into one column
      identifier: "Judge, Musician",
      specialAbility: "Protect from capture.",
      rarity: "Rare",
      reference: "Judges 6:12",
      alignment: "Good",
      legality: "Rotation",
    });
  });

  it("emits empty strings for unset stats — never display placeholders", () => {
    const row = designCardToCatalogRow({ name: "Bare", cardType: ["LostSoul"] }, ctx);
    expect(row.strength).toBe("");
    expect(row.toughness).toBe("");
    expect(row.brigade).toBe("");
    // The "—" placeholder is designCardToCard's display convention; a catalog
    // row carrying it would corrupt lookups and validation.
    expect(Object.values(row)).not.toContain("—");
  });

  it("prefers rawText over a stale legacy specialAbility", () => {
    const row = designCardToCatalogRow(
      { rawText: "Current text.", specialAbility: "Stale text." }, ctx,
    );
    expect(row.specialAbility).toBe("Current text.");
  });

  it("defaults an unset legality to Rotation (the release makes cards legal)", () => {
    expect(designCardToCatalogRow({}, ctx).legality).toBe("Rotation");
    expect(designCardToCatalogRow({ legality: "Classic" }, ctx).legality).toBe("Classic");
  });

  it("renders Good_Evil alignment as the public Good/Evil form", () => {
    expect(designCardToCatalogRow({ alignment: "Good_Evil" }, ctx).alignment).toBe("Good/Evil");
  });

  it('promotes a card of every evil brigade as the catalog\'s own "Multi"', () => {
    const row = designCardToCatalogRow({
      cardType: ["EE"], alignment: "Evil",
      brigades: ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"],
    }, ctx);
    expect(row.brigade).toBe("Multi");
  });
});

describe("parseImageTransform", () => {
  it("accepts the three stored shapes", () => {
    expect(parseImageTransform({ mode: "cover" })).toEqual({ mode: "cover" });
    expect(parseImageTransform({ mode: "preset", preset: "printer2" })).toEqual({
      mode: "preset", preset: "printer2",
    });
    expect(parseImageTransform({ mode: "crop", rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }))
      .toEqual({ mode: "crop", rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } });
  });

  it("rejects junk as automatic (null)", () => {
    expect(parseImageTransform(null)).toBeNull();
    expect(parseImageTransform("cover")).toBeNull();
    expect(parseImageTransform({ mode: "preset", preset: "laser" })).toBeNull();
    expect(parseImageTransform({ mode: "crop", rect: { x: "a" } })).toBeNull();
  });
});

describe("printer presets", () => {
  it("printer 2 lands on card aspect (the bleed-crop's whole point)", () => {
    const p2 = PRINTER_PRESETS.printer2;
    // On the historical ~815×1125 scans the P2 box is (46,43)-(769,1082).
    const aspect = (p2.width * 815) / (p2.height * 1125);
    expect(Math.abs(aspect - CARD_IMAGE_ASPECT)).toBeLessThan(0.01);
  });
});
