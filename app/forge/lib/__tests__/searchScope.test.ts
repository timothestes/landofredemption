import { describe, it, expect } from "vitest";
import { BOOKS } from "@/app/forge/lib/scriptureRef";
import { SCOPES, scopeById, highlightSegments, cardNameQuery, scopeNameFor } from "@/app/forge/lib/searchScope";

const index = (id: string) => BOOKS.findIndex((b) => b.id === id);

describe("SCOPES", () => {
  it("every scope range is a BOOKS id or a canonical-order span", () => {
    for (const s of SCOPES) {
      if (s.range === null) continue;
      const parts = s.range.split("-");
      expect(parts.length).toBeLessThanOrEqual(2);
      const idx = parts.map(index);
      idx.forEach((i) => expect(i).toBeGreaterThanOrEqual(0));
      if (idx.length === 2) expect(idx[0]).toBeLessThan(idx[1]);
    }
  });
  it("has the five scopes and scopeById falls back to any", () => {
    expect(SCOPES.map((s) => s.id)).toEqual(["any", "ot", "nt", "gospels", "letters"]);
    expect(scopeById("nt").range).toBe("MAT-REV");
    expect(scopeById("bogus").id).toBe("any");
  });
});

describe("highlightSegments", () => {
  it("marks prefix matches case-insensitively", () =>
    expect(highlightSegments("The Lord is my shepherd; the shepherds fled", "shepherd")).toEqual([
      { text: "The Lord is my ", hit: false }, { text: "shepherd", hit: true }, { text: "; the ", hit: false },
      { text: "shepherd", hit: true }, { text: "s fled", hit: false }]));
  it("a quoted phrase is one token; two words are two tokens; no hit returns one segment", () => {
    expect(highlightSegments("a chariot of fire and a fire", '"chariot of fire"').filter((s) => s.hit)).toEqual([
      { text: "chariot of fire", hit: true }]);
    expect(highlightSegments("Goliath the giant", "goliath giant").filter((s) => s.hit).map((s) => s.text)).toEqual(["Goliath", "giant"]);
    expect(highlightSegments("nothing here", "zebra")).toEqual([{ text: "nothing here", hit: false }]);
  });
  it("empty or one-letter queries mark nothing; adjacent matches merge", () => {
    expect(highlightSegments("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightSegments("abc", "a")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightSegments("a foo-bar b", 'foo "-bar"')).toEqual([
      { text: "a ", hit: false }, { text: "foo-bar", hit: true }, { text: " b", hit: false }]);
  });
});

describe("highlightSegments function words", () => {
  const bold = (text: string, words: string) => highlightSegments(text, words).filter((s) => s.hit).map((s) => s.text);
  it("stopwords never mark; short tokens match whole words only", () => {
    expect(bold("Then the Lord said to Moses, Israel is My son", "the Lord is my shepherd")).toEqual(["Lord", "My"]);
    expect(bold("they offered an offering of fire", "chariot of fire")).toEqual(["fire"]);
  });
  it("longer tokens keep prefix matching; quoted phrases stay one token", () => {
    expect(bold("the shepherds fled", "shepherd")).toEqual(["shepherd"]);
    expect(bold("I am the good shepherd, a good man", '"good shepherd"')).toEqual(["good shepherd"]);
  });
  it("a query of only stopwords marks nothing", () =>
    expect(highlightSegments("the son of the king", "the of")).toEqual([{ text: "the son of the king", hit: false }]));
  it("the left boundary is Unicode-aware", () => expect(bold("\u00c9sa\u00efe, sa\u00efe", "sa\u00efe")).toEqual(["sa\u00efe"]));
});

describe("scopeNameFor", () => {
  it("names Psalms in the plural and other books by name", () => {
    expect(scopeNameFor({ id: "PSA", name: "Psalm" })).toBe("Psalms");
    expect(scopeNameFor({ id: "GEN", name: "Genesis" })).toBe("Genesis");
  });
});

describe("cardNameQuery", () => {
  it("strips tags, cuts at punctuation, drops stopwords", () => {
    expect(cardNameQuery("Sower [EoT]")).toBe("Sower");
    expect(cardNameQuery("Patmos, Land of Exile")).toBe("Patmos");
    expect(cardNameQuery("Fishing Boat")).toBe("Fishing Boat");
    expect(cardNameQuery("The Ark of the Covenant (GoC)")).toBe("Ark Covenant");
    expect(cardNameQuery("[EoT]")).toBeNull(); expect(cardNameQuery(null)).toBeNull();
  });
});
