import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseCsv, parseXlsx, detectColumns, tableToCards, findLooseImageEntry,
  type ColumnMapping,
} from "@/app/forge/lib/spreadsheet";
import { auditLackeyRow, type LackeyRow } from "@/app/forge/lib/lackey";

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  it("parses quoted fields with commas, escaped quotes, and newlines", () => {
    const text =
      'Name,Special Ability\n' +
      '"King\'s Sword","If an Evil Character is blocking, you may add up to 3 angels to battle."\n' +
      'Plain,"He said ""go"" and\nleft."\n';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual([
      "King's Sword",
      "If an Evil Character is blocking, you may add up to 3 angels to battle.",
    ]);
    expect(rows[2]).toEqual(["Plain", 'He said "go" and\nleft.']);
  });

  it("handles CRLF, a UTF-8 BOM, and drops fully-empty trailing rows", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n,\r\n\r\n");
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["1", "2"]);
    // the ",\r\n" row is empty cells but still a row; the final blank line is not
    expect(rows).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// parseXlsx — fixture built exactly like Google Sheets/Excel structure the parts
// ---------------------------------------------------------------------------

const WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets>' +
  '<sheet state="visible" name="End of Times" sheetId="1" r:id="rId5"/>' +
  '<sheet state="visible" name="Roots 2" sheetId="2" r:id="rId6"/>' +
  "</sheets></workbook>";

const RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId3" Type="http://x/sharedStrings" Target="sharedStrings.xml"/>' +
  '<Relationship Id="rId5" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId6" Type="http://x/worksheet" Target="worksheets/sheet2.xml"/>' +
  "</Relationships>";

// Index:            0        1              2 (rich-text runs)        3
const SST_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">' +
  "<si><t>Name</t></si>" +
  "<si><t>Alpha &amp; Omega</t></si>" +
  "<si><r><t>Two</t></r><r><t xml:space=\"preserve\"> Runs</t></r></si>" +
  "<si><t>Strength</t></si>" +
  "</sst>";

// Row 1: A=Name(s), B=Strength(s) — header. Row 2: shared string + number.
// Row 3: sparse (only C has an inline string); B is a self-closing empty cell.
const SHEET1_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>3</v></c></row>' +
  '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>9.0</v></c></row>' +
  '<row r="3"><c r="B3"/><c r="C3" t="inlineStr"><is><t>inline &lt;x&gt;</t></is></c></row>' +
  "</sheetData></worksheet>";

const SHEET2_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="str"><v>formula result</v></c></row>' +
  "</sheetData></worksheet>";

function buildXlsx(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(WORKBOOK_XML),
    "xl/_rels/workbook.xml.rels": strToU8(RELS_XML),
    "xl/sharedStrings.xml": strToU8(SST_XML),
    "xl/worksheets/sheet1.xml": strToU8(SHEET1_XML),
    "xl/worksheets/sheet2.xml": strToU8(SHEET2_XML),
  }, { level: 0 });
}

describe("parseXlsx", () => {
  it("returns sheets in workbook order with their names", () => {
    const sheets = parseXlsx(buildXlsx());
    expect(sheets.map((s) => s.name)).toEqual(["End of Times", "Roots 2"]);
  });

  it("reads shared strings, numbers, inline strings, and leaves gaps empty", () => {
    const [s1] = parseXlsx(buildXlsx());
    expect(s1.rows[0]).toEqual(["Name", "Strength"]);
    expect(s1.rows[1]).toEqual(["Alpha & Omega", "9.0"]);
    // sparse row: A missing → "", B empty cell → "", C inline string (entities unescaped)
    expect(s1.rows[2]).toEqual(["", "", "inline <x>"]);
  });

  it("joins rich-text runs and reads formula string results", () => {
    const [, s2] = parseXlsx(buildXlsx());
    expect(s2.rows[0]).toEqual(["Two Runs", "formula result"]);
  });

  it("throws a clear error on a zip that is not an xlsx", () => {
    const notXlsx = zipSync({ "readme.txt": strToU8("hi") }, { level: 0 });
    expect(() => parseXlsx(notXlsx)).toThrow(/xlsx/i);
  });

  it("throws a clear error on bytes that are not a zip at all", () => {
    expect(() => parseXlsx(strToU8("definitely,a,csv"))).toThrow(/xlsx/i);
  });

  it("keeps row positions across self-closing <row/> elements (Excel styled-empty rows)", () => {
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>' +
      '<row r="2" ht="24" customHeight="1"/>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>RowThree</t></is></c></row>' +
      "</sheetData></worksheet>";
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    }, { level: 0 });
    const [s] = parseXlsx(xlsx);
    expect(s.rows).toEqual([["Name"], [], ["RowThree"]]);
  });

  it("reads single-quoted XML attributes (legal OOXML, uncommon writers)", () => {
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8("<workbook><sheets><sheet name='Solo' r:id='rId1'/></sheets></workbook>"),
      "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Id='rId1' Target='worksheets/sheet1.xml'/></Relationships>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'),
    }, { level: 0 });
    const sheets = parseXlsx(xlsx);
    expect(sheets[0].name).toBe("Solo");
    expect(sheets[0].rows).toEqual([["7"]]);
  });
});

