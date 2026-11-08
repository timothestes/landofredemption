import { describe, it, expect } from "vitest";
import { designCardToCard, designCardSearchFields, forgeDataLine, isForgeCard, isForgeDataLine, cardIdFromDataLine } from "../deckAdapter";
import type { Card } from "@/app/decklist/card-search/utils";
import type { DesignCard } from "../designCard";

describe("isForgeCard", () => {
  const designed = designCardToCard({ name: "Invented Forge Hero", cardType: ["Hero"] }, "abc", "Invented Set");

  it("is true for a card straight from the adapter", () => {
    expect(isForgeCard(designed)).toBe(true);
  });

  it("is true for a pool card, whose imgFile is stamped with the same marker", () => {
    expect(isForgeCard({ ...designed, imgFile: forgeDataLine("abc") })).toBe(true);
  });

  it("is true for a saved card the deck can no longer resolve, which keeps only imgFile", () => {
    expect(isForgeCard({ dataLine: "", imgFile: forgeDataLine("abc") } as Card)).toBe(true);
  });

  it("is false for public cards, including one with no resolved catalog row", () => {
    expect(isForgeCard({ dataLine: "Invented Public Hero|AA|Invented Public Hero (AA)", imgFile: "Invented Public Hero (AA)" } as Card)).toBe(false);
    expect(isForgeCard({ dataLine: "", imgFile: "" } as Card)).toBe(false);
    expect(isForgeCard({ dataLine: "Forge Master|AA|forge", imgFile: "forge" } as Card)).toBe(false);
  });

  it("does not throw on a localStorage draft card missing the fields", () => {
    expect(isForgeCard({ name: "Invented Public Hero" } as Card)).toBe(false);
  });
});

