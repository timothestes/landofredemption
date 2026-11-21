import { describe, expect, it } from "vitest";
import type { DeckSnapshotCard } from "../deckSubmission";
import { cleanSnapshotCards, SNAPSHOT_MAX_ROWS } from "../deckSubmission";
import {
  addCard, cardKeyOf, moveRow, parseCardKey, removeRow, replaceCard, rowIdOf, sameCards, setQuantity, zoneTotals,
} from "../snapshotEdit";

const card = (p: Partial<DeckSnapshotCard>): DeckSnapshotCard => ({ name: "Buckler (Roots)", set: "RR", imgFile: "001-Buckler", quantity: 1, zone: "main", ...p });
const GOC = "Legion of Angels (GoC)|GoC|124-Legion-of-Angels";

describe("snapshot edits", () => {
  it("a card key survives a pipe in the name and an empty image", () => {
    expect(parseCardKey("A|B|RR|img")).toEqual({ name: "A|B", set: "RR", imgFile: "img" });
    expect(parseCardKey("Name|Set|")).toEqual({ name: "Name", set: "Set", imgFile: null });
    expect(parseCardKey("no pipes")).toBeNull();
    expect(cardKeyOf(card({ imgFile: null }))).toBe("Buckler (Roots)|RR|");
  });

  it("sets a quantity, and zero removes the row", () => {
    const cards = [card({}), card({ name: "Other", imgFile: "o" })];
    expect(setQuantity(cards, rowIdOf(cards[0]), 3)[0].quantity).toBe(3);
    expect(setQuantity(cards, rowIdOf(cards[0]), 0).map((c) => c.name)).toEqual(["Other"]);
    expect(setQuantity(cards, rowIdOf(cards[0]), 500)[0].quantity).toBe(99);
    expect(removeRow(cards, rowIdOf(cards[1])).map((c) => c.name)).toEqual(["Buckler (Roots)"]);
  });

  it("moving a row joins the same printing already in that zone", () => {
    const cards = [card({ quantity: 2 }), card({ zone: "reserve" })];
    const moved = moveRow(cards, rowIdOf(cards[1]), "main");
    expect(moved).toEqual([card({ quantity: 3 })]);
    expect(zoneTotals(moved)).toEqual({ main: 3, reserve: 0 });
  });

  it("replacing a card keeps its zone, quantity and place", () => {
    const cards = [card({ name: "Legion of Angels", set: "I", imgFile: "Legion_of_Angels_(I)", quantity: 2, zone: "reserve" }), card({})];
    const next = replaceCard(cards, rowIdOf(cards[0]), GOC);
    expect(next[0]).toEqual({ name: "Legion of Angels (GoC)", set: "GoC", imgFile: "124-Legion-of-Angels", quantity: 2, zone: "reserve" });
    expect(next[1]).toEqual(cards[1]);
  });

  it("adding a card the list already has raises its row", () => {
    const cards = [card({})];
    expect(addCard(cards, cardKeyOf(cards[0]), "main")).toEqual([card({ quantity: 2 })]);
    expect(addCard(cards, GOC, "reserve", 2)).toHaveLength(2);
  });

  it("compares lists whatever their order", () => {
    const a = [card({}), card({ name: "Other", imgFile: "o", quantity: 2 })];
    expect(sameCards(a, [...a].reverse())).toBe(true);
    expect(sameCards(a, setQuantity(a, rowIdOf(a[0]), 2))).toBe(false);
    expect(sameCards(a, moveRow(a, rowIdOf(a[0]), "reserve"))).toBe(false);
  });
});

describe("cleanSnapshotCards", () => {
  it("takes the catalog's own name, set and image for a card it knows", () => {
    const out = cleanSnapshotCards([{ name: "Legion of Angels (GoC)", set: "GoC", imgFile: "124-Legion-of-Angels", quantity: 1, zone: "main" }]);
    expect(out).toEqual([{ name: "Legion of Angels (GoC)", set: "GoC", imgFile: "124-Legion-of-Angels", quantity: 1, zone: "main" }]);
  });

  it("merges rows of one printing in one zone, drops rows at zero and caps a quantity", () => {
    const row = { name: "Legion of Angels (GoC)", set: "GoC", imgFile: "124-Legion-of-Angels", zone: "main" };
    const out = cleanSnapshotCards([{ ...row, quantity: 1 }, { ...row, quantity: 2 }, { ...row, zone: "reserve", quantity: 0 }, { ...row, zone: "reserve", quantity: 1000 }])!;
    expect(out.map((c) => [c.zone, c.quantity])).toEqual([["main", 3], ["reserve", 99]]);
  });

  it("keeps a name the catalog does not have, for the deck check to report", () => {
    const out = cleanSnapshotCards([{ name: "  Not A Real Card  ", set: "X", imgFile: null, quantity: 1, zone: "main" }]);
    expect(out).toEqual([{ name: "Not A Real Card", set: "X", imgFile: null, quantity: 1, zone: "main" }]);
  });

  it("refuses anything that is not a card list", () => {
    const ok = { name: "Buckler (Roots)", set: "RR", imgFile: null, quantity: 1, zone: "main" };
    expect(cleanSnapshotCards(null)).toBeNull();
    expect(cleanSnapshotCards("cards")).toBeNull();
    expect(cleanSnapshotCards([null])).toBeNull();
    expect(cleanSnapshotCards([{ ...ok, zone: "maybeboard" }])).toBeNull();
    expect(cleanSnapshotCards([{ ...ok, quantity: "2" }])).toBeNull();
    expect(cleanSnapshotCards([{ ...ok, name: 5 }])).toBeNull();
    expect(cleanSnapshotCards([{ ...ok, name: "   " }])).toBeNull();
    expect(cleanSnapshotCards([{ ...ok, imgFile: 3 }])).toBeNull();
    expect(cleanSnapshotCards(Array.from({ length: SNAPSHOT_MAX_ROWS + 1 }, () => ok))).toBeNull();
    expect(cleanSnapshotCards([])).toEqual([]);
  });
});
