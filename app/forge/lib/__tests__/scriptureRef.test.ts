import { describe, it, expect } from "vitest";
import { getTestamentForRef } from "@/app/decklist/card-search/data/testament";
import { BOOKS, parseRef, canonicalRef, suggestBook, classify, bookById } from "@/app/forge/lib/scriptureRef";

describe("BOOKS", () => {
  it("has 66 books in canonical order with real chapter counts", () => {
    expect(BOOKS).toHaveLength(66);
    expect(BOOKS[0].id).toBe("GEN");
    expect(BOOKS[65].id).toBe("REV");
    expect(BOOKS.reduce((n, b) => n + b.chapters, 0)).toBe(1189);
    expect(bookById("PSA")?.chapters).toBe(150);
    expect(bookById("NOPE")).toBeUndefined();
  });
});

describe("parseRef", () => {
  it.each([
    ["Gen 6:2", { bookId: "GEN", book: "Genesis", chapter: 6, from: 2, to: 2 }],
    ["genesis 6:2.", { bookId: "GEN", chapter: 6, from: 2, to: 2 }],
    ["II Chr 5:11-12", { bookId: "2CH", book: "II Chronicles", chapter: 5, from: 11, to: 12 }],
    ["1 Chronicles 5:11", { bookId: "1CH", book: "I Chronicles" }],
    ["1Sam 17:4", { bookId: "1SA" }], ["I Sam 17:4", { bookId: "1SA" }],
    ["Ps 60:5", { bookId: "PSA", book: "Psalm" }], ["Psalms 23", { bookId: "PSA", chapter: 23, from: 1, to: 1 }],
    ["Song of Songs 2:1", { bookId: "SNG", book: "Song of Solomon" }], ["Canticles 2:1", { bookId: "SNG" }],
    ["Rev 12:7-8", { bookId: "REV", from: 7, to: 8 }], ["Phil 4:13", { bookId: "PHP" }], ["Philem 1:6", { bookId: "PHM" }],
    ["3 John 1:4", { bookId: "3JN", book: "III John" }], ["Jude 1:3", { bookId: "JUD" }],
  ])("parses %s", (text, expected) => expect(parseRef(text)).toMatchObject(expected));
  it.each(["Gen", "Gen 6:", "Gen 6:2-5:1", "Genesis 51", "Genesis 0:1", "Gen 6:5-2", "wells Philistines", ""])(
    "rejects %s", (text) => expect(parseRef(text)).toBeNull());
});
describe("canonicalRef", () => {
  it("formats single verses and ranges", () => {
    expect(canonicalRef("2CH", 5, 11, 12)).toBe("II Chronicles 5:11-12");
    expect(canonicalRef("PSA", 60, 5, 5)).toBe("Psalm 60:5");
  });
  it("classifies as a testament for every book", () => {
    for (const b of BOOKS) expect(getTestamentForRef(canonicalRef(b.id, 1, 1, 1)), b.name).not.toBeNull();
  });
});
describe("suggestBook", () => {
  it("fixes near misses and ignores exact names", () => {
    expect(suggestBook("Pslam")).toBe("Psalm"); expect(suggestBook("Jhn")).toBe("John");
    expect(suggestBook("Genesis")).toBeNull(); expect(suggestBook("wells")).toBeNull();
    expect(suggestBook("Samual")).toBe("I Samuel"); expect(suggestBook("Samuel")).toBe("I Samuel");
    expect(suggestBook("Jude")).toBeNull();
  });
});
describe("classify", () => {
  it.each([
    ["", { kind: "empty" }], ["Gen 6:2", { kind: "ref" }], ["Pslam 23", { kind: "suggest", book: "Psalm", rest: "23" }],
    ["Genesis 6:2; Matthew 1:1", { kind: "invalid", book: "Genesis" }], ["Rev 19:15 (Rev 19:11)", { kind: "invalid" }],
    ["Genesis", { kind: "invalid", book: "Genesis" }], ["wells Philistines", { kind: "search" }],
    ["John the Baptist", { kind: "scoped", book: { id: "JHN" }, rest: "the Baptist" }], ["mark of the beast", { kind: "scoped", book: { id: "MRK" }, rest: "of the beast" }],
    ["Is anything too difficult for the Lord", { kind: "search" }], ["Jonah whale", { kind: "scoped", book: { id: "JON" }, rest: "whale" }],
    ["man of God", { kind: "search" }], ["king David", { kind: "search" }], ["pet shop", { kind: "search" }],
    ["Psalms shepherd", { kind: "scoped", book: { id: "PSA" }, rest: "shepherd" }],
    ["Ps shepherd", { kind: "scoped", book: { id: "PSA" }, rest: "shepherd" }],
    ["1 Sam Goliath", { kind: "scoped", book: { id: "1SA" }, rest: "Goliath" }],
    ["II Kings chariot of fire", { kind: "scoped", book: { id: "2KI" }, rest: "chariot of fire" }],
    ["Song of Solomon beloved", { kind: "scoped", book: { id: "SNG" }, rest: "beloved" }],
    ["Am I my brother's keeper", { kind: "search" }],
    ["Jhn 3:16", { kind: "suggest", book: "John", rest: "3:16" }],
    ["Samuel 17:4", { kind: "suggest", book: "I Samuel", rest: "17:4" }],
  ])("classifies %s", (text, expected) => expect(classify(text)).toMatchObject(expected));
});
