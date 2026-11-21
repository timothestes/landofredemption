import { describe, it, expect } from "vitest";
import {
  handleGridKey,
  stepLeft,
  stepRight,
  nextUnscored,
  commitDecision,
  needsFlush,
  type GridContext,
  type CellRef,
} from "../scoreGridNav";

const cell = (row: number, col: 0 | 1): CellRef => ({ row, col });

/** 4 rows, max 5, nothing scored yet, cursor at 0/P1. */
const ctx = (over: Partial<GridContext> = {}): GridContext => ({
  cursor: cell(0, 0),
  rowCount: 4,
  maxScore: 5,
  isRowComplete: () => false,
  valueAt: () => null,
  ...over,
});

/** Build a valueAt from a sparse {"row:col": value} map. */
const valuesFrom =
  (map: Record<string, number>) =>
  (row: number, col: 0 | 1): number | null =>
    map[`${row}:${col}`] ?? null;

describe("stepRight / stepLeft", () => {
  it("moves P1 -> P2 within a row", () => {
    expect(stepRight(cell(1, 0), 4)).toEqual(cell(1, 1));
  });
  it("wraps P2 -> next row's P1", () => {
    expect(stepRight(cell(1, 1), 4)).toEqual(cell(2, 0));
  });
  it("returns null off the last cell", () => {
    expect(stepRight(cell(3, 1), 4)).toBeNull();
  });
  it("wraps P1 -> previous row's P2", () => {
    expect(stepLeft(cell(2, 0), 4)).toEqual(cell(1, 1));
  });
  it("returns null off the first cell", () => {
    expect(stepLeft(cell(0, 0), 4)).toBeNull();
  });
});

describe("nextUnscored", () => {
  it("finds the first incomplete row at or after the start", () => {
    const complete = (r: number) => r < 2;
    expect(nextUnscored(0, 4, complete)).toEqual(cell(2, 0));
  });
  it("wraps around to find an earlier gap", () => {
    const complete = (r: number) => r !== 1;
    expect(nextUnscored(2, 4, complete)).toEqual(cell(1, 0));
  });
  it("returns null when every row is scored", () => {
    expect(nextUnscored(0, 4, () => true)).toBeNull();
  });
});

describe("digit entry", () => {
  it("writes the digit and advances P1 -> P2", () => {
    expect(handleGridKey("3", ctx())).toEqual({
      kind: "write",
      at: cell(0, 0),
      value: 3,
      then: cell(0, 1),
    });
  });

  it("writes on P2 and advances to the next row's P1", () => {
    expect(handleGridKey("1", ctx({ cursor: cell(0, 1) }))).toEqual({
      kind: "write",
      at: cell(0, 1),
      value: 1,
      then: cell(1, 0),
    });
  });

  it("two keystrokes record a whole match and land on the next", () => {
    const first = handleGridKey("3", ctx());
    expect(first.kind).toBe("write");
    const afterFirst = first.kind === "write" ? first.then : cell(0, 0);
    const second = handleGridKey("1", ctx({ cursor: afterFirst }));
    expect(second).toEqual({
      kind: "write",
      at: cell(0, 1),
      value: 1,
      then: cell(1, 0),
    });
  });

  it("accepts a digit equal to max_score", () => {
    expect(handleGridKey("5", ctx())).toEqual({
      kind: "write",
      at: cell(0, 0),
      value: 5,
      then: cell(0, 1),
    });
  });

  it("rejects a digit above max_score without writing", () => {
    expect(handleGridKey("6", ctx())).toEqual({ kind: "reject", at: cell(0, 0) });
  });

  it("accepts 7 only when max_score is 7", () => {
    expect(handleGridKey("7", ctx({ maxScore: 5 }))).toEqual({
      kind: "reject",
      at: cell(0, 0),
    });
    expect(handleGridKey("7", ctx({ maxScore: 7 }))).toEqual({
      kind: "write",
      at: cell(0, 0),
      value: 7,
      then: cell(0, 1),
    });
  });

  it("accepts 0", () => {
    expect(handleGridKey("0", ctx())).toMatchObject({ kind: "write", value: 0 });
  });

  it("parks on the first unscored row after filling the last cell", () => {
    // Rows 0 and 2 already done; we're finishing row 3, so row 1 is the gap.
    const action = handleGridKey(
      "2",
      ctx({
        cursor: cell(3, 1),
        isRowComplete: (r) => r === 0 || r === 2,
        // Row 3's P1 is filled, so this keystroke really does complete it.
        valueAt: valuesFrom({ "3:0": 4 }),
      }),
    );
    expect(action).toEqual({
      kind: "write",
      at: cell(3, 1),
      value: 2,
      then: cell(1, 0),
    });
  });

  it("holds position when the last cell completes the round", () => {
    const action = handleGridKey(
      "2",
      ctx({
        cursor: cell(3, 1),
        isRowComplete: (r) => r !== 3,
        valueAt: valuesFrom({ "3:0": 4 }),
      }),
    );
    expect(action).toEqual({
      kind: "write",
      at: cell(3, 1),
      value: 2,
      then: cell(3, 1),
    });
  });

  it("comes back to a half-filled last row instead of skipping past it", () => {
    // Filling row 3's P2 while its P1 is still blank must NOT treat row 3 as
    // done — otherwise the round ends with a silently half-scored match.
    const action = handleGridKey(
      "2",
      ctx({
        cursor: cell(3, 1),
        isRowComplete: () => true,
        valueAt: () => null, // row 3's P1 is empty
      }),
    );
    expect(action).toEqual({
      kind: "write",
      at: cell(3, 1),
      value: 2,
      then: cell(3, 0),
    });
  });
});

