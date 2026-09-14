import { describe, it, expect } from "vitest";
import { zipSync, unzipSync, strToU8 } from "fflate";
import {
  CARDDATA_HEADER, designCardToLackeyRow, serializeCarddata, imageFileSlug,
  parseCarddata, lackeyRowToDesignCard, findImageEntry,
} from "@/app/forge/lib/lackey";
import type { DesignCard } from "@/app/forge/lib/designCard";

// Round-trip a card through the exporter AND the real importer parser, returning the
// DesignCard the Forge would recreate on re-import.
function roundTrip(card: DesignCard, name = "Test Card"): DesignCard {
  const row = designCardToLackeyRow(card, {
    name, set: "TST", officialSet: "Test Set", imageFile: imageFileSlug(name),
  });
  const text = serializeCarddata([row]);
  const parsed = parseCarddata(text);
  expect(parsed).toHaveLength(1);
  return lackeyRowToDesignCard(parsed[0]);
}

describe("designCardToLackeyRow → serialize → parseCarddata round-trip", () => {
  it("recovers a full Hero", () => {
    const card: DesignCard = {
      name: "David",
      cardType: ["Hero"],
      brigades: ["Blue", "GoodGold"],
      strength: 5, toughness: 4,
      class: ["Warrior"], icons: ["Territory"],
      identifiers: ["King", "Judahite"],
      rawText: "Cannot be captured.", specialAbility: "Cannot be captured.",
      alignment: "Good", legality: "Rotation", rarity: "Rare", reference: "1 Samuel 16:13",
    };
    const back = roundTrip(card, "David");
    expect(back.name).toBe("David");
    expect(back.cardType).toEqual(["Hero"]);
    expect(back.brigades).toEqual(["Blue", "GoodGold"]);
    expect(back.strength).toBe(5);
    expect(back.toughness).toBe(4);
    expect(back.class).toEqual(["Warrior"]);
    expect(back.icons).toEqual(["Territory"]);
    expect(back.identifiers).toEqual(["King", "Judahite"]);
    expect(back.rawText).toBe("Cannot be captured.");
    expect(back.alignment).toBe("Good");
    expect(back.legality).toBe("Rotation");
    expect(back.rarity).toBe("Rare");
    expect(back.reference).toBe("1 Samuel 16:13");
  });

  it("recovers multi-word brigade/type and a Good/Evil dominant", () => {
    const card: DesignCard = {
      cardType: ["Dominant"],
      brigades: ["PaleGreen"],
      alignment: "Good_Evil",
      rawText: "Choose a character of opposite alignment.",
    };
    const back = roundTrip(card, "Armageddon");
    expect(back.cardType).toEqual(["Dominant"]);
    expect(back.brigades).toEqual(["PaleGreen"]);
    expect(back.alignment).toBe("Good_Evil");
  });

  it("recovers an Evil Character with negative-safe zero stats", () => {
    const card: DesignCard = {
      cardType: ["EvilCharacter"], brigades: ["Crimson"],
      strength: 0, toughness: 0, alignment: "Evil",
    };
    const back = roundTrip(card, "Statue");
    expect(back.cardType).toEqual(["EvilCharacter"]);
    expect(back.strength).toBe(0);
    expect(back.toughness).toBe(0);
  });

  it("omits stats entirely when null/absent", () => {
    const back = roundTrip({ cardType: ["Artifact"], rawText: "Do a thing." });
    expect(back.strength).toBeUndefined();
    expect(back.toughness).toBeUndefined();
  });

  it('round-trips variable "X" stats', () => {
    const back = roundTrip({
      cardType: ["Hero"], brigades: ["Green"], strength: "X", toughness: "X",
    }, "The Faithful Followers");
    expect(back.strength).toBe("X");
    expect(back.toughness).toBe("X");
  });

  it('round-trips paired dual-side stats ("6 (0)")', () => {
    const back = roundTrip({
      cardType: ["GE", "EE"], strength: "6 (0)", toughness: "0 (6)", alignment: "Good_Evil",
    }, "Spiritual Warfare");
    expect(back.cardType).toEqual(["GE", "EE"]);
    expect(back.strength).toBe("6 (0)");
    expect(back.toughness).toBe("0 (6)");
  });
});

