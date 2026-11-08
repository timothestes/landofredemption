import { describe, it, expect } from "vitest";
import {
  parseCarddata, findImageEntry, lackeyRowToDesignCard,
} from "@/app/forge/lib/lackey";

const HEADER =
  "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";

function row(overrides: Partial<Record<string, string>> = {}): string {
  const cols: Record<string, string> = {
    Name: "Test Hero", Set: "TST", ImageFile: "Test-Hero", OfficialSet: "Test Set",
    Type: "Hero", Brigade: "Silver", Strength: "9", Toughness: "9", Class: "Warrior",
    Identifier: "-", SpecialAbility: "Test ability.", Rarity: "-",
    Reference: "Genesis 1:1", Sound: "-", Alignment: "Good", Legality: "Rotation",
    ...overrides,
  };
  return [
    cols.Name, cols.Set, cols.ImageFile, cols.OfficialSet, cols.Type, cols.Brigade,
    cols.Strength, cols.Toughness, cols.Class, cols.Identifier, cols.SpecialAbility,
    cols.Rarity, cols.Reference, cols.Sound, cols.Alignment, cols.Legality,
  ].join("\t");
}

describe("parseCarddata", () => {
  it("parses rows from a headered TSV", () => {
    const rows = parseCarddata([HEADER, row()].join("\n"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Test Hero");
    expect(rows[0].set).toBe("TST");
    expect(rows[0].imageFile).toBe("Test-Hero");
    expect(rows[0].specialAbility).toBe("Test ability.");
  });
  it("tolerates CRLF, trailing tabs, and skips blank/nameless lines", () => {
    const text = [HEADER, row() + "\t\t\t\t", "", "\t\t\t"].join("\r\n");
    expect(parseCarddata(text)).toHaveLength(1);
  });
  it("strips .jpg/.jpeg from ImageFile", () => {
    const rows = parseCarddata([HEADER, row({ ImageFile: "Test-Hero.JPG" })].join("\n"));
    expect(rows[0].imageFile).toBe("Test-Hero");
  });
  it("throws when required columns are missing", () => {
    expect(() => parseCarddata("Foo\tBar\nx\ty")).toThrow(/missing/i);
  });
});

describe("findImageEntry", () => {
  const r = parseCarddata([HEADER, row()].join("\n"))[0];
  const entries = [
    "Test Plugin V1/sets/setimages/general/Test-Hero.jpg",
    "Test Plugin V1/sets/setimages/general/Another-Test-Hero.jpg",
    "Test Plugin V1/packs/Test-Hero.jpg",
  ];
  it("finds the image under sets/setimages/general at any depth, case-insensitively", () => {
    expect(findImageEntry(r, entries)).toBe("Test Plugin V1/sets/setimages/general/Test-Hero.jpg");
    expect(findImageEntry({ ...r, imageFile: "test-hero" }, entries))
      .toBe("Test Plugin V1/sets/setimages/general/Test-Hero.jpg");
  });
  it("does not suffix-match a longer filename or other dirs", () => {
    expect(findImageEntry({ ...r, imageFile: "Hero" }, entries)).toBeNull();
  });
  it("returns null when missing or imageFile empty", () => {
    expect(findImageEntry({ ...r, imageFile: "Nope" }, entries)).toBeNull();
    expect(findImageEntry({ ...r, imageFile: "" }, entries)).toBeNull();
  });
});

describe("lackeyRowToDesignCard", () => {
  const parse = (o: Partial<Record<string, string>>) =>
    lackeyRowToDesignCard(parseCarddata([HEADER, row(o)].join("\n"))[0]);

  it("maps a full hero row", () => {
    const c = parse({});
    expect(c.name).toBe("Test Hero");
    expect(c.rawText).toBe("Test ability.");
    expect(c.specialAbility).toBe("Test ability.");
    expect(c.cardType).toEqual(["Hero"]);
    expect(c.brigades).toEqual(["Silver"]);
    expect(c.strength).toBe(9);
    expect(c.toughness).toBe(9);
    expect(c.class).toEqual(["Warrior"]);
    expect(c.alignment).toBe("Good");
    expect(c.legality).toBe("Rotation");
    expect(c.reference).toBe("Genesis 1:1");
    expect(c.rarity).toBeUndefined();
    expect(c.identifiers).toBeUndefined();
  });
  it("maps long-form and dual types", () => {
    expect(parse({ Type: "Evil Character" }).cardType).toEqual(["EvilCharacter"]);
    expect(parse({ Type: "Good Enhancement / Evil Enhancement" }).cardType).toEqual(["GE", "EE"]);
    expect(parse({ Type: "GE/EE" }).cardType).toEqual(["GE", "EE"]);
    expect(parse({ Type: "Lost Soul" }).cardType).toEqual(["LostSoul"]);
    expect(parse({ Type: "Evil Dominant / Artifact" }).cardType).toEqual(["Dominant", "Artifact"]);
    expect(parse({ Type: "Weird Unknown" }).cardType).toBeUndefined();
  });
  it("maps multi and parenthetical brigades, dropping unknowns", () => {
    expect(parse({ Brigade: "Pale Green" }).brigades).toEqual(["PaleGreen"]);
    expect(parse({ Brigade: "Good Gold" }).brigades).toEqual(["GoodGold"]);
    expect(parse({ Brigade: "Crimson/Orange/Pale Green" }).brigades).toEqual(["Crimson", "Orange", "PaleGreen"]);
    expect(parse({ Brigade: "Purple (Crimson)" }).brigades).toEqual(["Purple", "Crimson"]);
    // The three brigades added later than the rest of this map, so a
    // regression in BRIGADE_MAP can't slip through as "unknown, dropped".
    expect(parse({ Brigade: "Red" }).brigades).toEqual(["Red"]);
    expect(parse({ Brigade: "Teal" }).brigades).toEqual(["Teal"]);
    expect(parse({ Brigade: "Evil Gold" }).brigades).toEqual(["EvilGold"]);
    expect(parse({ Brigade: "Mauve" }).brigades).toBeUndefined();
    expect(parse({ Brigade: "-" }).brigades).toBeUndefined();
  });
  it("maps '-' stats to absent and Territory class to icons", () => {
    const c = parse({ Strength: "-", Toughness: "", Class: "Territory" });
    expect(c.strength).toBeUndefined();
    expect(c.toughness).toBeUndefined();
    expect(c.class).toBeUndefined();
    expect(c.icons).toEqual(["Territory"]);
  });
  it("maps alignments incl. Good/Evil and splits identifiers", () => {
    expect(parse({ Alignment: "Good/Evil" }).alignment).toBe("Good_Evil");
    expect(parse({ Alignment: "Neutral" }).alignment).toBe("Neutral");
    expect(parse({ Identifier: "Demon, Giant" }).identifiers).toEqual(["Demon", "Giant"]);
  });
  it("omits unknown legality and '-' fields", () => {
    const c = parse({ Legality: "Whatever", SpecialAbility: "-", Reference: "-" });
    expect(c.legality).toBeUndefined();
    expect(c.rawText).toBeUndefined();
    expect(c.specialAbility).toBeUndefined();
    expect(c.reference).toBeUndefined();
  });
});