describe("modifier keys are never scores", () => {
  // Cmd+1..9 switches browser tabs, Cmd+0 resets zoom. Treating those as score
  // input silently wrote a real result into the focused cell.
  for (const mod of ["ctrlKey", "metaKey", "altKey"] as const) {
    it(`ignores digits held with ${mod}`, () => {
      expect(handleGridKey("1", ctx(), { [mod]: true }).kind).toBe("passthrough");
      expect(handleGridKey("0", ctx(), { [mod]: true }).kind).toBe("passthrough");
    });

    it(`ignores navigation keys held with ${mod}`, () => {
      expect(handleGridKey("ArrowDown", ctx(), { [mod]: true }).kind).toBe("passthrough");
      expect(handleGridKey("Enter", ctx(), { [mod]: true }).kind).toBe("passthrough");
      expect(handleGridKey("Backspace", ctx(), { [mod]: true }).kind).toBe("passthrough");
    });
  }

  it("still writes a bare digit with no modifiers", () => {
    expect(handleGridKey("3", ctx(), {}).kind).toBe("write");
    expect(handleGridKey("3", ctx()).kind).toBe("write");
  });

  it("allows Shift, which is how '?' is typed on most layouts", () => {
    expect(handleGridKey("?", ctx(), { ctrlKey: false }).kind).toBe("help");
  });
});