describe("Multi brigade export", () => {
  const brigadeCell = (card: DesignCard) =>
    designCardToLackeyRow(card, { name: "M", set: "TST", officialSet: "Test Set", imageFile: "M" })[
      CARDDATA_HEADER.indexOf("Brigade")
    ];

  // The catalog spells these "Multi" (112 printed cards), and the deck builder expands it
  // back to every brigade of the card's alignment.
  it('writes every good brigade on a Good card as "Multi" and reads it back as the full set', () => {
    const card: DesignCard = {
      cardType: ["GE"], alignment: "Good",
      brigades: ["White", "Teal", "Silver", "Red", "Purple", "Green", "GoodGold", "Clay", "Blue"],
    };
    expect(brigadeCell(card)).toBe("Multi");
    expect(roundTrip(card, "Faith").brigades).toEqual(
      ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"],
    );
  });

  it('writes every evil brigade on an Evil card as "Multi" and reads it back as the full set', () => {
    const card: DesignCard = {
      cardType: ["EvilCharacter"], alignment: "Evil",
      brigades: ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"],
    };
    expect(brigadeCell(card)).toBe("Multi");
    expect(roundTrip(card, "Pagan Sailors").brigades).toEqual(
      ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"],
    );
  });

  // "Multi" means the card's own alignment; without a matching one the list is the only
  // unambiguous spelling.
  it("keeps the explicit list when the alignment does not match the full set", () => {
    const good = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"] as const;
    expect(brigadeCell({ cardType: ["GE"], brigades: [...good] }))
      .toBe("Blue/Clay/Good Gold/Green/Purple/Red/Silver/Teal/White");
    expect(brigadeCell({ cardType: ["GE"], alignment: "Evil", brigades: [...good] }))
      .toBe("Blue/Clay/Good Gold/Green/Purple/Red/Silver/Teal/White");
  });
});

describe("tsv safety", () => {
  it("strips tabs and newlines from ability text so the TSV can't break", () => {
    const row = designCardToLackeyRow(
      { cardType: ["GE"], rawText: "Line one.\tLine two.\nLine three." },
      { name: "Tabby", set: "TST", officialSet: "Test Set", imageFile: "Tabby" },
    );
    const abilityIdx = CARDDATA_HEADER.indexOf("SpecialAbility");
    expect(row[abilityIdx]).toBe("Line one. Line two. Line three.");
    // One card => exactly header + one data line, no stray rows from embedded newlines.
    expect(serializeCarddata([row]).trimEnd().split("\n")).toHaveLength(2);
  });
});

describe("export zip round-trips through the importer", () => {
  it("writes an ImageFile the importer's findImageEntry can resolve", () => {
    // Build a zip exactly like app/forge/api/export/route.ts does, then read it back
    // exactly like ImportWizard does — the ImageFile column must match the stored path.
    const title = "Alpha and Omega";
    const base = imageFileSlug(title);
    const row = designCardToLackeyRow(
      { cardType: ["Dominant"], alignment: "Good", rawText: "Do a thing." },
      { name: title, set: "EoT", officialSet: "End of Time", imageFile: base },
    );
    const zip = zipSync({
      "sets/carddata.txt": strToU8(serializeCarddata([row])),
      [`sets/setimages/general/${base}.jpg`]: new Uint8Array([1, 2, 3]),
    }, { level: 0 });

    // Importer side: collect entry names + parse carddata.
    const entries = unzipSync(zip);
    const entryNames = Object.keys(entries).filter((n) => !n.endsWith("/"));
    const parsed = parseCarddata(strFromEntry(entries["sets/carddata.txt"]));
    expect(parsed).toHaveLength(1);

    const found = findImageEntry(parsed[0], entryNames);
    expect(found).toBe("sets/setimages/general/Alpha-and-Omega.jpg");
  });
});

function strFromEntry(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

describe("imageFileSlug", () => {
  it("makes a filesystem-safe slug and falls back to 'card'", () => {
    expect(imageFileSlug("Alpha and Omega")).toBe("Alpha-and-Omega");
    expect(imageFileSlug("Whose Report?")).toBe("Whose-Report");
    expect(imageFileSlug("   ")).toBe("card");
  });
});
