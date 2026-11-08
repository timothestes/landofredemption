import { describe, it, expect } from "vitest";
import { parseCardFilters, filterQuery, gridHref, gridReturnY, NO_FILTERS, type CardFilters } from "../cardFilters";

const f = (patch: Partial<CardFilters> = {}): CardFilters => ({ ...NO_FILTERS, ...patch });

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
