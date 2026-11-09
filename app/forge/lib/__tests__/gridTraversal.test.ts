import { describe, it, expect } from "vitest";
import { ENTRY_Y, entryReturnY, traversalFrom, traversalIsFor } from "../gridTraversal";

const GRID = "/forge/sets/s1/cards?status=draft";

describe("traversalFrom", () => {
  it("keeps the position on the entry, with the URL it belongs to", () => {
    expect(traversalFrom({ __NA: true, [ENTRY_Y]: 1800 }, GRID)).toEqual({ url: GRID, y: 1800 });
  });

  it("counts the top of the page as a position", () => {
    expect(traversalFrom({ [ENTRY_Y]: 0 }, GRID)).toEqual({ url: GRID, y: 0 });
  });

  it("finds nothing on an entry with no marker, or on a used one", () => {
    expect(traversalFrom({ __NA: true }, GRID)).toBeNull();
    expect(traversalFrom(null, GRID)).toBeNull();
    expect(traversalFrom({ [ENTRY_Y]: "1800" }, GRID)).toBeNull();
  });
});

describe("traversalIsFor", () => {
  it("matches this page of grids under any filters", () => {
    expect(traversalIsFor({ url: GRID, y: 1 }, "/forge/sets/s1/cards")).toBe(true);
    expect(traversalIsFor({ url: "/forge/sets/s1/cards", y: 1 }, "/forge/sets/s1/cards")).toBe(true);
  });

  it("leaves another grid's alone, so jumping between sets keeps it", () => {
    expect(traversalIsFor({ url: GRID, y: 1 }, "/forge/sets/s2/cards")).toBe(false);
    expect(traversalIsFor({ url: "/forge/sets/s10/cards", y: 1 }, "/forge/sets/s1")).toBe(false);
    expect(traversalIsFor(null, "/forge/sets/s1/cards")).toBe(false);
  });
});

describe("entryReturnY", () => {
  it("uses the traversal when Next has already wiped the entry, which is Back after a save", () => {
    expect(entryReturnY({ traversal: { url: GRID, y: 1800 }, here: GRID, inState: undefined })).toBe(1800);
  });

  it("reads the entry when no traversal was seen, as after a full page load", () => {
    expect(entryReturnY({ traversal: null, here: GRID, inState: 1800 })).toBe(1800);
  });

  it("leaves a fresh link alone", () => {
    expect(entryReturnY({ traversal: null, here: GRID, inState: undefined })).toBeNull();
  });

  it("won't take another grid's position, in another set or under another filter", () => {
    const other = { url: GRID, y: 1800 };
    expect(entryReturnY({ traversal: other, here: "/forge/sets/s2/cards?status=draft", inState: undefined })).toBeNull();
    expect(entryReturnY({ traversal: other, here: "/forge/sets/s1/cards?status=approved", inState: undefined })).toBeNull();
    expect(entryReturnY({ traversal: other, here: "/forge/sets/s1/cards", inState: 300 })).toBe(300);
  });

  it("ignores a marker that isn't a number", () => {
    expect(entryReturnY({ traversal: null, here: GRID, inState: "1800" })).toBeNull();
  });
});
