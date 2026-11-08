import { describe, it, expect } from "vitest";
import { importButtonCopy, rowOutcome, type RowOutcome } from "../importCopy";

const many = (o: RowOutcome, n: number) => Array.from({ length: n }, () => o);

describe("rowOutcome (U-58)", () => {
  it("says a row with no card yet gets added, with or without overwrite", () => {
    expect(rowOutcome("new", false, false)).toBe("add");
    expect(rowOutcome("new", true, true)).toBe("add");
  });

  it("skips any existing card unless overwrite is on, as the route does", () => {
    expect(rowOutcome("changed", false, false)).toBe("skip");
    expect(rowOutcome("unchanged", false, true)).toBe("skip");
  });

  it("counts an image as a change, as summarizeOverwritePreview does", () => {
    expect(rowOutcome("changed", true, false)).toBe("update");
    expect(rowOutcome("unchanged", true, true)).toBe("update");
    expect(rowOutcome("unchanged", true, false)).toBe("same");
  });

  it("claims nothing about a row the route couldn't read", () => {
    expect(rowOutcome(undefined, false, false)).toBeNull();
  });
});

describe("importButtonCopy (U-58)", () => {
  it("uses the plain count until a set has been checked", () => {
    expect(importButtonCopy(5, null, false)).toEqual({ label: "Import 5 cards", note: null, nothingToDo: false });
    expect(importButtonCopy(1, null, true).label).toBe("Import 1 card");
  });

  it("stays plain when every card is new", () => {
    expect(importButtonCopy(5, many("add", 5), false)).toEqual({ label: "Import 5 cards", note: null, nothingToDo: false });
  });

  it("counts only the new cards and says why the rest are skipped", () => {
    const copy = importButtonCopy(5, [...many("add", 2), ...many("skip", 3)], false);
    expect(copy.label).toBe("Import 2 new cards");
    expect(copy.note).toBe("3 are already in this set and will be skipped. Tick Overwrite existing cards to update them instead.");
    expect(copy.nothingToDo).toBe(false);
  });

  it("gets the singular right", () => {
    const copy = importButtonCopy(2, ["add", "skip"], false);
    expect(copy.label).toBe("Import 1 new card");
    expect(copy.note).toBe("1 is already in this set and will be skipped. Tick Overwrite existing cards to update it instead.");
  });

  it("has nothing to do on a plain re-run of the same file", () => {
    const copy = importButtonCopy(5, many("skip", 5), false);
    expect(copy.nothingToDo).toBe(true);
    expect(copy.label).toBe("Nothing new to import");
    expect(copy.note).toBe("All 5 are already in this set. Tick Overwrite existing cards to update them.");
    expect(importButtonCopy(1, ["skip"], false).note).toBe("This card is already in this set. Tick Overwrite existing cards to update it.");
  });

  it("names what an overwrite run writes", () => {
    expect(importButtonCopy(5, many("update", 5), true).label).toBe("Overwrite 5 cards");
    expect(importButtonCopy(1, ["update"], true).label).toBe("Overwrite 1 card");
    expect(importButtonCopy(5, [...many("update", 3), ...many("add", 2)], true).label).toBe("Overwrite 3 cards and add 2");
  });

  it("says when an overwrite run leaves cards alone", () => {
    const copy = importButtonCopy(5, [...many("update", 2), ...many("same", 3)], true);
    expect(copy.label).toBe("Overwrite 2 cards");
    expect(copy.note).toBe("3 already match this file and won’t be touched.");
    expect(importButtonCopy(2, ["add", "same"], true).label).toBe("Import 1 new card");
  });

  it("has nothing to do when an overwrite run would change nothing", () => {
    const copy = importButtonCopy(5, many("same", 5), true);
    expect(copy).toEqual({ label: "Nothing to change", note: "All 5 already match this file.", nothingToDo: true });
    expect(importButtonCopy(1, ["same"], true).note).toBe("This card already matches this file.");
  });

  it("keeps a row the route couldn't read in the run, where it fails with its reason", () => {
    const copy = importButtonCopy(3, ["skip", "skip", null], false);
    expect(copy.label).toBe("Import 1 new card");
    expect(copy.nothingToDo).toBe(false);
  });
});
