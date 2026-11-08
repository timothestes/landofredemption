import { describe, it, expect } from "vitest";
import { computeProgress } from "../progress";

const card = (cardType: string[], brigades: string[] | undefined, status = "draft") => ({
  snapshot: { cardType, brigades }, status,
});

describe("computeProgress", () => {
  it("headline counts distinct non-archived cards against target total", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"]), card(["LostSoul"], undefined), card(["Hero"], ["Green"], "archived")],
      { total: 10 }
    );
    expect(m.headline).toEqual({ actual: 2, target: 10, pct: 20 });
  });

  it("a dual-brigade card counts in each brigade cell but once in the headline", () => {
    const m = computeProgress([card(["Hero"], ["Blue", "Green"])], { total: 5, cells: { Hero: { Blue: 1, Green: 1 } } });
    expect(m.headline.actual).toBe(1);
    const blue = m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.cells.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.actual).toBe(1);
    expect(green?.actual).toBe(1);
  });

  it("brigade-less types use the 'none' bucket", () => {
    const m = computeProgress([card(["LostSoul"], undefined), card(["Artifact"], [])], { cells: { LostSoul: { none: 3 }, Artifact: { none: 2 } } });
    expect(m.cells.find((c) => c.type === "LostSoul" && c.brigade === "none")?.actual).toBe(1);
    expect(m.cells.find((c) => c.type === "Artifact" && c.brigade === "none")?.actual).toBe(1);
  });

  it("byStatus groups non-archived cards by status", () => {
    const m = computeProgress(
      [card(["Hero"], ["Blue"], "draft"), card(["Hero"], ["Blue"], "playtesting"), card(["Hero"], ["Blue"], "archived")],
      {}
    );
    expect(m.byStatus).toEqual({ draft: 1, playtesting: 1 });
  });

  it("checklist lists per-cell remaining where target exceeds actual", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { cells: { Hero: { Blue: 3, Green: 2 } } });
    const blue = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Blue");
    const green = m.checklist.find((c) => c.type === "Hero" && c.brigade === "Green");
    expect(blue?.remaining).toBe(2);
    expect(green?.remaining).toBe(2);
  });

  it("graceful degrade: total-only targets still render actuals with target 0 cells", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], { total: 4 });
    expect(m.headline.target).toBe(4);
    expect(m.cells.find((c) => c.type === "Hero" && c.brigade === "Blue")?.target).toBe(0);
    expect(m.checklist).toEqual([]); // no per-cell targets declared
  });

  it("pct is 0 when target total is 0 or absent", () => {
    expect(computeProgress([card(["Hero"], ["Blue"])], {}).headline.pct).toBe(0);
  });

  // New-set dialog now only ever writes a total (or nothing) — no more per-type seed.
  it("total-only target (40) yields no per-type goal entries, no NaN, no divide-by-zero", () => {
    const m = computeProgress([card(["Hero"], ["Blue"]), card(["LostSoul"], undefined)], { total: 40 });
    expect(m.headline).toEqual({ actual: 2, target: 40, pct: 5 });
    expect(m.checklist).toEqual([]);
    for (const c of m.cells) {
      expect(c.target).toBe(0);
      expect(Number.isNaN(c.actual)).toBe(false);
      expect(Number.isNaN(c.target)).toBe(false);
    }
  });

  it("missing targets ({}, null, or undefined) yield no per-type goal entries, no NaN, no divide-by-zero", () => {
    const cards = [card(["Hero"], ["Blue"]), card(["LostSoul"], undefined)];
    for (const targets of [{}, null, undefined] as const) {
      const m = computeProgress(cards, targets as any);
      expect(m.headline.target).toBe(0);
      expect(m.headline.pct).toBe(0);
      expect(Number.isNaN(m.headline.pct)).toBe(false);
      expect(m.checklist).toEqual([]);
    }
  });
});

// The targets editor stores a type-level target under "none", alone (TargetsEditor.save).
describe("computeProgress type-level targets", () => {
  it("counts every card of the type, whatever its brigade", () => {
    const m = computeProgress([card(["Hero"], ["Silver"]), card(["Hero"], ["Blue"])], { cells: { Hero: { none: 4 } } });
    expect(m.checklist).toEqual([{ type: "Hero", brigade: "none", remaining: 2 }]);
  });

  it("agrees with the type's Total", () => {
    const m = computeProgress([card(["Hero"], ["Silver"]), card(["Hero"], ["Blue"])], { cells: { Hero: { none: 4 } } });
    expect(m.typeTotals.Hero).toEqual({ actual: 2, target: 4 });
  });

  it("counts a multi-brigade card once, in the list and in the Total", () => {
    const m = computeProgress([card(["Hero"], ["Blue", "Green"])], { cells: { Hero: { none: 4 } } });
    expect(m.checklist).toEqual([{ type: "Hero", brigade: "none", remaining: 3 }]);
    expect(m.typeTotals.Hero).toEqual({ actual: 1, target: 4 });
  });

  it("counts brigade-less cards too, and types without a brigade as before", () => {
    const m = computeProgress(
      [card(["Hero"], undefined), card(["Hero"], ["Blue"]), card(["Artifact"], [])],
      { cells: { Hero: { none: 3 }, Artifact: { none: 2 } } },
    );
    expect(m.checklist).toEqual([
      { type: "Artifact", brigade: "none", remaining: 1 },
      { type: "Hero", brigade: "none", remaining: 1 },
    ]);
  });

  it("leaves the list when met or passed, and never counts archived cards", () => {
    const met = computeProgress([card(["Hero"], ["Blue"]), card(["Hero"], ["Red"])], { cells: { Hero: { none: 2 } } });
    expect(met.checklist).toEqual([]);
    const passed = computeProgress([card(["Hero"], ["Blue"]), card(["Hero"], ["Red"])], { cells: { Hero: { none: 1 } } });
    expect(passed.checklist).toEqual([]);
    const archived = computeProgress([card(["Hero"], ["Blue"], "archived")], { cells: { Hero: { none: 2 } } });
    expect(archived.checklist).toEqual([{ type: "Hero", brigade: "none", remaining: 2 }]);
  });

  it("names the target for no column: it belongs to the type's Total", () => {
    const m = computeProgress([card(["Hero"], ["Silver"]), card(["Hero"], ["Blue"])], { cells: { Hero: { none: 4 } } });
    expect(m.brigades).toEqual(["Blue", "Silver"]);
    expect(m.cells.every((c) => c.target === 0)).toBe(true);
    // A brigade-less card still has somewhere to show.
    const withNone = computeProgress([card(["Hero"], undefined)], { cells: { Hero: { none: 4 } } });
    expect(withNone.cells).toEqual([{ type: "Hero", brigade: "none", actual: 1, target: 0 }]);
  });

  it("a card of two types counts toward each", () => {
    const m = computeProgress([card(["Hero", "EvilCharacter"], ["Blue", "Crimson"])], {
      cells: { Hero: { none: 2 }, EvilCharacter: { none: 2 } },
    });
    expect(m.typeTotals.Hero).toEqual({ actual: 1, target: 2 });
    expect(m.typeTotals.EvilCharacter).toEqual({ actual: 1, target: 2 });
  });
});

