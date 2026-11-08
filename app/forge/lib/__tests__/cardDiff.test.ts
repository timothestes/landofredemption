import { describe, it, expect } from "vitest";
import { diffCards, summarizeDiff, coerceFieldValue, sameSnapshot, sameCardContent, wordDiff, readsAsRedline as redline } from "../cardDiff";

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

  it("treats an undefined key as absent, as JSON and jsonb do, but not null", () => {
    expect(sameSnapshot({ name: "David", rarity: undefined }, { name: "David" })).toBe(true);
    expect(sameSnapshot({ strength: null }, {})).toBe(false);
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

describe("wordDiff", () => {
  const side = (ops: ReturnType<typeof wordDiff>, drop: "del" | "ins") =>
    ops.filter((o) => o.op !== drop).map((o) => o.text).join("");

  // The audit's case: two whole paragraphs, compared by eye to find the "3".
  it("marks only the changed word in a long sentence", () => {
    const ops = wordDiff(
      "Protect target Hero from the next opponent enhancement this turn. Draw 2.",
      "Protect target Hero from the next opponent enhancement this turn. Draw 3.",
    );
    expect(ops).toEqual([
      { op: "same", text: "Protect target Hero from the next opponent enhancement this turn. Draw " },
      { op: "del", text: "2" },
      { op: "ins", text: "3" },
      { op: "same", text: "." },
    ]);
  });

  it("marks two separate changes separately, keeping what lies between", () => {
    const ops = wordDiff("Draw 2 and discard 1 now.", "Draw 3 and discard 2 now.");
    expect(ops.filter((o) => o.op !== "same")).toEqual([
      { op: "del", text: "2" },
      { op: "ins", text: "3" },
      { op: "del", text: "1" },
      { op: "ins", text: "2" },
    ]);
    expect(ops.filter((o) => o.op === "same").map((o) => o.text)).toEqual(["Draw ", " and discard ", " now."]);
  });

  it("keeps a word that moved within a rewritten phrase", () => {
    const ops = wordDiff("the next opponent enhancement this turn", "the next enhancement an opponent plays this turn");
    expect(side(ops, "ins")).toBe("the next opponent enhancement this turn");
    expect(side(ops, "del")).toBe("the next enhancement an opponent plays this turn");
    expect(ops.filter((o) => o.op === "same").map((o) => o.text).join("")).toContain("opponent");
  });

  // Matching only the spaces between replaced words reads as confetti.
  it("treats consecutive replaced words as one change", () => {
    expect(wordDiff("old words here", "new text there")).toEqual([
      { op: "del", text: "old words here" },
      { op: "ins", text: "new text there" },
    ]);
  });

  it("keeps punctuation out of the changed word", () => {
    expect(wordDiff("Draw 2.", "Draw 2!")).toEqual([
      { op: "same", text: "Draw 2" },
      { op: "del", text: "." },
      { op: "ins", text: "!" },
    ]);
  });

  it("keeps newlines", () => {
    const ops = wordDiff("First line.\nSecond line.", "First line.\nSecond row.");
    expect(side(ops, "ins")).toBe("First line.\nSecond line.");
    expect(side(ops, "del")).toBe("First line.\nSecond row.");
  });

  it("always rebuilds both sides exactly", () => {
    const cases: [string, string][] = [
      ["", "added text"],
      ["removed text", ""],
      ["a b c d", "b d e"],
      ["  spaced   out  ", "spaced out"],
      ["same", "same"],
      ["Hero's +2/+1 (X)", "Hero’s +3/+1 (Y)"],
    ];
    for (const [before, after] of cases) {
      const ops = wordDiff(before, after);
      expect(side(ops, "ins")).toBe(before);
      expect(side(ops, "del")).toBe(after);
    }
  });

  // Snapshots run to 64 KB. The table is words x words, so a huge rewrite skips it.
  it("falls back to replacing the changed middle when the text is enormous", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`).join(" ");
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`).join(" ");
    expect(wordDiff(`Keep ${before} end`, `Keep ${after} end`)).toEqual([
      { op: "same", text: "Keep " },
      { op: "del", text: before },
      { op: "ins", text: after },
      { op: "same", text: " end" },
    ]);
  });
});

describe("redline", () => {
  it("reads inline when most of the text is unchanged", () => {
    expect(redline(wordDiff("Protect target Hero this turn. Draw 2.", "Protect target Hero this turn. Draw 3."))).toBe(true);
  });

  it("does not when the text was largely rewritten", () => {
    expect(redline(wordDiff("Protect target Hero this turn.", "Discard the top card of a deck."))).toBe(false);
    expect(redline(wordDiff("one two three four", "one five six seven"))).toBe(false);
  });

  it("does not for a very short change, where two lines are clearer", () => {
    expect(redline(wordDiff("Draw 2", "Draw 3"))).toBe(false);
  });
});