describe("designCardToCard", () => {
  it("maps a Lost Soul so validateDeck's type check matches", () => {
    const d: DesignCard = { name: "The Wait", cardType: ["LostSoul"] };
    const c = designCardToCard(d, "abc", "Test Set");
    expect(c.type.toLowerCase()).toContain("lost soul");
    expect(c.dataLine).toBe("forge:abc");
    expect(c.set).toBe("Forge");
    expect(c.officialSet).toBe("Test Set");
  });

  it("emits GE/EE as the abbreviation (matching public cards) so they group together", () => {
    // Public card data stores type "GE"/"EE"; a forge card must match or deck
    // views that group on the raw type string render two separate buckets.
    expect(designCardToCard({ name: "G", cardType: ["GE"] }, "g1", "S").type).toBe("GE");
    expect(designCardToCard({ name: "E", cardType: ["EE"] }, "e1", "S").type).toBe("EE");
    // Dual GE/EE joins the two abbreviations, like the public "GE/EE".
    expect(designCardToCard({ name: "D", cardType: ["GE", "EE"] }, "d1", "S").type).toBe("GE/EE");
  });

  it("maps Good_Evil alignment to 'Good/Evil' and GoodGold brigade to 'Good Gold'", () => {
    const d: DesignCard = { name: "X", cardType: ["Hero"], alignment: "Good_Evil", brigades: ["GoodGold", "PaleGreen"] };
    const c = designCardToCard(d, "id1", "S");
    expect(c.alignment).toBe("Good/Evil");
    expect(c.brigade).toBe("Good Gold/Pale Green");
  });

  it("renders null stats as em-dash", () => {
    const d: DesignCard = { name: "Y", cardType: ["Dominant"], strength: null, toughness: null };
    const c = designCardToCard(d, "id2", "S");
    expect(c.strength).toBe("—");
    expect(c.toughness).toBe("—");
    expect(c.type.toLowerCase()).toContain("dominant");
  });

  it("folds Territory/Star/Cloud icons into the class string so the class filters match", () => {
    // Regression: the deckbuilder's Territory/Warrior/Weapon-Class filters all read
    // a single combined `class` string — public data keeps Warrior/Weapon AND the
    // Territory/Star/Cloud icons together there. The forge model splits `class`
    // (Warrior/Weapon) from `icons` (Territory/Star/Cloud), so the adapter must
    // recombine them (like the Lackey export) or forge Territory Class cards are
    // invisible to the Territory Class selector.
    const territory: DesignCard = { name: "Hope", cardType: ["Hero"], icons: ["Territory"] };
    expect(designCardToCard(territory, "t1", "EoT").class).toContain("Territory");

    const both: DesignCard = { name: "Mixed", cardType: ["Hero"], class: ["Warrior"], icons: ["Star"] };
    const mixed = designCardToCard(both, "m1", "EoT").class;
    expect(mixed).toContain("Warrior");
    expect(mixed).toContain("Star");

    // No class/icons → empty string (unchanged).
    expect(designCardToCard({ name: "Plain", cardType: ["Hero"] }, "p1", "S").class).toBe("");
  });

  it("defaults an unset legality to 'Rotation' but preserves an explicit choice", () => {
    const unset: DesignCard = { name: "New", cardType: ["Hero"] };
    expect(designCardToCard(unset, "id3", "S").legality).toBe("Rotation");
    const banned: DesignCard = { name: "Old", cardType: ["Hero"], legality: "Banned" };
    expect(designCardToCard(banned, "id4", "S").legality).toBe("Banned");
  });

  it("derives testament/isGospel from the scripture reference (not hardcoded empty)", () => {
    // Regression: an EoT Lost Soul with a New-Testament reference must come out
    // as N.T. so it matches the deckbuilder's testament filter. Before the fix
    // the adapter hardcoded testament: "" and the card never showed under N.T.
    const nt: DesignCard = { name: 'Lost Soul "Forsaken"', cardType: ["LostSoul"], reference: "Hebrews 10:25" };
    expect(designCardToCard(nt, "ls1", "EoT").testament).toBe("NT");

    const ot: DesignCard = { name: "Aimless", cardType: ["LostSoul"], reference: "Exodus 14:3" };
    expect(designCardToCard(ot, "ls2", "EoT").testament).toBe("OT");

    // A Gospel reference sets isGospel.
    const gospel: DesignCard = { name: "Parable", cardType: ["GE"], reference: "Matthew 13:3" };
    const g = designCardToCard(gospel, "g1", "S");
    expect(g.testament).toBe("NT");
    expect(g.isGospel).toBe(true);

    // No reference → empty testament (unchanged behavior).
    expect(designCardToCard({ name: "Z", cardType: ["Hero"] }, "z1", "S").testament).toBe("");
  });

  it("prefers rawText over a stale specialAbility, falling back when rawText is absent", () => {
    // Regression: designCardToCard must read via cardRawText (rawText-first) so a
    // stale legacy specialAbility can't shadow a newer rawText edit (Heavenly
    // Temple bug, 2026-07-06).
    const both: DesignCard = { name: "A", cardType: ["Hero"], rawText: "new text", specialAbility: "old text" };
    expect(designCardToCard(both, "a1", "S").specialAbility).toBe("new text");

    const legacyOnly: DesignCard = { name: "B", cardType: ["Hero"], specialAbility: "legacy" };
    expect(designCardToCard(legacyOnly, "b1", "S").specialAbility).toBe("legacy");
  });

  it("dataLine helpers round-trip", () => {
    const dl = forgeDataLine("uuid-9");
    expect(isForgeDataLine(dl)).toBe(true);
    expect(isForgeDataLine("Angel|Pa|Angel_(Pa)")).toBe(false);
    expect(cardIdFromDataLine(dl)).toBe("uuid-9");
  });
});

describe("designCardSearchFields", () => {
  it("derives the in-game deck-search fields from a DesignCard", () => {
    // These are the fields the in-game Search Deck modal filters on. They must
    // survive into play so alignment/brigade/identifier/reference searches match
    // forge cards (regression: evil forge cards were unsearchable by alignment).
    const d: DesignCard = {
      name: "Wormwood", cardType: ["EvilCharacter"], alignment: "Evil",
      brigades: ["Gray"], strength: 7, toughness: 6,
      identifiers: ["Demon", "Fallen Angel"], reference: "Revelation 8:11",
    };
    const f = designCardSearchFields(d);
    expect(f.alignment).toBe("Evil");
    expect(f.brigade).toBe("Gray");
    expect(f.strength).toBe("7");
    expect(f.toughness).toBe("6");
    expect(f.identifier).toBe("Demon, Fallen Angel");
    expect(f.reference).toBe("Revelation 8:11");
  });

  it("maps Good_Evil/GoodGold to display strings and blanks unset fields with '' (game convention, not em-dash)", () => {
    const f = designCardSearchFields({ name: "X", cardType: ["Hero"], alignment: "Good_Evil", brigades: ["GoodGold"] });
    expect(f.alignment).toBe("Good/Evil");
    expect(f.brigade).toBe("Good Gold");
    // Public cards serialize missing stats as "" for play; forge must match so
    // the two never diverge in the deck-search grid.
    expect(f.strength).toBe("");
    expect(f.toughness).toBe("");
    expect(f.identifier).toBe("");
    expect(f.reference).toBe("");
  });
});
