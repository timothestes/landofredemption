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
