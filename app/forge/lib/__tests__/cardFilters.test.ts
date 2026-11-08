import { describe, it, expect } from "vitest";
import {
  parseCardFilters, filterQuery, gridHref, gridReturnY, cardMatchesFilters, visibleSetCards, walkSet, walkHint, NO_FILTERS,
  type CardFilters, type FilterableCard,
} from "../cardFilters";
import type { ReleaseInfo } from "../versions";

const f = (patch: Partial<CardFilters> = {}): CardFilters => ({ ...NO_FILTERS, ...patch });
const rel = (releasedAt: string): ReleaseInfo => ({ versionNumber: 1, releasedAt, status: "published" });

describe("parseCardFilters", () => {
  it("reads a URLSearchParams and a Next searchParams record the same way", () => {
    const want = f({ q: "angel wings", status: "draft", type: "EvilCharacter", brigade: "PaleGreen", since: "2026-10-01" });
    const query = "q=angel+wings&status=draft&type=EvilCharacter&brigade=PaleGreen&since=2026-10-01";
    expect(parseCardFilters(new URLSearchParams(query))).toEqual(want);
    expect(parseCardFilters({ q: "angel wings", status: "draft", type: "EvilCharacter", brigade: "PaleGreen", since: "2026-10-01" })).toEqual(want);
  });

  it("takes the first of a repeated key", () => {
    expect(parseCardFilters({ type: ["Hero", "GE"] }).type).toBe("Hero");
  });

  it("drops values that aren't real, so a stale link can't blank the grid or the select", () => {
    expect(parseCardFilters(new URLSearchParams("status=nope&type=Dragon&brigade=Plaid&since=soon"))).toEqual(NO_FILTERS);
    expect(parseCardFilters({ since: "2026-13-45" }).since).toBe("");
  });

  it("is empty for an empty URL", () => {
    expect(parseCardFilters({})).toEqual(NO_FILTERS);
    expect(parseCardFilters({ get: "not a function" })).toEqual(NO_FILTERS);
  });
});

describe("filterQuery", () => {
  it("is empty with no filters, so an unfiltered page keeps its plain URL", () => {
    expect(filterQuery(NO_FILTERS)).toBe("");
  });

  it("writes only what's set, in a stable order", () => {
    expect(filterQuery(f({ brigade: "Crimson", q: "x" }))).toBe("?q=x&brigade=Crimson");
  });

  it("round-trips through the URL, whatever is typed", () => {
    const all = f({ q: "a&b=c #d é", status: "playtesting", type: "LostSoul", brigade: "GoodGold", since: "2026-01-31" });
    expect(parseCardFilters(new URLSearchParams(filterQuery(all)))).toEqual(all);
  });
});

describe("gridHref", () => {
  it("goes back to the set's grid, with its filters, naming the card you were on", () => {
    expect(gridHref("s1", "c1", f({ type: "Hero" }))).toBe("/forge/sets/s1/cards?type=Hero#card-c1");
    expect(gridHref("s1", "c1", NO_FILTERS)).toBe("/forge/sets/s1/cards#card-c1");
  });

  it("goes back to Ideas for a card not in a set", () => {
    expect(gridHref(null, "c1", f({ q: "x" }))).toBe("/forge/ideas?q=x#card-c1");
  });
});

describe("gridReturnY", () => {
  const view = { viewportHeight: 800, chrome: 112 };

  it("goes back to the exact place when the card you were on is still on screen", () => {
    expect(gridReturnY({ ...view, savedY: 2851, tile: { top: 3100, height: 300 } })).toBe(2851);
  });

  it("centres the card when walking took you off that screen", () => {
    expect(gridReturnY({ ...view, savedY: 2851, tile: { top: 6000, height: 300 } })).toBe(5750);
  });

  it("doesn't count a tile hidden under the sticky chrome as on screen", () => {
    expect(gridReturnY({ ...view, savedY: 2851, tile: { top: 2900, height: 300 } })).toBe(2650);
  });

  it("centres the card with no remembered place, as after opening it from elsewhere", () => {
    expect(gridReturnY({ ...view, savedY: null, tile: { top: 6000, height: 300 } })).toBe(5750);
  });

  it("never asks for a negative scroll", () => {
    expect(gridReturnY({ ...view, savedY: null, tile: { top: 900, height: 300 } })).toBe(650);
    expect(gridReturnY({ ...view, savedY: 2000, tile: { top: 100, height: 300 } })).toBe(0);
  });

  it("uses the remembered place, or the top, when the card isn't in the grid", () => {
    expect(gridReturnY({ ...view, savedY: 2851, tile: null })).toBe(2851);
    expect(gridReturnY({ ...view, savedY: null, tile: null })).toBe(0);
  });
});

const card = (id: string, patch: Partial<FilterableCard> = {}): FilterableCard => ({
  id, title: id, status: "draft", snapshot: {}, ...patch,
});

