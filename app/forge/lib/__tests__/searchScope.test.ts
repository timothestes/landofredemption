import { describe, it, expect } from "vitest";
import { BOOKS } from "@/app/forge/lib/scriptureRef";
import { SCOPES, scopeById, highlightSegments, cardNameQuery } from "@/app/forge/lib/searchScope";

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

describe("cardNameQuery", () => {
  it("strips tags, cuts at punctuation, drops stopwords", () => {
    expect(cardNameQuery("Sower [EoT]")).toBe("Sower");
    expect(cardNameQuery("Patmos, Land of Exile")).toBe("Patmos");
    expect(cardNameQuery("Fishing Boat")).toBe("Fishing Boat");
    expect(cardNameQuery("The Ark of the Covenant (GoC)")).toBe("Ark Covenant");
    expect(cardNameQuery("[EoT]")).toBeNull(); expect(cardNameQuery(null)).toBeNull();
  });
});
