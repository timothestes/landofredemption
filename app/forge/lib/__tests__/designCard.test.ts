import { describe, it, expect } from "vitest";
import {
  cardApplicability, isStatBearing, validate, BRIGADES, cardRawText, deriveAlignmentFromTypes,
  multiBrigadeSide, toggleMultiBrigade, brigadeLabels, printedName, brigadeSides, toggleCardType,
  type DesignCard,
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

describe("brigadeSides", () => {
  const BOTH = ["Good", "Evil"];

  it("offers a good type good brigades and an evil type evil ones", () => {
    expect(brigadeSides({ cardType: ["Hero"] })).toEqual(["Good"]);
    expect(brigadeSides({ cardType: ["GE"] })).toEqual(["Good"]);
    expect(brigadeSides({ cardType: ["Hero", "GE"] })).toEqual(["Good"]);
    expect(brigadeSides({ cardType: ["EvilCharacter"] })).toEqual(["Evil"]);
    expect(brigadeSides({ cardType: ["EE"] })).toEqual(["Evil"]);
    expect(brigadeSides({ cardType: ["EvilCharacter", "EE"] })).toEqual(["Evil"]);
  });

  it("offers both on a card with a good and an evil type, whatever its alignment says", () => {
    expect(brigadeSides({ cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil" })).toEqual(BOTH);
    expect(brigadeSides({ cardType: ["GE", "EE"], alignment: "Good_Evil" })).toEqual(BOTH);
    expect(brigadeSides({ cardType: ["GE", "EvilCharacter"] })).toEqual(BOTH);
    // The catalog files GE/EE as Neutral.
    expect(brigadeSides({ cardType: ["GE", "EE"], alignment: "Neutral" })).toEqual(BOTH);
    expect(brigadeSides({ cardType: ["GE", "EE"], alignment: "Good" })).toEqual(BOTH);
  });

  it("offers both once the alignment says Good/Evil, as a dual Dominant or a convertible character does", () => {
    expect(brigadeSides({ cardType: ["Dominant"], alignment: "Good_Evil" })).toEqual(BOTH);
    // Printed Evil Characters with a Hero side (filed "Gray (Red)") are two-box cards.
    expect(brigadeSides({ cardType: ["EvilCharacter"], alignment: "Good_Evil" })).toEqual(BOTH);
    expect(brigadeSides({ cardType: ["Hero"], alignment: "Good_Evil" })).toEqual(BOTH);
  });

  it("offers both when the type says nothing about alignment, or there is no type yet", () => {
    expect(brigadeSides({})).toEqual(BOTH);
    expect(brigadeSides({ cardType: [] })).toEqual(BOTH);
    for (const t of ["LostSoul", "Artifact", "Dominant", "Fortress", "Site", "City", "Curse", "Covenant"] as const) {
      expect(brigadeSides({ cardType: [t] })).toEqual(BOTH);
    }
  });

  it("lets a good or evil type decide beside a type that says nothing", () => {
    expect(brigadeSides({ cardType: ["Hero", "Fortress"] })).toEqual(["Good"]);
    expect(brigadeSides({ cardType: ["EvilCharacter", "Fortress"] })).toEqual(["Evil"]);
  });

  it("lets the types decide over a single alignment", () => {
    expect(brigadeSides({ cardType: ["Hero"], alignment: "Evil" })).toEqual(["Good"]);
    expect(brigadeSides({ cardType: ["Hero"], alignment: "Neutral" })).toEqual(["Good"]);
  });
});

describe("toggleCardType", () => {
  it("adds and removes the type, filling in the alignment", () => {
    expect(toggleCardType({}, "Hero")).toEqual({ cardType: ["Hero"], alignment: "Good" });
    expect(toggleCardType({ cardType: ["Hero"], alignment: "Good" }, "EvilCharacter"))
      .toEqual({ cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil" });
    expect(toggleCardType({ cardType: ["Hero"], alignment: "Good" }, "Hero")).toEqual({ cardType: [] });
  });

  it("does not clobber an alignment picked by hand", () => {
    expect(toggleCardType({ cardType: ["Dominant"], alignment: "Evil" }, "Hero")).toEqual({ cardType: ["Dominant", "Hero"] });
    expect(toggleCardType({ cardType: ["GE", "EE"], alignment: "Neutral" }, "Hero")).toEqual({ cardType: ["GE", "EE", "Hero"] });
  });

  it("clears the evil brigade when the evil type goes", () => {
    const card: DesignCard = { cardType: ["GE", "EE"], alignment: "Good_Evil", brigades: ["Purple", "Crimson"] };
    expect(toggleCardType(card, "EE")).toEqual({ cardType: ["GE"], alignment: "Good", brigades: ["Purple"] });
  });

  it("clears the good brigade when the good type goes", () => {
    const card: DesignCard = { cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil", brigades: ["Silver", "Crimson"] };
    expect(toggleCardType(card, "Hero")).toEqual({ cardType: ["EvilCharacter"], alignment: "Evil", brigades: ["Crimson"] });
  });

  it("clears it from a GE/EE card filed as Neutral too, leaving the alignment", () => {
    const card: DesignCard = { cardType: ["GE", "EE"], alignment: "Neutral", brigades: ["Purple", "Crimson"] };
    expect(toggleCardType(card, "EE")).toEqual({ cardType: ["GE"], brigades: ["Purple"] });
  });

  it("clears what no longer fits when a type is first chosen", () => {
    const card: DesignCard = { brigades: ["Silver", "Crimson"] };
    expect(toggleCardType(card, "Hero")).toEqual({ cardType: ["Hero"], alignment: "Good", brigades: ["Silver"] });
  });

  it("leaves brigades alone when the type no longer says anything", () => {
    const card: DesignCard = { cardType: ["Hero"], alignment: "Good", brigades: ["Silver"] };
    expect(toggleCardType(card, "Hero")).toEqual({ cardType: [] });
  });

  it("leaves brigades alone when adding the second alignment's type", () => {
    const card: DesignCard = { cardType: ["Hero"], alignment: "Good", brigades: ["Silver"] };
    expect(toggleCardType(card, "EvilCharacter")).toEqual({ cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil" });
  });

  it("keeps same-alignment brigades together", () => {
    const card: DesignCard = { cardType: ["Hero"], alignment: "Good", brigades: ["Silver", "Blue"] };
    expect(toggleCardType(card, "GE")).toEqual({ cardType: ["Hero", "GE"], alignment: "Good" });
  });

  it("keeps both sides on a card set to Good/Evil by hand", () => {
    const card: DesignCard = { cardType: ["EvilCharacter"], alignment: "Good_Evil", brigades: ["Gray", "Red"] };
    expect(toggleCardType(card, "Fortress")).toEqual({ cardType: ["EvilCharacter", "Fortress"] });
  });

  it("keeps a Multi card's set when its side still fits, and clears it when it does not", () => {
    const multi: DesignCard = { cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil", brigades: [...ALL_GOOD, "Crimson"] };
    expect(toggleCardType(multi, "EvilCharacter").brigades).toEqual([...ALL_GOOD]);
    expect(toggleCardType(multi, "Hero").brigades).toEqual(["Crimson"]);
  });

  it("does not touch the per-side class icon choices", () => {
    const card: DesignCard = { cardType: ["GE", "EE"], alignment: "Good_Evil", brigades: ["Green", "Gray"], class: ["Warrior"], warriorSide: "evil", territorySide: "both" };
    const patch = toggleCardType(card, "EE");
    expect(patch).not.toHaveProperty("warriorSide");
    expect(patch).not.toHaveProperty("territorySide");
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

describe("printedName", () => {
  it("drops the catalog's bracketed disambiguator and nothing else", () => {
    expect(printedName({ name: "Blood of the Lamb [EoT]" })).toBe("Blood of the Lamb");
    expect(printedName({ name: "The Depraved [Pale Green - EoT]" })).toBe("The Depraved");
    expect(printedName({ name: "Vultures [3 Birds]" })).toBe("Vultures");
    expect(printedName({ name: "Antipas, the Witness" })).toBe("Antipas, the Witness");
    expect(printedName({ name: "  Hades " })).toBe("Hades");
    expect(printedName({})).toBe("");
  });
  it("titles a Lost Soul just \"Lost Soul\"; its quoted word belongs to the identifier bubble", () => {
    expect(printedName({ name: 'Lost Soul "Again" [Revelation 10:11]', cardType: ["LostSoul"] })).toBe("Lost Soul");
    expect(printedName({ name: "Lost Soul", cardType: ["LostSoul"] })).toBe("Lost Soul");
    // a Lost Soul a designer named something else keeps that name
    expect(printedName({ name: "Wandering Sheep [EoT]", cardType: ["LostSoul"] })).toBe("Wandering Sheep");
    // and a non-Lost-Soul called that keeps its whole name
    expect(printedName({ name: 'Lost Soul "Again"', cardType: ["Hero"] })).toBe('Lost Soul "Again"');
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