describe("cardMatchesFilters", () => {
  it("matches everything with no filters, even a blank card", () => {
    expect(cardMatchesFilters(card("a", { title: null }), NO_FILTERS)).toBe(true);
  });

  it("searches title and card text, ignoring case", () => {
    const c = card("Invented Lantern", { snapshot: { rawText: "Draw a card." } });
    expect(cardMatchesFilters(c, f({ q: "LANTERN" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ q: "draw" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ q: "nothing" }))).toBe(false);
  });

  it("filters on status, any of a card's types, and any of its brigades", () => {
    const c = card("a", { status: "playtesting", snapshot: { cardType: ["Hero", "GE"], brigades: ["Blue", "Clay"] } });
    expect(cardMatchesFilters(c, f({ status: "playtesting" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ status: "draft" }))).toBe(false);
    expect(cardMatchesFilters(c, f({ type: "GE" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ type: "EE" }))).toBe(false);
    expect(cardMatchesFilters(c, f({ brigade: "Clay" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ brigade: "Red" }))).toBe(false);
  });

  it("needs every filter to match", () => {
    const c = card("a", { snapshot: { cardType: ["Hero"], brigades: ["Blue"] } });
    expect(cardMatchesFilters(c, f({ type: "Hero", brigade: "Blue" }))).toBe(true);
    expect(cardMatchesFilters(c, f({ type: "Hero", brigade: "Red" }))).toBe(false);
  });

  it("filters by the latest version's date, so a card with no version never matches", () => {
    const releases = { a: rel("2026-10-05T12:00:00Z"), b: rel("2026-09-30T12:00:00Z") };
    expect(cardMatchesFilters(card("a"), f({ since: "2026-10-01" }), releases)).toBe(true);
    expect(cardMatchesFilters(card("b"), f({ since: "2026-10-01" }), releases)).toBe(false);
    expect(cardMatchesFilters(card("c"), f({ since: "2026-10-01" }), releases)).toBe(false);
    expect(cardMatchesFilters(card("a"), f({ since: "2026-10-01" }))).toBe(false);
  });
});

describe("visibleSetCards", () => {
  it("keeps the order it's given", () => {
    const cards = [card("z"), card("a"), card("m", { status: "approved" })];
    expect(visibleSetCards(cards, f({ status: "draft" })).map((c) => c.id)).toEqual(["z", "a"]);
  });

  it("puts the newest version first under a date filter, as the grid shows it", () => {
    const releases = { a: rel("2026-10-05T00:00:00Z"), b: rel("2026-10-20T00:00:00Z"), c: rel("2026-10-10T00:00:00Z") };
    const list = visibleSetCards([card("a"), card("b"), card("c"), card("d")], f({ since: "2026-10-01" }), releases);
    expect(list.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});

describe("walkSet", () => {
  const set = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
    card(id, { snapshot: { cardType: [i % 2 ? "Hero" : "GE"] } }));

  it("with no filter walks the whole set with no wrap, as it always has", () => {
    expect(walkSet(set, "a", NO_FILTERS)).toEqual({ prevId: null, nextId: "b", position: { index: 1, total: 6, filtered: false } });
    expect(walkSet(set, "c", NO_FILTERS)).toEqual({ prevId: "b", nextId: "d", position: { index: 3, total: 6, filtered: false } });
    expect(walkSet(set, "f", NO_FILTERS)).toEqual({ prevId: "e", nextId: null, position: { index: 6, total: 6, filtered: false } });
  });

  it("shows no position for a set of one", () => {
    expect(walkSet([card("a")], "a", NO_FILTERS)).toEqual({ prevId: null, nextId: null, position: null });
  });

  it("stays inside the filter", () => {
    const walk = walkSet(set, "d", f({ type: "Hero" }));
    expect(walk).toEqual({ prevId: "b", nextId: "f", position: { index: 2, total: 3, filtered: true } });
  });

  it("agrees with the grid: walking from the first shown card visits exactly what's shown", () => {
    const filters = f({ type: "GE" });
    const visited: string[] = [];
    let id: string | null = visibleSetCards(set, filters)[0].id;
    while (id) { visited.push(id); id = walkSet(set, id, filters).nextId; }
    expect(visited).toEqual(visibleSetCards(set, filters).map((c) => c.id));
  });

  it("shows the position for a filter of one, where the arrows have nowhere to go", () => {
    const one = f({ q: "c" });
    expect(walkSet(set, "c", one)).toEqual({ prevId: null, nextId: null, position: { index: 1, total: 1, filtered: true } });
  });

  it("walks a date filter newest first, the order the grid shows", () => {
    const releases = { a: rel("2026-10-05T00:00:00Z"), b: rel("2026-10-20T00:00:00Z"), c: rel("2026-10-10T00:00:00Z") };
    expect(walkSet(set, "c", f({ since: "2026-10-01" }), releases))
      .toEqual({ prevId: "b", nextId: "a", position: { index: 2, total: 3, filtered: true } });
  });

  it("still has a way on when the card no longer matches, as after changing its type", () => {
    expect(walkSet(set, "c", f({ type: "Hero" })))
      .toEqual({ prevId: "b", nextId: "d", position: { index: 0, total: 3, filtered: true } });
    expect(walkSet(set, "a", f({ type: "Hero" }))).toMatchObject({ prevId: null, nextId: "b" });
  });

  it("gives nothing for a card that isn't in the set", () => {
    expect(walkSet(set, "zz", NO_FILTERS)).toEqual({ prevId: null, nextId: null, position: null });
    expect(walkSet(set, "zz", f({ type: "Hero" }))).toEqual({ prevId: null, nextId: null, position: null });
  });
});

describe("walkHint", () => {
  it("says where you are", () => {
    expect(walkHint({ index: 2, total: 224, filtered: false })).toBe("2 of 224");
    expect(walkHint({ index: 2, total: 6, filtered: true })).toBe("2 of 6 in this filter");
    expect(walkHint({ index: 0, total: 6, filtered: true })).toBe("Not in this filter");
  });
});
