import { describe, it, expect } from "vitest";
import {
  cardApplicability, isStatBearing, validate, BRIGADES, cardRawText, deriveAlignmentFromTypes,
  multiBrigadeSide, toggleMultiBrigade, brigadeLabels,
} from "../designCard";

const ALL_GOOD = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"] as const;
const ALL_EVIL = ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"] as const;

// A printed "Multi" card is every brigade of its alignment; the forge stores the full list.
describe("Multi brigade", () => {
  it("names the alignment whose every brigade is selected, in any order", () => {
    expect(multiBrigadeSide([...ALL_GOOD].reverse())).toBe("Good");
    expect(multiBrigadeSide([...ALL_EVIL, "Blue"])).toBe("Evil");
    expect(multiBrigadeSide(ALL_GOOD.slice(1))).toBeNull(); // Clay..White, no Blue
    expect(multiBrigadeSide(["Crimson", "EvilGold", "Gray"])).toBeNull();
    expect(multiBrigadeSide([])).toBeNull();
  });

  it("toggling Multi on adds the missing brigades of that alignment, keeping the rest", () => {
    expect(toggleMultiBrigade(["Green", "Brown"], "Good")).toEqual(
      ["Green", "Brown", "Blue", "Clay", "GoodGold", "Purple", "Red", "Silver", "Teal", "White"],
    );
    expect(toggleMultiBrigade(undefined, "Evil")).toEqual(
      ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"],
    );
  });

  it("toggling Multi off clears that alignment's brigades and nothing else", () => {
    expect(toggleMultiBrigade([...ALL_EVIL, "Teal"], "Evil")).toEqual(["Teal"]);
  });

  it("labels a full set as one Multi entry for the details summary", () => {
    expect(brigadeLabels([...ALL_GOOD])).toEqual(["Good Multi"]);
    expect(brigadeLabels(["Brown", ...ALL_GOOD])).toEqual(["Good Multi", "Brown"]);
    expect(brigadeLabels(["Crimson", "EvilGold", "Gray"])).toEqual(["Crimson", "EvilGold", "Gray"]);
  });
});

describe("cardApplicability", () => {
  it("Hero requires brigade + stats", () => {
    const a = cardApplicability(["Hero"]);
    expect(a.brigades).toBe("required");
    expect(a.stats).toBe("required");
  });
  it("Artifact has no brigade/stats but requires ability", () => {
    const a = cardApplicability(["Artifact"]);
    expect(a.brigades).toBe("na");
    expect(a.stats).toBe("na");
    expect(a.specialAbility).toBe("required");
  });
  it("Site expects a brigade; Fortress treats it as optional", () => {
    expect(cardApplicability(["Site"]).brigades).toBe("required");
    expect(cardApplicability(["Fortress"]).brigades).toBe("optional");
  });
  it("dual-type unions field requirements (Hero/GE needs stats AND ability)", () => {
    const a = cardApplicability(["Hero", "GE"]);
    expect(a.stats).toBe("required");
    expect(a.specialAbility).toBe("required");
  });
});

describe("isStatBearing", () => {
  it("true for Hero/EvilCharacter, false for LostSoul", () => {
    expect(isStatBearing(["Hero"])).toBe(true);
    expect(isStatBearing(["EvilCharacter"])).toBe(true);
    expect(isStatBearing(["LostSoul"])).toBe(false);
  });
});

describe("validate (advisory only)", () => {
  it("hints a missing required field but never throws / blocks", () => {
    const hints = validate({ cardType: ["Hero"] }); // no brigade, no stats, no name
    expect(hints.some((h) => h.field === "brigades")).toBe(true);
    expect(Array.isArray(hints)).toBe(true);
  });
  it("returns no hints for an empty napkin card (zero required fields demanded)", () => {
    expect(validate({})).toEqual([]);
  });
});

describe("BRIGADES enum", () => {
  it("excludes the ambiguous Multi sentinels", () => {
    expect(BRIGADES).not.toContain("GoodMulti");
    expect(BRIGADES).not.toContain("EvilMulti");
  });
});

describe("deriveAlignmentFromTypes", () => {
  it("no types selected => leave unchanged (null)", () => {
    expect(deriveAlignmentFromTypes([])).toBeNull();
  });
  it("Hero => Good", () => {
    expect(deriveAlignmentFromTypes(["Hero"])).toBe("Good");
  });
  it("GE => Good", () => {
    expect(deriveAlignmentFromTypes(["GE"])).toBe("Good");
  });
  it("EvilCharacter => Evil", () => {
    expect(deriveAlignmentFromTypes(["EvilCharacter"])).toBe("Evil");
  });
  it("EE => Evil", () => {
    expect(deriveAlignmentFromTypes(["EE"])).toBe("Evil");
  });
  it("Hero + EvilCharacter => Good_Evil", () => {
    expect(deriveAlignmentFromTypes(["Hero", "EvilCharacter"])).toBe("Good_Evil");
  });
  it("Hero + Dominant => Good (ambiguous type ignored when a good type is present)", () => {
    expect(deriveAlignmentFromTypes(["Hero", "Dominant"])).toBe("Good");
  });
  it("Dominant alone => leave unchanged (null)", () => {
    expect(deriveAlignmentFromTypes(["Dominant"])).toBeNull();
  });
  it("Fortress + Site => leave unchanged (null)", () => {
    expect(deriveAlignmentFromTypes(["Fortress", "Site"])).toBeNull();
  });
});

describe("cardRawText", () => {
  it("prefers rawText when present", () => {
    expect(cardRawText({ rawText: "new body", specialAbility: "legacy" })).toBe("new body");
  });
  it("falls back to legacy specialAbility (pre-descope napkin cards)", () => {
    expect(cardRawText({ specialAbility: "legacy" })).toBe("legacy");
  });
  it("returns empty string when neither is set", () => {
    expect(cardRawText({})).toBe("");
  });
});
