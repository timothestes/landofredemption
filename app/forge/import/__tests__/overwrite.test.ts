import { describe, it, expect } from "vitest";
import { overwriteConfirmCopy, overwritePatch, summarizeOverwritePreview } from "../overwrite";
import { isEmptyPatch } from "@/app/forge/lib/cardSave";
import { lackeyDerivedFields, lackeyRowToDesignCard, parseCarddata } from "@/app/forge/lib/lackey";
import { detectColumns, parseCsv, tableToCards } from "@/app/forge/lib/spreadsheet";
import type { DesignCard } from "@/app/forge/lib/designCard";

describe("overwritePatch (U-02)", () => {
  const card: DesignCard = {
    name: "Card", rawText: "Old text", cardType: ["Hero"], alignment: "Good_Evil", brigades: ["Silver"],
    strength: 8, toughness: 6, class: ["Warrior"], reference: "Judges 7:20", scripture: "A typed verse",
    artistCredit: "An artist", warriorSide: "good",
  };

  it("leaves every field the row doesn't carry alone, and never removes", () => {
    const patch = overwritePatch(card, { name: "Card", rawText: "New text", specialAbility: "New text" });
    expect(patch).toEqual({ set: { rawText: "New text", specialAbility: "New text" }, remove: [] });
  });

  it("is empty when the row matches", () => {
    expect(isEmptyPatch(overwritePatch(card, { name: "Card", strength: 8, brigades: ["Silver"] }))).toBe(true);
  });

  it("never writes the name, which is what matched the row to the card", () => {
    expect(overwritePatch({ name: " Card " }, { name: "Card" }).set).toEqual({});
  });

  it("skips the fields the parser filled in on its own", () => {
    const row: DesignCard = { name: "Card", cardType: ["Hero"], alignment: "Good" };
    expect(overwritePatch(card, row, ["alignment"]).set).toEqual({});
    expect(overwritePatch(card, row).set).toEqual({ alignment: "Good" });
  });

  it("counts zero as a value", () => {
    expect(overwritePatch(card, { name: "Card", strength: 0 }).set).toEqual({ strength: 0 });
  });

  it("is unchanged when the text matches, though the legacy field has drifted or is absent", () => {
    const row: DesignCard = { name: "Card", rawText: "Old text", specialAbility: "Old text" };
    expect(isEmptyPatch(overwritePatch(card, row))).toBe(true);
    expect(isEmptyPatch(overwritePatch({ ...card, specialAbility: "Stale" }, row))).toBe(true);
  });

  it("is unchanged when the text only lives in the legacy field", () => {
    const row: DesignCard = { name: "Card", rawText: "Old text", specialAbility: "Old text" };
    expect(isEmptyPatch(overwritePatch({ name: "Card", specialAbility: "Old text" }, row))).toBe(true);
  });

  it("keeps the legacy field in step when the text does change", () => {
    const row: DesignCard = { name: "Card", rawText: "New", specialAbility: "New" };
    expect(overwritePatch(card, row).set).toEqual({ rawText: "New", specialAbility: "New" });
  });

  describe("from a spreadsheet", () => {
    function rowsFrom(csv: string) {
      const table = parseCsv(csv);
      return tableToCards(table, detectColumns(table[0]).mapping).cards;
    }

    it("a two-column sheet touches only its text", () => {
      const [row] = rowsFrom("Name,Special Ability\nCard,New text\n");
      expect(overwritePatch(card, row.snapshot, row.derived).set)
        .toEqual({ rawText: "New text", specialAbility: "New text" });
    });

    it("a blank cell in a mapped column leaves the value alone", () => {
      const [row] = rowsFrom("Name,Strength,Toughness,Reference,Artist\nCard,,7,-,\n");
      expect(overwritePatch(card, row.snapshot, row.derived).set).toEqual({ toughness: 7 });
    });

    it("a type column doesn't drag in an alignment the sheet never gave", () => {
      const [row] = rowsFrom("Name,Type\nCard,Hero\n");
      expect(row.snapshot.alignment).toBe("Good");   // a new card still gets it
      expect(overwritePatch(card, row.snapshot, row.derived).set).toEqual({});
    });

    it("a blank cell in a mapped Alignment column is also left alone", () => {
      const [row] = rowsFrom("Name,Type,Alignment\nCard,Hero,\n");
      expect(overwritePatch(card, row.snapshot, row.derived).set).toEqual({});
    });

    it("an Alignment the sheet does give is written", () => {
      const [row] = rowsFrom("Name,Type,Alignment\nCard,Hero,Good\n");
      expect(overwritePatch(card, row.snapshot, row.derived).set).toEqual({ alignment: "Good" });
    });

    it("a value the parser couldn't read leaves the card's value alone", () => {
      const [row] = rowsFrom("Name,Strength,Type\nCard,abc,Heroo\n");
      expect(overwritePatch(card, row.snapshot, row.derived).set).toEqual({});
    });

    it("an identical row is unchanged, including an xlsx-style 8.0 stat", () => {
      const [row] = rowsFrom("Name,Type,Brigade,Strength,Toughness,Class,Reference\nCard,Hero,Silver,8.0,6,Warrior,Judges 7:20\n");
      expect(isEmptyPatch(overwritePatch(card, row.snapshot, row.derived))).toBe(true);
    });
  });

  describe("from Lackey carddata text", () => {
    const header = "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";
    function rowFrom(cells: Partial<Record<string, string>>) {
      const line = header.split("\t").map((h) => cells[h] ?? "").join("\t");
      return parseCarddata(`${header}\n${line}\n`)[0];
    }

    it("blank cells leave values alone and a type doesn't imply an alignment", () => {
      const row = rowFrom({ Name: "Card", Set: "X", ImageFile: "x", Type: "Hero", Strength: "9" });
      expect(overwritePatch(card, lackeyRowToDesignCard(row), lackeyDerivedFields(row)).set).toEqual({ strength: 9 });
    });

    it("a dash is blank", () => {
      const row = rowFrom({ Name: "Card", Set: "X", ImageFile: "x", Rarity: "-", Reference: "-", Alignment: "-", Type: "Hero" });
      expect(overwritePatch(card, lackeyRowToDesignCard(row), lackeyDerivedFields(row)).set).toEqual({});
    });

    it("a file missing a column behaves as if the cell were blank", () => {
      const row = parseCarddata("Name\tSet\tImageFile\tRarity\nCard\tX\tx\tRare\n")[0];
      expect(overwritePatch(card, lackeyRowToDesignCard(row), lackeyDerivedFields(row)).set).toEqual({ rarity: "Rare" });
    });
  });
});

