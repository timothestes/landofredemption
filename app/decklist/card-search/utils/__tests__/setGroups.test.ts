import { describe, expect, it } from "vitest";
import type { DeckCard } from "../../types/deck";
import { groupDeckCardsBySet, sortDeckCardsBySet } from "../setGroups";

function entry(
  name: string,
  officialSet: string,
  over: { set?: string; type?: string; quantity?: number } = {},
): DeckCard {
  return {
    card: {
      name,
      officialSet,
      set: over.set ?? officialSet,
      type: over.type ?? "Artifact",
      brigade: "",
      alignment: "",
      strength: "",
      toughness: "",
      reference: "",
    },
    quantity: over.quantity ?? 1,
    zone: "main",
  } as DeckCard;
}

describe("groupDeckCardsBySet", () => {
  it("makes one group per official set, A to Z", () => {
    const groups = groupDeckCardsBySet([
      entry("Third", "Warriors"),
      entry("First", "Apostles"),
      entry("Second", "Priests"),
    ]);
    expect(groups.map((g) => g.set)).toEqual(["Apostles", "Priests", "Warriors"]);
  });

  it("keeps set codes that share an official set together", () => {
    const groups = groupDeckCardsBySet([
      entry("One", "Promo", { set: "Pmo-P1" }),
      entry("Two", "Promo", { set: "Pmo-P2" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards).toHaveLength(2);
  });

  it("lists a set's cards in print order, not by name alone", () => {
    const [group] = groupDeckCardsBySet([
      entry("Aaron", "Priests", { type: "Hero" }),
      entry("Zeal", "Priests", { type: "Dominant" }),
      entry("Manna", "Priests", { type: "Artifact" }),
    ]);
    expect(group.cards.map((dc) => dc.card.name)).toEqual(["Zeal", "Manna", "Aaron"]);
  });

  it("counts copies, not rows", () => {
    const [group] = groupDeckCardsBySet([
      entry("Lamp", "Priests", { quantity: 3 }),
      entry("Ark", "Priests"),
    ]);
    expect(group.count).toBe(4);
  });

  it("falls back to the set code, then to Unknown set", () => {
    const groups = groupDeckCardsBySet([
      entry("Missing", "", { set: "XYZ" }),
      entry("Nothing", "", { set: "" }),
    ]);
    expect(groups.map((g) => g.set)).toEqual(["Unknown set", "XYZ"]);
  });
});

describe("sortDeckCardsBySet", () => {
  it("orders a flat list the same way the groups read, without mutating it", () => {
    const cards = [entry("B", "Warriors"), entry("A", "Apostles")];
    expect(sortDeckCardsBySet(cards).map((dc) => dc.card.name)).toEqual(["A", "B"]);
    expect(cards.map((dc) => dc.card.name)).toEqual(["B", "A"]);
  });
});