// ---------------------------------------------------------------------------
// detectColumns — both real-world header conventions
// ---------------------------------------------------------------------------

describe("detectColumns", () => {
  it("maps Lackey-style headers with trailing colons (End of Times sheet)", () => {
    const { mapping, ignored } = detectColumns([
      "#:", "Name:", "Set:", "Image:", "Official Set:", "Type:", "Brigade:",
      "Strength:", "Toughness:", "Class:", "Identifier:", "Special Ability:",
      "Rarity:", "Reference:", "Sound:", "Alignment:", "Legality:",
    ]);
    expect(mapping.name).toBe(1);
    expect(mapping.image).toBe(3);
    expect(mapping.type).toBe(5);
    expect(mapping.brigade).toBe(6);
    expect(mapping.strength).toBe(7);
    expect(mapping.toughness).toBe(8);
    expect(mapping.class).toBe(9);
    expect(mapping.identifier).toBe(10);
    expect(mapping.specialAbility).toBe(11);
    expect(mapping.rarity).toBe(12);
    expect(mapping.reference).toBe(13);
    expect(mapping.alignment).toBe(15);
    expect(mapping.legality).toBe(16);
    expect(mapping.book).toBeUndefined();
    // "#:", "Set:", "Official Set:", "Sound:" are recognized-but-unused → not ignored noise
    expect(ignored).toEqual([]);
  });

  it("maps split Book/Chapter/Verse + Artist headers (Roots 2 sheet)", () => {
    const { mapping, ignored } = detectColumns([
      "Name", "#", "Set", "Type", "Brigade", "Strength", "Toughness", "Class",
      "Identifier", "Special Ability", "Rarity", "Book", "Chapter", "Verse",
      "Alignment", "Legality", "Artist", "Image",
    ]);
    expect(mapping.name).toBe(0);
    expect(mapping.book).toBe(11);
    expect(mapping.chapter).toBe(12);
    expect(mapping.verse).toBe(13);
    expect(mapping.artist).toBe(16);
    expect(mapping.image).toBe(17);
    expect(mapping.reference).toBeUndefined();
    expect(ignored).toEqual([]);
  });

  it("reports unrecognized headers as ignored column indexes", () => {
    const { mapping, ignored } = detectColumns(["Name", "Flavor Text", ""]);
    expect(mapping.name).toBe(0);
    expect(ignored).toEqual([1]); // empty headers are not reported
  });

  it("keeps the first column when two headers normalize identically", () => {
    const { mapping } = detectColumns(["Name", "name:"]);
    expect(mapping.name).toBe(0);
  });

  it("maps Align and Brigade Color aliases", () => {
    const { mapping, ignored } = detectColumns(["Name", "Align", "Brigade Color"]);
    expect(mapping.alignment).toBe(1);
    expect(mapping.brigade).toBe(2);
    expect(ignored).toEqual([]);
  });

  it("maps common alignment header spellings", () => {
    expect(detectColumns(["Name", "Side"]).mapping.alignment).toBe(1);
    expect(detectColumns(["Name", "Good/Evil"]).mapping.alignment).toBe(1);
    expect(detectColumns(["Name", "Alignment (Good/Evil)"]).mapping.alignment).toBe(1);
    expect(detectColumns(["Name", "Good Evil"]).mapping.alignment).toBe(1);
  });

  it("maps common brigade/color header spellings", () => {
    expect(detectColumns(["Name", "Colors"]).mapping.brigade).toBe(1);
    expect(detectColumns(["Name", "Color"]).mapping.brigade).toBe(1);
    expect(detectColumns(["Name", "Brigade Colour"]).mapping.brigade).toBe(1);
  });

  it("falls back to a contains match for creatively-worded headers", () => {
    const { mapping, ignored } = detectColumns(["Name", "Card Alignment", "Brigade(s) / Color"]);
    expect(mapping.alignment).toBe(1);
    expect(mapping.brigade).toBe(2);
    expect(ignored).toEqual([]);
  });

  it("reports a second column for the same field as a duplicate, not ignored", () => {
    const { mapping, duplicates, ignored } = detectColumns(["Name", "Alignment", "Align"]);
    expect(mapping.alignment).toBe(1);
    expect(duplicates).toEqual([{ field: "alignment", index: 2 }]);
    expect(ignored).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tableToCards — cleaning, reference synthesis, warnings, dedupe
// ---------------------------------------------------------------------------

const R2_HEADER = [
  "Name", "#", "Set", "Type", "Brigade", "Strength", "Toughness", "Class",
  "Identifier", "Special Ability", "Rarity", "Book", "Chapter", "Verse",
  "Alignment", "Legality", "Artist", "Image",
];

function r2Mapping(): ColumnMapping {
  return detectColumns(R2_HEADER).mapping;
}

describe("tableToCards", () => {
  it("builds a DesignCard from a real Roots 2 style row", () => {
    const rows = [
      R2_HEADER,
      ["King's Sword [RR2]", "225", "Redemption Roots 2", "Dominant", "-", "-", "-", "-", "-",
        "If an Evil Character is blocking, you may add up to 3 angels to battle.",
        "-", "Revelation", "19", "15", "Good", "Rotation", "Doug Gray", "225-Kings-Sword"],
    ];
    const { cards, skipped, duplicates } = tableToCards(rows, r2Mapping());
    expect(skipped).toBe(0);
    expect(duplicates).toEqual([]);
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.name).toBe("King's Sword [RR2]");
    expect(c.imageFile).toBe("225-Kings-Sword");
    expect(c.warnings).toEqual([]);
    expect(c.snapshot.cardType).toEqual(["Dominant"]);
    expect(c.snapshot.alignment).toBe("Good");
    expect(c.snapshot.legality).toBe("Rotation");
    expect(c.snapshot.reference).toBe("Revelation 19:15");
    expect(c.snapshot.artistCredit).toBe("Doug Gray");
    expect(c.snapshot.rawText).toMatch(/^If an Evil Character/);
    expect(c.snapshot.brigades).toBeUndefined();
  });

  it("synthesizes the reference from Book/Chapter/Verse pieces", () => {
    const mk = (book: string, ch: string, v: string) => {
      const row = ["X", "", "", "", "", "", "", "", "", "", "", book, ch, v, "", "", "", ""];
      return tableToCards([R2_HEADER, row], r2Mapping()).cards[0].snapshot.reference;
    };
    expect(mk("Psalm", "23", "")).toBe("Psalm 23");
    expect(mk("Psalm", "", "")).toBe("Psalm");
    expect(mk("", "1", "2")).toBeUndefined();
    // xlsx numeric cells arrive as "19.0" — cleaned to integers
    expect(mk("Revelation", "19.0", "15.0")).toBe("Revelation 19:15");
  });

  it("prefers a combined Reference column over Book/Chapter/Verse", () => {
    const header = ["Name", "Reference", "Book", "Chapter", "Verse"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["X", "John 3:16", "Genesis", "1", "1"]], mapping,
    );
    expect(cards[0].snapshot.reference).toBe("John 3:16");
  });

  it("cleans dash placeholders and float-formatted stats", () => {
    const header = ["Name", "Type", "Brigade", "Strength", "Toughness", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Hero Guy", "Hero", "Blue", "9.0", "7", "Good"]], mapping,
    );
    expect(cards[0].snapshot.strength).toBe(9);
    expect(cards[0].snapshot.toughness).toBe(7);
    const dashes = tableToCards([header, ["Art Guy", "Artifact", "—", "-", "-", "Good"]], mapping);
    expect(dashes.cards[0].snapshot.brigades).toBeUndefined();
    expect(dashes.cards[0].snapshot.strength).toBeUndefined();
    expect(dashes.cards[0].warnings).toEqual([]);
  });

  it('maps "Dual-Alignment Enhancement" to GE + EE with no warning', () => {
    const header = ["Name", "Type", "Brigade", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Philosophy [RR2]", "Dual-Alignment Enhancement", "Purple/Crimson", "Good/Evil"]], mapping,
    );
    expect(cards[0].warnings).toEqual([]);
    expect(cards[0].snapshot.cardType).toEqual(["GE", "EE"]);
    expect(cards[0].snapshot.alignment).toBe("Good_Evil");
    expect(cards[0].snapshot.brigades).toEqual(["Purple", "Crimson"]);
  });

  it('accepts paired dual-side stats like "6 (0)", normalized to "N (M)"', () => {
    const header = ["Name", "Type", "Brigade", "Strength", "Toughness"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([
      header,
      ["Spiritual Warfare [RR2]", "Dual-Alignment Enhancement", "Purple", "6 (0)", "0 (6)"],
      ["Philosophy [RR2]", "Dual-Alignment Enhancement", "Purple", "3(2)", "2(3)"],
    ], mapping);
    expect(cards[0].warnings).toEqual([]);
    expect(cards[0].snapshot.strength).toBe("6 (0)");
    expect(cards[0].snapshot.toughness).toBe("0 (6)");
    expect(cards[1].warnings).toEqual([]);
    expect(cards[1].snapshot.strength).toBe("3 (2)"); // tight spelling normalizes
    expect(cards[1].snapshot.toughness).toBe("2 (3)");
  });

  it('accepts "X" as a valid variable strength/toughness (The Faithful Followers)', () => {
    const header = ["Name", "Type", "Brigade", "Strength", "Toughness"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["The Faithful Followers", "Hero", "Green", "X", "x"]], mapping,
    );
    expect(cards[0].warnings).toEqual([]);
    expect(cards[0].snapshot.strength).toBe("X");
    expect(cards[0].snapshot.toughness).toBe("X");
  });

  it("skips rows without a name and dedupes repeated names (first wins)", () => {
    const header = ["Name", "Type"];
    const { mapping } = detectColumns(header);
    const { cards, skipped, duplicates } = tableToCards([
      header,
      ["Alpha", "Hero"],
      ["", "Hero"],
      ["-", "Hero"],
      ["Alpha", "Artifact"],
    ], mapping);
    expect(cards).toHaveLength(1);
    expect(cards[0].snapshot.cardType).toEqual(["Hero"]);
    expect(skipped).toBe(2);
    expect(duplicates).toEqual(["Alpha"]);
  });

  it("warns on unrecognized types, brigades, alignments, legalities, and stats", () => {
    const header = ["Name", "Type", "Brigade", "Strength", "Alignment", "Legality"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Oops", "Herro", "Vermilion", "lots", "Sideways", "Casual"]], mapping,
    );
    const w = cards[0].warnings.join(" | ");
    expect(w).toMatch(/Herro/);
    expect(w).toMatch(/Vermilion/);
    expect(w).toMatch(/lots/);
    expect(w).toMatch(/Sideways/);
    expect(w).toMatch(/Casual/);
    // unrecognized values are dropped from the snapshot, not imported as garbage
    expect(cards[0].snapshot.cardType).toBeUndefined();
    expect(cards[0].snapshot.brigades).toBeUndefined();
    expect(cards[0].snapshot.alignment).toBeUndefined();
    expect(cards[0].snapshot.legality).toBeUndefined();
  });

  it("reports 1-based spreadsheet row numbers (header is row 1)", () => {
    const header = ["Name"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([header, ["A"], ["B"]], mapping);
    expect(cards.map((c) => c.rowIndex)).toEqual([2, 3]);
  });

  it("derives alignment from card type when there is no Alignment column", () => {
    const header = ["Name", "Type", "Brigade"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([
      header,
      ["H1", "Hero", "Blue"],
      ["H2", "GE", "Purple"],
      ["H3", "Evil Character", "Black"],
      ["H4", "EE", "Gray"],
    ], mapping);
    expect(cards.map((c) => c.snapshot.alignment)).toEqual(["Good", "Good", "Evil", "Evil"]);
    expect(cards.every((c) => c.warnings.length === 0)).toBe(true);
  });

  it("leaves alignment unset and warns when the card type doesn't imply one", () => {
    const header = ["Name", "Type", "Brigade"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([header, ["Relic", "Artifact", "-"]], mapping);
    expect(cards[0].snapshot.alignment).toBeUndefined();
    expect(cards[0].warnings.join(" | ")).toMatch(/no alignment/);
  });

  it('resolves a bare "Gold" brigade from an explicit Alignment column', () => {
    const header = ["Name", "Type", "Brigade", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([
      header,
      ["Aaron", "Hero", "Gold", "Good"],
      ["Pharaoh", "Evil Character", "Gold", "Evil"],
    ], mapping);
    expect(cards[0].snapshot.brigades).toEqual(["GoodGold"]);
    expect(cards[0].warnings).toEqual([]);
    expect(cards[1].snapshot.brigades).toEqual(["EvilGold"]);
    expect(cards[1].warnings).toEqual([]);
  });

  it('resolves a bare "Gold" brigade from the derived card-type alignment', () => {
    const header = ["Name", "Type", "Brigade"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([header, ["Aaron", "Hero", "Gold"]], mapping);
    expect(cards[0].snapshot.brigades).toEqual(["GoodGold"]);
    expect(cards[0].warnings).toEqual([]);
  });

  it('warns on a "Gold" brigade with no alignment to resolve it', () => {
    const header = ["Name", "Type", "Brigade"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([header, ["Chorazin", "Site", "Gold"]], mapping);
    expect(cards[0].snapshot.brigades).toBeUndefined();
    expect(cards[0].warnings.join(" | ")).toMatch(/ambiguous brigade "Gold"/);
  });

  it("recognizes alignment-only header spellings for Good/Evil dual cards", () => {
    const header = ["Name", "Type", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards([
      header,
      ["A", "Dominant", "G/E"],
      ["B", "Dominant", "dual"],
      ["C", "Dominant", "Good & Evil"],
      ["D", "Dominant", "good-evil"],
    ], mapping);
    expect(cards.map((c) => c.snapshot.alignment)).toEqual(["Good_Evil", "Good_Evil", "Good_Evil", "Good_Evil"]);
    expect(cards.every((c) => c.warnings.length === 0)).toBe(true);
  });

  it("splits a brigade cell on commas and ampersands as well as slashes", () => {
    const header = ["Name", "Type", "Brigade", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Multi Guy", "Hero", "Purple, Crimson & Gray", "Good"]], mapping,
    );
    expect(cards[0].snapshot.brigades).toEqual(["Purple", "Crimson", "Gray"]);
    expect(cards[0].warnings).toEqual([]);
  });

  it('maps "Multi" to every brigade of the row\'s alignment', () => {
    const header = ["Name", "Type", "Brigade", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Legion", "Evil Character", "Multi", "Evil"]], mapping,
    );
    expect(cards[0].snapshot.brigades).toEqual(
      ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"],
    );
    expect(cards[0].warnings).toEqual([]);
  });

  it('still warns on "Multi" when the row is neither Good nor Evil', () => {
    const header = ["Name", "Type", "Brigade", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["The Ends of the Earth", "Site", "Multi", "Neutral"]], mapping,
    );
    expect(cards[0].snapshot.brigades).toBeUndefined();
    expect(cards[0].warnings.join(" | ")).toMatch(/Multi/);
  });

  it("warns when a brigade-required type has no Brigade column", () => {
    const header = ["Name", "Type", "Alignment"];
    const { mapping } = detectColumns(header);
    const { cards } = tableToCards(
      [header, ["Nameless Hero", "Hero", "Good"]], mapping,
    );
    expect(cards[0].warnings.join(" | ")).toMatch(/no brigade/);
  });
});

// ---------------------------------------------------------------------------
// auditLackeyRow — the warning source lives beside the lackey maps
// ---------------------------------------------------------------------------

describe("auditLackeyRow", () => {
  const base: LackeyRow = {
    name: "X", set: "", imageFile: "", officialSet: "", type: "", brigade: "",
    strength: "", toughness: "", class: "", identifier: "", specialAbility: "",
    rarity: "", reference: "", alignment: "", legality: "",
  };

  it("is silent on a fully-valid row", () => {
    expect(auditLackeyRow({
      ...base, type: "Hero", brigade: "Blue (Good Gold)", strength: "9",
      toughness: "9", class: "Warrior/Star", alignment: "Good", legality: "Rotation",
    })).toEqual([]);
  });

  it("is silent on empty and dash-only cells", () => {
    expect(auditLackeyRow({ ...base, type: "-", brigade: "-" })).toEqual([]);
  });

  it("flags each unrecognized token but keeps valid siblings quiet", () => {
    const warnings = auditLackeyRow({ ...base, type: "Hero/Villain", brigade: "Blue/Vermilion" });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/Villain/);
    expect(warnings[1]).toMatch(/Vermilion/);
  });

  it("flags unknown class tokens", () => {
    const warnings = auditLackeyRow({ ...base, class: "Warrior/Wizard" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Wizard/);
  });

  it('is silent on "X" and paired stats, but still flags junk', () => {
    expect(auditLackeyRow({ ...base, strength: "X", toughness: "x" })).toEqual([]);
    expect(auditLackeyRow({ ...base, strength: "6 (0)", toughness: "X (6)" })).toEqual([]);
    expect(auditLackeyRow({ ...base, strength: "6 (a)" })).toHaveLength(1);
  });

  it("warns when a brigade-required type's Brigade cell is empty or a dash", () => {
    const warnings = auditLackeyRow({ ...base, type: "Hero", brigade: "-", alignment: "Good" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no brigade/);
  });

  it("doesn't warn about a missing brigade for a type that doesn't require one", () => {
    expect(auditLackeyRow({ ...base, type: "Dominant", brigade: "-", alignment: "Good" })).toEqual([]);
  });

  it("warns when a type's alignment can't be derived and none was given", () => {
    const warnings = auditLackeyRow({ ...base, type: "Artifact" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no alignment/);
  });

  it("is silent when brigade and derivable alignment are both present", () => {
    expect(auditLackeyRow({ ...base, type: "Hero", brigade: "Blue" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findLooseImageEntry — flat images zip with macOS junk
// ---------------------------------------------------------------------------

describe("findLooseImageEntry", () => {
  const entries = [
    "225-Kings-Sword.png",
    "__MACOSX/._225-Kings-Sword.png",
    "nested/dir/226-Spreading-Mildew.JPG",
    "._227-Altar-of-Ahaz.png",
    "227-Altar-of-Ahaz.webp",
    "228-End-of-Times.tif",
    "229-Roots-Two.TIFF",
    "not-an-image.txt",
  ];

  it("matches a flat entry by base name, case-insensitively", () => {
    expect(findLooseImageEntry("225-Kings-Sword", entries)).toBe("225-Kings-Sword.png");
    expect(findLooseImageEntry("225-KINGS-SWORD", entries)).toBe("225-Kings-Sword.png");
  });

  it("matches nested entries and alternate extensions", () => {
    expect(findLooseImageEntry("226-Spreading-Mildew", entries)).toBe("nested/dir/226-Spreading-Mildew.JPG");
    expect(findLooseImageEntry("227-Altar-of-Ahaz", entries)).toBe("227-Altar-of-Ahaz.webp");
  });

  it("tolerates the column already including an extension", () => {
    expect(findLooseImageEntry("225-Kings-Sword.png", entries)).toBe("225-Kings-Sword.png");
  });

  it("matches TIFF entries (.tif and .tiff, case-insensitively)", () => {
    expect(findLooseImageEntry("228-End-of-Times", entries)).toBe("228-End-of-Times.tif");
    expect(findLooseImageEntry("229-Roots-Two", entries)).toBe("229-Roots-Two.TIFF");
  });

  it("never matches __MACOSX or AppleDouble entries, and returns null when absent", () => {
    expect(findLooseImageEntry("missing", entries)).toBeNull();
    expect(findLooseImageEntry("", entries)).toBeNull();
  });
});