describe("arrow navigation", () => {
  it("ArrowDown moves to the next row, same column", () => {
    expect(handleGridKey("ArrowDown", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 1),
    });
  });

  it("ArrowUp moves to the previous row, same column", () => {
    expect(handleGridKey("ArrowUp", ctx({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(1, 0),
    });
  });

  it("clamps at the top and bottom instead of wrapping", () => {
    expect(handleGridKey("ArrowUp", ctx({ cursor: cell(0, 1) }))).toEqual({
      kind: "move",
      to: cell(0, 1),
    });
    expect(handleGridKey("ArrowDown", ctx({ cursor: cell(3, 0) }))).toEqual({
      kind: "move",
      to: cell(3, 0),
    });
  });

  it("ArrowLeft/Right wrap across row boundaries", () => {
    expect(handleGridKey("ArrowRight", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
    expect(handleGridKey("ArrowLeft", ctx({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(1, 1),
    });
  });

  it("holds at the grid edges", () => {
    expect(handleGridKey("ArrowLeft", ctx({ cursor: cell(0, 0) }))).toEqual({
      kind: "move",
      to: cell(0, 0),
    });
    expect(handleGridKey("ArrowRight", ctx({ cursor: cell(3, 1) }))).toEqual({
      kind: "move",
      to: cell(3, 1),
    });
  });

  it("Home and End jump to the grid extremes", () => {
    expect(handleGridKey("Home", ctx({ cursor: cell(2, 1) }))).toEqual({
      kind: "move",
      to: cell(0, 0),
    });
    expect(handleGridKey("End", ctx({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(3, 1),
    });
  });
});

describe("Enter", () => {
  it("advances to the next row's P1 from either column", () => {
    expect(handleGridKey("Enter", ctx({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
    expect(handleGridKey("Enter", ctx({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
  });

  it("on the last row, jumps back to the first unscored row", () => {
    expect(
      handleGridKey(
        "Enter",
        ctx({ cursor: cell(3, 1), isRowComplete: (r) => r !== 2 }),
      ),
    ).toEqual({ kind: "move", to: cell(2, 0) });
  });

  it("on the last row with everything scored, holds position", () => {
    expect(
      handleGridKey("Enter", ctx({ cursor: cell(3, 0), isRowComplete: () => true })),
    ).toEqual({ kind: "move", to: cell(3, 0) });
  });
});

describe("clearing and exiting", () => {
  // `clear` is its own action, not a write-with-null: clearing has to reach the
  // database. When it was a local-only write the cell went blank while the old
  // score stayed recorded, and the cheatsheet promised otherwise.
  it("Backspace emits a clear for the cursor cell", () => {
    expect(handleGridKey("Backspace", ctx({ cursor: cell(2, 1) }))).toEqual({
      kind: "clear",
      at: cell(2, 1),
    });
  });

  it("Delete behaves like Backspace", () => {
    expect(handleGridKey("Delete", ctx({ cursor: cell(1, 0) }))).toEqual({
      kind: "clear",
      at: cell(1, 0),
    });
  });

  it("Escape reverts a dirty cell, then exits on the second press", () => {
    expect(handleGridKey("Escape", ctx({ isDirty: true }))).toEqual({
      kind: "revert",
      at: cell(0, 0),
    });
    expect(handleGridKey("Escape", ctx({ isDirty: false }))).toEqual({ kind: "exit" });
  });
});

describe("commitDecision", () => {
  it("commits when a keystroke completes a previously blank row", () => {
    expect(commitDecision({ p1: 3, p2: null }, { p1: 3, p2: 1 })).toBe("commit");
  });

  it("does nothing while the row is still half-filled", () => {
    expect(commitDecision({ p1: null, p2: null }, { p1: 3, p2: null })).toBe("none");
    expect(commitDecision({ p1: null, p2: null }, { p1: null, p2: 2 })).toBe("none");
  });

  // The bug this exists to prevent: correcting a recorded 3-1 to 1-3 used to
  // write a 1-1 tie the moment the first digit landed, then race a second save.
  it("defers when overwriting a row that was already complete", () => {
    expect(commitDecision({ p1: 3, p2: 1 }, { p1: 1, p2: 1 })).toBe("defer");
    expect(commitDecision({ p1: 1, p2: 1 }, { p1: 1, p2: 3 })).toBe("defer");
  });

  it("treats 0 as a real score, not as absent", () => {
    expect(commitDecision({ p1: 0, p2: null }, { p1: 0, p2: 0 })).toBe("commit");
    expect(commitDecision({ p1: 0, p2: 0 }, { p1: 5, p2: 0 })).toBe("defer");
  });
});

describe("needsFlush", () => {
  it("flushes a complete draft that differs from what's saved", () => {
    expect(needsFlush({ p1: 1, p2: 3 }, { p1: 3, p2: 1 })).toBe(true);
  });

  it("skips a draft that already matches the saved scores", () => {
    expect(needsFlush({ p1: 3, p2: 1 }, { p1: 3, p2: 1 })).toBe(false);
  });

  it("skips a half-filled draft — a partial row is never persisted", () => {
    expect(needsFlush({ p1: 1, p2: null }, { p1: 3, p2: 1 })).toBe(false);
  });

  it("skips when there is no draft at all", () => {
    expect(needsFlush(undefined, { p1: 3, p2: 1 })).toBe(false);
  });

  it("flushes a draft onto a row that had no score", () => {
    expect(needsFlush({ p1: 2, p2: 0 }, { p1: null, p2: null })).toBe(true);
  });
});

describe("rows without score boxes (a forfeited match)", () => {
  // Row 1 is forfeited: it renders no inputs, so focus can never land there.
  const skip1 = (over: Partial<GridContext> = {}) =>
    ctx({ isRowEditable: (r) => r !== 1, ...over });

  it("a digit on the row above advances past it", () => {
    expect(handleGridKey("1", skip1({ cursor: cell(0, 1) }))).toEqual({
      kind: "write",
      at: cell(0, 1),
      value: 1,
      then: cell(2, 0),
    });
  });

  it("arrows and Enter step over it in both directions", () => {
    expect(handleGridKey("ArrowDown", skip1({ cursor: cell(0, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 1),
    });
    expect(handleGridKey("ArrowUp", skip1({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(0, 0),
    });
    expect(handleGridKey("ArrowRight", skip1({ cursor: cell(0, 1) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
    expect(handleGridKey("ArrowLeft", skip1({ cursor: cell(2, 0) }))).toEqual({
      kind: "move",
      to: cell(0, 1),
    });
    expect(handleGridKey("Enter", skip1({ cursor: cell(0, 0) }))).toEqual({
      kind: "move",
      to: cell(2, 0),
    });
  });

  it("holds position when only such rows lie ahead", () => {
    const lastTwoForfeited = (over: Partial<GridContext>) =>
      ctx({ isRowEditable: (r) => r < 2, isRowComplete: () => true, ...over });
    expect(handleGridKey("ArrowDown", lastTwoForfeited({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(1, 0),
    });
    expect(handleGridKey("ArrowRight", lastTwoForfeited({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(1, 1),
    });
    expect(handleGridKey("Enter", lastTwoForfeited({ cursor: cell(1, 1) }))).toEqual({
      kind: "move",
      to: cell(1, 1),
    });
  });

  it("Home and End land on the first and last rows that have boxes", () => {
    const endsForfeited = (over: Partial<GridContext>) =>
      ctx({ isRowEditable: (r) => r === 1 || r === 2, ...over });
    expect(handleGridKey("Home", endsForfeited({ cursor: cell(2, 1) }))).toEqual({
      kind: "move",
      to: cell(1, 0),
    });
    expect(handleGridKey("End", endsForfeited({ cursor: cell(1, 0) }))).toEqual({
      kind: "move",
      to: cell(2, 1),
    });
  });

  it("never parks the cursor on one, even if it reads as unscored", () => {
    const action = handleGridKey(
      "2",
      ctx({
        cursor: cell(3, 1),
        isRowEditable: (r) => r !== 1,
        isRowComplete: (r) => r === 0 || r === 2,
        valueAt: valuesFrom({ "3:0": 4 }),
      }),
    );
    expect(action).toEqual({ kind: "write", at: cell(3, 1), value: 2, then: cell(3, 1) });
  });

  // The reported bug, end to end. Keys go to whichever input has focus, and
  // focus can only move to a row that has inputs — so when the handler pointed
  // at the forfeited table 2, focus stayed on table 1's second box and the next
  // digits replaced the score just entered there (a saved 3-1 became 3-5).
  it("typing 3 1 2 5 down the table scores tables 1 and 3, not table 1 twice", () => {
    type Pair = { p1: number | null; p2: number | null };
    const rows: Pair[] = [
      { p1: null, p2: null },
      { p1: 0, p2: 0 }, // forfeited: stored 0-0, no inputs
      { p1: null, p2: null },
    ];
    const hasInputs = (row: number) => row !== 1;
    const valueAt = (row: number, col: 0 | 1) =>
      col === 0 ? rows[row].p1 : rows[row].p2;

    let focus = cell(0, 0);
    for (const key of ["3", "1", "2", "5"]) {
      const action = handleGridKey(key, {
        cursor: focus,
        rowCount: rows.length,
        maxScore: 5,
        isRowComplete: (r) => valueAt(r, 0) !== null && valueAt(r, 1) !== null,
        valueAt,
        isRowEditable: hasInputs,
      });
      if (action.kind !== "write") throw new Error(`unexpected ${action.kind}`);
      if (action.at.col === 0) rows[action.at.row].p1 = action.value;
      else rows[action.at.row].p2 = action.value;
      // Mirrors useScoreGrid.focusCell: no input, no focus move.
      if (hasInputs(action.then.row)) focus = action.then;
    }

    expect(rows[0]).toEqual({ p1: 3, p2: 1 });
    expect(rows[2]).toEqual({ p1: 2, p2: 5 });
  });
});

describe("passthrough", () => {
  it("leaves Tab to the browser so native tab order still works", () => {
    expect(handleGridKey("Tab", ctx()).kind).toBe("passthrough");
  });

  it("ignores letters", () => {
    expect(handleGridKey("a", ctx()).kind).toBe("passthrough");
  });

  it("opens help on ?", () => {
    expect(handleGridKey("?", ctx()).kind).toBe("help");
  });

  it("does nothing at all when the round has no matches", () => {
    expect(handleGridKey("3", ctx({ rowCount: 0 })).kind).toBe("passthrough");
  });
});
