import { describe, it, expect } from "vitest";
import { isUnfinishedStat, statRefusedNote, statShown, statSidesNote } from "../statField";
import { parseStatInput } from "../designCard";

describe("isUnfinishedStat", () => {
  it("says nothing yet about text on its way to a stat", () => {
    for (const t of ["-", "6/", "6 /", " 6/ ", "6 (", "6(0", "6 (0", "x/", "X (", "x(0", "-/", "-(", "-(5", "11/"]) {
      expect(isUnfinishedStat(t), t).toBe(true);
    }
  });

  it("calls everything else finished, so the field can refuse it straight away", () => {
    for (const t of ["abc", "7.", "6-0", "6-", "6 (0))", "6/0/", "6 (a", "x y", "/", "(", "7 7"]) {
      expect(isUnfinishedStat(t), t).toBe(false);
    }
  });

  it("every unfinished form can actually be finished", () => {
    expect(parseStatInput("6/" + "0")).not.toBeNull();
    expect(parseStatInput("6 (" + "0)")).not.toBeNull();
    expect(parseStatInput("6(0" + ")")).not.toBeNull();
    expect(parseStatInput("-" + "1")).not.toBeNull();
    expect(parseStatInput("-" + "x")).not.toBeNull();
    expect(parseStatInput("-" + "/0")).not.toBeNull();
    expect(parseStatInput("-(" + "5)")).not.toBeNull();
  });
});

describe("statShown", () => {
  it("shows a stat as it is stored, and nothing for no stat", () => {
    expect(statShown(7)).toBe("7");
    expect(statShown(0)).toBe("0");
    expect(statShown("6 (0)")).toBe("6 (0)");
    expect(statShown(null)).toBe("");
    expect(statShown(undefined)).toBe("");
  });
});

describe("statRefusedNote", () => {
  it("says what is still saved", () => {
    expect(statRefusedNote(7)).toBe("Not saved, still 7. Use a number, X or 6/0.");
    expect(statRefusedNote(0)).toBe("Not saved, still 0. Use a number, X or 6/0.");
    expect(statRefusedNote("6 (0)")).toBe("Not saved, still 6 (0). Use a number, X or 6/0.");
  });

  it("doesn't claim a value when there is none", () => {
    expect(statRefusedNote(null)).toBe("Not saved. Use a number, X or 6/0.");
    expect(statRefusedNote(undefined)).toBe("Not saved. Use a number, X or 6/0.");
    expect(statRefusedNote("")).toBe("Not saved. Use a number, X or 6/0.");
  });
});

describe("statSidesNote", () => {
  it("spells out a paired value, which is what '7 / 7' saves as", () => {
    expect(statSidesNote(parseStatInput("7 / 7"))).toBe("Saved as two sides, 7 and 7. For one value, type just one.");
    expect(statSidesNote("6 (0)")).toBe("Saved as two sides, 6 and 0. For one value, type just one.");
    expect(statSidesNote("- (5)")).toBe("Saved as two sides, - and 5. For one value, type just one.");
  });

  it("has nothing to say about a single value", () => {
    for (const v of [7, 0, -1, "X", "-X", "*", null, undefined, ""]) expect(statSidesNote(v)).toBeNull();
  });
});
