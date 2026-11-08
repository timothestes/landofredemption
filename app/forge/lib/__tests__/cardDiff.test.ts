import { describe, it, expect } from "vitest";
import { diffCards, summarizeDiff, coerceFieldValue, sameSnapshot, sameCardContent } from "../cardDiff";

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

// Mirrors _forge_snapshot_content in migration 127, which decides whether a release
// mints a version. The same cases are run against the SQL.
describe("sameCardContent", () => {
  it("ignores key order", () => {
    expect(sameCardContent({ name: "A", rawText: "x" }, { rawText: "x", name: "A" })).toBe(true);
  });

  it("treats an emptied field as no field, since a typed-then-erased edit changes nothing", () => {
    expect(sameCardContent({ name: "A" }, { name: "A", reference: "", brigades: [], strength: undefined })).toBe(true);
    expect(sameCardContent({ name: "A" }, { name: "A", strength: null as never })).toBe(true);
  });

  it("does not treat a zero stat as empty", () => {
    expect(sameCardContent({ name: "A" }, { name: "A", strength: 0 })).toBe(false);
  });

  it("sees a real change, including in fields the diff doesn't list", () => {
    expect(sameCardContent({ rawText: "Draw 2." }, { rawText: "Draw 3." })).toBe(false);
    expect(sameCardContent({ name: "A" }, { name: "A", legality: "Rotation" })).toBe(false);
  });

  it("is order-sensitive inside a list, as jsonb is", () => {
    expect(sameCardContent({ brigades: ["Blue", "Red"] }, { brigades: ["Red", "Blue"] })).toBe(false);
  });
});
