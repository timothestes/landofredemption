import { describe, it, expect } from "vitest";
import { diffCards, summarizeDiff, coerceFieldValue, sameSnapshot, draftMovedOn } from "../cardDiff";

describe("diffCards", () => {
  it("detects a changed scalar field", () => {
    const d = diffCards({ name: "Goliath" }, { name: "David" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "name", kind: "changed", before: "Goliath", after: "David" });
  });

  it("marks a newly-present field as added and an emptied field as removed", () => {
    expect(diffCards({}, { reference: "1 Sam 17" })[0]).toMatchObject({ field: "reference", kind: "added", before: null });
    expect(diffCards({ reference: "1 Sam 17" }, {})[0]).toMatchObject({ field: "reference", kind: "removed", after: null });
  });

  it("detects a changed rawText body (the primary content field)", () => {
    const d = diffCards({ rawText: "Old ability text." }, { rawText: "New ability text." });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "rawText", label: "Card text", kind: "changed" });
  });

  it("diffs each class icon's side, labelled for the review", () => {
    const d = diffCards({ icons: ["Territory"] }, { icons: ["Territory"], territorySide: "both" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "territorySide", label: "Territory class icon", kind: "added", after: "both" });
    const shields = diffCards({ class: ["Warrior", "Weapon"] }, { class: ["Warrior", "Weapon"], warriorSide: "good", weaponSide: "evil" });
    expect(shields.map((c) => [c.field, c.label, c.after])).toEqual([
      ["warriorSide", "Warrior class icon", "good"], ["weaponSide", "Weapon class icon", "evil"],
    ]);
  });

  it("compares array fields by joined display value", () => {
    const same = diffCards({ brigades: ["Blue", "Green"] }, { brigades: ["Blue", "Green"] });
    expect(same).toHaveLength(0);
    const changed = diffCards({ brigades: ["Blue"] }, { brigades: ["Blue", "Green"] });
    expect(changed[0]).toMatchObject({ field: "brigades", kind: "changed", before: "Blue", after: "Blue, Green" });
  });

  it("treats an empty base as all-added and returns [] when nothing changes", () => {
    const allAdded = diffCards({}, { name: "X", brigades: ["Blue"] });
    expect(allAdded.map((c) => c.field).sort()).toEqual(["brigades", "name"]);
    expect(diffCards({ name: "X" }, { name: "X" })).toEqual([]);
  });

  it("detects a changed rarity", () => {
    const d = diffCards({ rarity: "Rare" }, { rarity: "Common" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "rarity", label: "Rarity", kind: "changed", before: "Rare", after: "Common" });
  });
});

describe("summarizeDiff", () => {
  it("summarizes none, few, and many changes", () => {
    expect(summarizeDiff([])).toBe("No field changes.");
    expect(summarizeDiff(diffCards({}, { name: "X" }))).toBe("Changed Name.");
    const many = diffCards({}, { name: "a", reference: "b", alignment: "Good", scripture: "d" });
    expect(summarizeDiff(many)).toMatch(/\+1 more\.$/);
  });
});

describe("coerceFieldValue", () => {
  it("coerces number, array, and scalar fields", () => {
    expect(coerceFieldValue("strength", "5")).toBe(5);
    expect(coerceFieldValue("strength", "nope")).toBeNull();
    expect(coerceFieldValue("brigades", "Blue, Green")).toEqual(["Blue", "Green"]);
    expect(coerceFieldValue("name", "  David  ")).toBe("David");
  });
});

describe("sameSnapshot", () => {
  it("ignores key order and compares nested values structurally", () => {
    expect(sameSnapshot({ name: "David", reference: "1 Sam 17" }, { reference: "1 Sam 17", name: "David" })).toBe(true);
    expect(sameSnapshot({ brigades: ["Blue", "Green"] }, { brigades: ["Blue", "Green"] })).toBe(true);
    expect(sameSnapshot({ brigades: ["Blue", "Green"] }, { brigades: ["Green", "Blue"] })).toBe(false);
  });

  it("catches changes diffCards is blind to (DIFF_FIELDS omits legality et al.)", () => {
    const a = { name: "David", legality: "Rotation" } as any;
    const b = { name: "David", legality: "Banned" } as any;
    expect(diffCards(a, b)).toHaveLength(0);
    expect(sameSnapshot(a, b)).toBe(false);
  });

  it("treats an empty snapshot as equal only to another empty one", () => {
    expect(sameSnapshot({}, {})).toBe(true);
    expect(sameSnapshot({}, { name: "David" })).toBe(false);
  });
});

describe("draftMovedOn", () => {
  it("is false for the same content in any key order", () => {
    expect(draftMovedOn({ name: "A", strength: 7 }, { strength: 7, name: "A" })).toBe(false);
  });
  it("sees an edited field", () => {
    expect(draftMovedOn({ rawText: "Draw 2." }, { rawText: "Draw 3." })).toBe(true);
  });
  it("sees a field added or emptied", () => {
    expect(draftMovedOn({}, { reference: "1 Sam 17" })).toBe(true);
    expect(draftMovedOn({ reference: "1 Sam 17" }, { reference: "" })).toBe(true);
  });
  // The editor writes "" and [] when a field is touched and cleared. Nothing changed on the card.
  it("does not count a touched and cleared field as a change", () => {
    expect(draftMovedOn({ name: "A" }, { name: "A", scripture: "", identifiers: [] })).toBe(false);
  });
  // diffCards skips these: they have no studio editor, but an import can still change them.
  it("sees a change in a field diffCards skips", () => {
    expect(draftMovedOn({ legality: "Rotation" }, { legality: "Banned" })).toBe(true);
  });
  it("sees reordered brigades, which change the printed bands", () => {
    expect(draftMovedOn({ brigades: ["Blue", "Red"] }, { brigades: ["Red", "Blue"] })).toBe(true);
  });
});