describe("summarizeOverwritePreview", () => {
  it("counts each row once, and an image makes an existing card change", () => {
    expect(summarizeOverwritePreview([
      { preview: "changed", hasImage: false },
      { preview: "changed", hasImage: true },
      { preview: "unchanged", hasImage: false },
      { preview: "unchanged", hasImage: false },
      { preview: "unchanged", hasImage: true },
      { preview: "new", hasImage: true },
      { preview: "new", hasImage: false },
    ])).toEqual({ changed: 3, unchanged: 2, created: 2, images: 2 });
  });

  it("leaves out a row the route refused, which fails at import with its own reason", () => {
    expect(summarizeOverwritePreview([{ hasImage: true }, { preview: "changed", hasImage: false }]))
      .toEqual({ changed: 1, unchanged: 0, created: 0, images: 0 });
  });
});

describe("overwriteConfirmCopy", () => {
  const copy = overwriteConfirmCopy;

  it("says how many existing cards will change, and matches the button to it", () => {
    const c = copy({ changed: 3, unchanged: 0, created: 0, images: 0 });
    expect(c.title).toBe("3 existing cards will change");
    expect(c.confirmLabel).toBe("Overwrite 3 cards");
  });

  it("is singular for one card", () => {
    const c = copy({ changed: 1, unchanged: 1, created: 1, images: 1 });
    expect(c.title).toBe("1 existing card will change");
    expect(c.confirmLabel).toBe("Overwrite 1 card");
    expect(c.notes).toContain("1 already matches this file and won\u2019t be touched.");
    expect(c.notes).toContain("1 new card will be added to the set.");
    expect(c.notes.join(" ")).toContain("1 gets the finished image from this file");
  });

  it("only mentions the unchanged, the new and the images when there are some", () => {
    const text = copy({ changed: 2, unchanged: 0, created: 0, images: 0 }).notes.join(" ");
    expect(text).not.toMatch(/matches|match this|added to the set|finished image/);
  });

  it("is plural for several", () => {
    const text = copy({ changed: 5, unchanged: 12, created: 2, images: 5 }).notes.join(" ");
    expect(text).toContain("12 already match this file and won\u2019t be touched.");
    expect(text).toContain("2 new cards will be added to the set.");
    expect(text).toContain("5 get the finished image from this file");
  });

  it("always says what blanks do, who sees it, and that it can't be undone", () => {
    const text = copy({ changed: 1, unchanged: 0, created: 0, images: 0 }).notes.join(" ");
    expect(text).toMatch(/Blank cells and columns not in this file leave/);
    expect(text).toMatch(/Playtesters see nothing until you release/);
    expect(text).toMatch(/no undo/i);
  });

  it("never promises a new version", () => {
    const text = JSON.stringify(copy({ changed: 9, unchanged: 9, created: 9, images: 9 }));
    expect(text).not.toMatch(/version/i);
  });
});
