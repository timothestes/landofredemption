import { describe, it, expect } from "vitest";
import { previewColumns } from "../previewColumns";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { GOOD_BRIGADES } from "@/app/forge/lib/designCard";
import { detectColumns, parseCsv, tableToCards } from "@/app/forge/lib/spreadsheet";

const value = (card: DesignCard, key: string) => {
  const col = previewColumns([card]).find((c) => c.key === key);
  return col?.value(card);
};

describe("previewColumns (U-55)", () => {
  it("shows only the fields this file carries", () => {
    const cols = previewColumns([
      { name: "A", cardType: ["Hero"], strength: 5 },
      { name: "B", reference: "Judges 7:20" },
    ]);
    expect(cols.map((c) => c.key)).toEqual(["type", "strength", "reference"]);
  });

  it("shows nothing but the name for a name-only file", () => {
    expect(previewColumns([{ name: "A" }])).toEqual([]);
  });

  it("spells types and brigades the way people read them", () => {
    expect(value({ cardType: ["EvilCharacter", "LostSoul"] }, "type")).toBe("Evil Character / Lost Soul");
    expect(value({ brigades: ["PaleGreen", "EvilGold"] }, "brigade")).toBe("Pale Green, Evil Gold");
    expect(value({ brigades: [...GOOD_BRIGADES] }, "brigade")).toBe("Good Multi");
    expect(value({ alignment: "Good_Evil" }, "alignment")).toBe("Good/Evil");
  });

  it("keeps a stat of 0 and a variable stat", () => {
    expect(value({ strength: 0 }, "strength")).toBe("0");
    expect(value({ toughness: "X" }, "toughness")).toBe("X");
    expect(value({ strength: "6 (0)" }, "strength")).toBe("6 (0)");
  });

  it("drops a column whose only value is an empty stat", () => {
    expect(previewColumns([{ strength: null }]).map((c) => c.key)).toEqual([]);
  });

  it("puts class and icons in one column, as the sheet's Class cell does", () => {
    expect(value({ class: ["Warrior"], icons: ["Territory"] }, "class")).toBe("Warrior, Territory");
  });

  it("reads ability text the way the studio does", () => {
    expect(value({ rawText: "Studio text", specialAbility: "Old text" }, "ability")).toBe("Studio text");
    expect(value({ specialAbility: "Old text" }, "ability")).toBe("Old text");
  });

  it("shows what a real sheet parses to, and leaves a value it couldn't read blank", () => {
    const rows = parseCsv([
      "Name,Type,Brigade,Strength,Toughness,Class,Identifier,Special Ability,Reference,Rarity,Legality,Artist",
      "Invented Hero,Hero,Blue,7,5,Warrior,Soldier,Do a thing,Judges 7:20,Rare,Rotation,Someone",
      "Invented Typo,Heroo,Blue,abc,5,,,,,,,",
    ].join("\n"));
    const { cards } = tableToCards(rows, detectColumns(rows[0]).mapping);
    const cols = previewColumns(cards.map((c) => c.snapshot));
    const read = (i: number) => Object.fromEntries(cols.map((c) => [c.key, c.value(cards[i].snapshot)]));
    expect(read(0)).toMatchObject({
      type: "Hero", brigade: "Blue", strength: "7", toughness: "5", class: "Warrior", identifiers: "Soldier",
      ability: "Do a thing", reference: "Judges 7:20", rarity: "Rare", legality: "Rotation", artist: "Someone",
    });
    expect(read(1)).toMatchObject({ type: "", strength: "", toughness: "5" });
    expect(cards[1].warnings.length).toBeGreaterThan(0);
  });
});