describe("computeProgress per-brigade targets", () => {
  it("keep counting cell by cell, and total the cells", () => {
    const m = computeProgress([card(["Hero"], ["Blue", "Green"])], { cells: { Hero: { Blue: 1, Green: 1, Red: 2 } } });
    expect(m.checklist).toEqual([{ type: "Hero", brigade: "Red", remaining: 2 }]);
    expect(m.typeTotals.Hero).toEqual({ actual: 2, target: 4 });
  });

  it("beside a brigade target, none still means brigade-less cards", () => {
    const m = computeProgress([card(["Fortress"], ["Blue"]), card(["Fortress"], undefined)], {
      cells: { Fortress: { none: 3, Blue: 1 } },
    });
    expect(m.checklist).toEqual([{ type: "Fortress", brigade: "none", remaining: 2 }]);
    expect(m.typeTotals.Fortress).toEqual({ actual: 2, target: 4 });
  });

  it("a type with no target totals its cells, target 0", () => {
    const m = computeProgress([card(["Hero"], ["Blue"])], {});
    expect(m.typeTotals.Hero).toEqual({ actual: 1, target: 0 });
  });
});

describe("computeProgress keywords", () => {
  const withText = (rawText: string | undefined, status = "draft", specialAbility?: string) => ({
    snapshot: { cardType: ["GE"], brigades: ["Blue"], rawText, specialAbility }, status,
  });
  const count = (m: ReturnType<typeof computeProgress>, k: string) => m.keywords.find((x) => x.keyword === k)?.count;

  it("counts each card once per phrase, case-insensitive, from a word start", () => {
    const m = computeProgress([
      withText("Draw 2. Draw 1 more. Cannot be negated."),
      withText("Opponent draws a card and withdraws."),
      withText("Withdraw a hero."),
      withText("Protects your Reserve. This ability CANNOT BE\nPREVENTED."),
    ], null);
    expect(count(m, "draw")).toBe(2);
    expect(count(m, "cannot be negated")).toBe(1);
    expect(count(m, "cannot be prevented")).toBe(1);
    expect(count(m, "reserve")).toBe(1);
    expect(count(m, "protect")).toBe(1);
    expect(count(m, "cannot be interrupted")).toBe(0);
  });

  it("skips archived cards and falls back to legacy specialAbility", () => {
    const m = computeProgress([withText("Draw 1.", "archived"), withText(undefined, "draft", "Draw 3.")], null);
    expect(count(m, "draw")).toBe(1);
  });
});

describe("computeProgress keywords by brigade", () => {
  it("counts a matching card in each of its brigades, brigade-less under 'none'", () => {
    const m = computeProgress([
      { snapshot: { cardType: ["GE"], brigades: ["Blue", "Green"], rawText: "Draw 1." }, status: "draft" },
      { snapshot: { cardType: ["GE"], brigades: ["Blue"], rawText: "Draw 2." }, status: "draft" },
      { snapshot: { cardType: ["GE"], brigades: ["Red"], rawText: "Discard." }, status: "draft" },
      { snapshot: { cardType: ["Artifact"], brigades: [], rawText: "Draw 3." }, status: "draft" },
    ], null);
    const draw = m.keywords.find((k) => k.keyword === "draw")!;
    expect(draw.count).toBe(3);
    expect(draw.byBrigade).toEqual({ Blue: 2, Green: 1, none: 1 });
  });
});

describe("computeProgress regardless of protect", () => {
  it("matches 'regardless of protection' and still counts toward 'protect'", () => {
    const m = computeProgress([
      { snapshot: { cardType: ["EE"], brigades: ["Black"], rawText: "Discard a Hero regardless of protection." }, status: "draft" },
    ], null);
    expect(m.keywords.find((k) => k.keyword === "regardless of protect")?.count).toBe(1);
    expect(m.keywords.find((k) => k.keyword === "protect")?.count).toBe(1);
  });
});
