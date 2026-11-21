import { describe, expect, it } from "vitest";
import type { DeckSnapshotCard } from "../deckSubmission";
import { DEFAULT_VIEW_PREFS, groupCards, parseViewPrefs, type ResolvedCard } from "../submissionView";

const card = (name: string, quantity = 1, set = "X"): DeckSnapshotCard => ({ name, set, imgFile: null, quantity, zone: "main" });
const FACTS: Record<string, ResolvedCard> = {
  Moses: { type: "Hero", brigade: "Gold", alignment: "Good", officialSet: "Cloud of Witnesses" },
  Gideon: { type: "Hero", brigade: "Gold", alignment: "Good", officialSet: "Judges" },
  Legion: { type: "Evil Character", brigade: "Orange", alignment: "Evil", officialSet: "Roots" },
  "Son of God": { type: "Dominant", brigade: "", alignment: "Good", officialSet: "Promo" },
  "Three Woes": { type: "Dominant", brigade: "", alignment: "Neutral", officialSet: "Revelation of John" },
};
const resolve = (c: DeckSnapshotCard) => FACTS[c.name];
const cards = [card("Moses"), card("Legion", 3), card("Son of God"), card("Gideon", 2), card("Three Woes"), card("Mystery")];
const shape = (g: { label: string; cards: DeckSnapshotCard[] }[]) => g.map((x) => [x.label, x.cards.map((c) => c.name)]);

describe("parseViewPrefs", () => {
  it("defaults to card art, grouped by type", () => {
    expect(DEFAULT_VIEW_PREFS.view).toBe("images");
    expect(parseViewPrefs(null)).toEqual(DEFAULT_VIEW_PREFS);
    expect(parseViewPrefs("not json")).toEqual(DEFAULT_VIEW_PREFS);
    expect(parseViewPrefs("[1]")).toEqual(DEFAULT_VIEW_PREFS);
  });

  it("keeps the stored choices and drops one that is no longer an option", () => {
    expect(parseViewPrefs(JSON.stringify({ view: "list", group: "brigade", sort: "set", size: "large" })))
      .toEqual({ view: "list", group: "brigade", sort: "set", size: "large" });
    expect(parseViewPrefs(JSON.stringify({ view: "table", group: "brigade", sort: 5 })))
      .toEqual({ ...DEFAULT_VIEW_PREFS, group: "brigade" });
  });
});

describe("groupCards", () => {
  it("groups by type, alphabetical with unknown cards last", () => {
    expect(shape(groupCards(cards, { group: "type", sort: "name" }, resolve))).toEqual([
      ["Dominant", ["Son of God", "Three Woes"]],
      ["Evil Character", ["Legion"]],
      ["Hero", ["Gideon", "Moses"]],
      ["Other", ["Mystery"]],
    ]);
  });

  it("spells out the two types the catalog abbreviates", () => {
    const two = [card("A"), card("B")];
    const types: Record<string, string> = { A: "GE", B: "EE" };
    expect(groupCards(two, { group: "type", sort: "name" }, (c) => ({ type: types[c.name] })).map((g) => g.label))
      .toEqual(["Evil Enhancement", "Good Enhancement"]);
  });

  it("groups by alignment in Good, Evil, Neutral order", () => {
    expect(groupCards(cards, { group: "alignment", sort: "name" }, resolve).map((g) => g.label))
      .toEqual(["Good", "Evil", "Neutral", "Other"]);
  });

  it("groups by brigade, and a card without one by its type", () => {
    expect(groupCards(cards, { group: "brigade", sort: "name" }, resolve).map((g) => g.label))
      .toEqual(["Dominant", "Gold", "Orange", "Other"]);
  });

  it("one unlabelled group when grouping is off", () => {
    const g = groupCards(cards, { group: "none", sort: "quantity" }, resolve);
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("");
    expect(g[0].cards.map((c) => c.name).slice(0, 3)).toEqual(["Legion", "Gideon", "Moses"]);
  });

  it("sorts by set, then name", () => {
    const g = groupCards(cards, { group: "none", sort: "set" }, resolve)[0].cards.map((c) => c.name);
    expect(g).toEqual(["Moses", "Gideon", "Son of God", "Three Woes", "Legion", "Mystery"]);
  });
});
