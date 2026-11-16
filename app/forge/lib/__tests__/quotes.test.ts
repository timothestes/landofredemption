import { describe, it, expect } from "vitest";
import { curlyFor, curlAll, hasStraightQuotes, foldQuotes } from "@/app/forge/lib/quotes";

describe("curlyFor", () => {
  it("opens at the start, after a space, a bracket, a dash or another opening mark", () => {
    expect(curlyFor("", '"')).toBe("“");
    expect(curlyFor("He said, ", '"')).toBe("“");
    expect(curlyFor("line one\n", '"')).toBe("“");
    expect(curlyFor("(", '"')).toBe("“");
    expect(curlyFor("wait—", '"')).toBe("“");
    expect(curlyFor("“", "'")).toBe("‘");
    expect(curlyFor("", "'")).toBe("‘");
  });
  it("opens after the ellipsis an excerpt starts with, and closes after one that ends it", () => {
    expect(curlyFor("…", '"')).toBe("“");
    expect(curlyFor("“waged war…", '"')).toBe("”");
  });
  it("closes after a letter or punctuation; the single is then the apostrophe", () => {
    expect(curlyFor("“KINGS.", '"')).toBe("”");
    expect(curlyFor("don", "'")).toBe("’");
    expect(curlyFor("brothers", "'")).toBe("’");
    expect(curlyFor("“‘Go.", "'")).toBe("’");
    expect(curlyFor("“‘Go.’", '"')).toBe("”");
  });
});

describe("curlAll", () => {
  it("converts every straight mark from the text to its left", () => {
    expect(curlAll(`"Quotes" 'Apostrophe' don't`)).toBe("“Quotes” ‘Apostrophe’ don’t");
    expect(curlAll(`He said, "'Go,' and the brothers' flock went."`)).toBe("He said, “‘Go,’ and the brothers’ flock went.”");
    expect(curlAll(`Negate an opponent's card.`)).toBe("Negate an opponent’s card.");
  });
  it("leaves text with no straight marks alone", () => {
    const t = "written: “KING OF KINGS, AND LORD OF LORDS.”";
    expect(curlAll(t)).toBe(t);
    expect(curlAll("")).toBe("");
  });
});

describe("hasStraightQuotes / foldQuotes", () => {
  it("sees straight marks only", () => {
    expect(hasStraightQuotes(`a "b"`)).toBe(true);
    expect(hasStraightQuotes("don't")).toBe(true);
    expect(hasStraightQuotes("“b” don’t")).toBe(false);
  });
  it("folds curly marks to the ones a keyboard types", () => {
    expect(foldQuotes("opponent’s “Lost” ‘x’")).toBe(`opponent's "Lost" 'x'`);
  });
});
