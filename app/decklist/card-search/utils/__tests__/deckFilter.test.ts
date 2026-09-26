import { describe, it, expect } from "vitest";
import { filterDeckCards } from "../deckFilter";
import type { DeckCard, DeckZone } from "../../types/deck";
import type { Card } from "../../utils";

function dc(over: Partial<Card>, quantity = 1, zone: DeckZone = "main"): DeckCard {
  const card = {
    name: "",
    set: "",
    imgFile: "",
    officialSet: "",
    type: "",
    brigade: "",
    strength: "",
    toughness: "",
    class: "",
    identifier: "",
    specialAbility: "",
    rarity: "",
    reference: "",
    alignment: "",
    legality: "",
    ...over,
  } as Card;
  return { card, quantity, zone };
}

const foulSpirit = dc(
  {
    name: "Foul Spirit",
    type: "Evil Character",
    brigade: "Orange",
    alignment: "Evil",
    specialAbility: "Discard a Hero in battle.",
  },
  2,
  "main",
);
const lyingSpirit = dc({
  name: "Lying Spirit",
  type: "Evil Character",
  brigade: "Orange",
  alignment: "Evil",
  specialAbility: "Negate a good Enhancement.",
});
const angel = dc({
  name: "Angel of the Lord",
  type: "Hero",
  brigade: "Silver",
  alignment: "Good",
  specialAbility: "Draw 2 cards. You may discard an evil card in play.",
});
const evangelist = dc({
  name: "Evangelist",
  type: "Hero",
  brigade: "Purple",
  alignment: "Good",
  specialAbility: "Draw 2 cards.",
});
const wages = dc(
  {
    name: "The Wages of Sin (FoM)",
    set: "FoM",
    officialSet: "Fall of Man",
    type: "EE",
    brigade: "Black/Crimson/Orange",
    alignment: "Evil",
    specialAbility:
      "You may take an evil card that has a discard ability from deck or Reserve.",
  },
  1,
  "reserve",
);
const noah = dc({
  name: "Noah, the Righteous",
  type: "Hero",
  alignment: "Good",
  identifier: "Flood Survivor, Patriarch",
});
const chariots = dc({
  name: "Pharaoh’s Chariots",
  type: "EE",
  alignment: "Evil",
});

const deck: DeckCard[] = [foulSpirit, lyingSpirit, angel, evangelist, wages, noah, chariots];
const names = (cards: DeckCard[]) => cards.map((c) => c.card.name);

describe("filterDeckCards", () => {
  it("returns the input array untouched for an empty or blank query", () => {
    expect(filterDeckCards(deck, "")).toBe(deck);
    expect(filterDeckCards(deck, "   ")).toBe(deck);
  });

  it("matches special-ability text case-insensitively", () => {
    expect(names(filterDeckCards(deck, "DISCARD"))).toEqual([
      "Foul Spirit",
      "Angel of the Lord",
      "The Wages of Sin (FoM)",
    ]);
  });

  it("ANDs multiple words across all searchable fields", () => {
    // "evil" comes from the alignment field, "discard" from the ability.
    expect(names(filterDeckCards(deck, "evil discard"))).toEqual([
      "Foul Spirit",
      "Angel of the Lord", // its ability text mentions "evil card"
      "The Wages of Sin (FoM)",
    ]);
    expect(names(filterDeckCards(deck, "orange discard"))).toEqual(["Foul Spirit", "The Wages of Sin (FoM)"]);
    expect(filterDeckCards(deck, "orange draw")).toEqual([]);
  });

  it("treats a quoted phrase as a whole-word match", () => {
    expect(names(filterDeckCards(deck, '"Angel"'))).toEqual(["Angel of the Lord"]);
    expect(names(filterDeckCards(deck, "Angel"))).toEqual(["Angel of the Lord", "Evangelist"]);
    expect(names(filterDeckCards(deck, '"draw 2"'))).toEqual(["Angel of the Lord", "Evangelist"]);
    expect(filterDeckCards(deck, '"raw"')).toEqual([]);
  });

  it("normalizes curly quotes and apostrophes to straight ones", () => {
    expect(names(filterDeckCards(deck, "“Angel”"))).toEqual(["Angel of the Lord"]);
    expect(names(filterDeckCards(deck, "pharaoh's"))).toEqual(["Pharaoh’s Chariots"]);
  });

  it("searches type, brigade, set, and the enriched identifier", () => {
    expect(names(filterDeckCards(deck, "crimson"))).toEqual(["The Wages of Sin (FoM)"]);
    expect(names(filterDeckCards(deck, "fall of man"))).toEqual(["The Wages of Sin (FoM)"]);
    expect(names(filterDeckCards(deck, "evil character"))).toEqual(["Foul Spirit", "Lying Spirit"]);
    // Flood survivors are tagged Antediluvian by searchableIdentifier.
    expect(names(filterDeckCards(deck, "antediluvian"))).toEqual(["Noah, the Righteous"]);
  });

  it("keeps the original DeckCard objects, quantities, and zones", () => {
    const result = filterDeckCards(deck, "wages");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(wages);
    expect(result[0].quantity).toBe(1);
    expect(result[0].zone).toBe("reserve");
  });
});
