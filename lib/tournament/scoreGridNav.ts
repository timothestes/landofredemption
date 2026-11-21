// lib/tournament/scoreGridNav.ts
//
// Pure navigation + keystroke logic for the desktop score-entry grid.
//
// Kept free of React and DOM so the whole key map is unit-testable. The
// component layer owns focus (a roving tabindex over real <input> cells) and
// persistence; this module only answers "given the current cell and this key,
// where do we go and what do we write?".
//
// Single-digit assumption: tournaments.max_score is a <select> locked to 5 or 7
// (components/ui/TournamentSettings.tsx), so a score is always one character.
// That's what lets a digit keystroke both write AND advance — two keystrokes
// records a whole match.

/** Which of a match row's two score cells the cursor is on. */
export type ScoreColumn = 0 | 1;

/** A cell address within the round's match list. */
export interface CellRef {
  /** Index into the round's `matches` array. */
  row: number;
  col: ScoreColumn;
}

/** Result of interpreting one keystroke against the grid. */
export type GridAction =
  /** Move the cursor; write nothing. */
  | { kind: "move"; to: CellRef }
  /** Write `value` into `at`, then move the cursor to `then`. */
  | { kind: "write"; at: CellRef; value: number; then: CellRef }
  /**
   * Clear `at` back to unscored. Distinct from `write` because clearing has to
   * reach the database — a local-only clear leaves the host looking at a blank
   * cell while the old score is still recorded.
   */
  | { kind: "clear"; at: CellRef }
  /** Discard the in-progress edit on `at` and restore its saved value. */
  | { kind: "revert"; at: CellRef }
  /** Leave the grid entirely (blur back to the page). */
  | { kind: "exit" }
  /** Open the shortcuts cheatsheet. */
  | { kind: "help" }
  /** A digit outside 0..maxScore — reject it visibly, write nothing. */
  | { kind: "reject"; at: CellRef }
  /** Not a grid key; let the browser handle it. */
  | { kind: "passthrough" };

/** Everything the key handler needs to know about the grid's current state. */
export interface GridContext {
  cursor: CellRef;
  /** Number of match rows in the current round. */
  rowCount: number;
  /** Tournament max_score (5 or 7). Upper bound for a legal digit. */
  maxScore: number;
  /**
   * Per-row scored state, used by `nextUnscored`. Index-aligned with the
   * matches array; a row is "complete" once both its cells hold a value.
   */
  isRowComplete: (row: number) => boolean;
  /**
   * Current effective value of a cell (draft if any, else the saved score).
   * Lets the handler tell "this keystroke completes the row" from "the row is
   * still half-filled", which `isRowComplete` alone can't express.
   */
  valueAt: (row: number, col: ScoreColumn) => number | null;
  /** True when the in-progress edit on the cursor differs from what's saved. */
  isDirty?: boolean;
  /**
   * False for a row that renders no score cells (a forfeited match shows its
   * forfeit label instead). Focus can't land there, so navigation has to step
   * over it — a cursor "moved" onto such a row leaves focus where it was, and
   * the next digit overwrites the cell just filled. Absent = every row has cells.
   */
  isRowEditable?: (row: number) => boolean;
}

/**
 * The nearest row with score cells strictly beyond `from` in direction `step`,
 * or null when there is none before the edge of the grid.
 */
function nextEditableRow(
  from: number,
  step: 1 | -1,
  rowCount: number,
  isRowEditable?: (row: number) => boolean,
): number | null {
  for (let row = from + step; row >= 0 && row < rowCount; row += step) {
    if (!isRowEditable || isRowEditable(row)) return row;
  }
  return null;
}

/** The value in the cursor row's OTHER column. */
const valueAtOtherColumn = (ctx: GridContext): number | null =>
  ctx.valueAt(ctx.cursor.row, ctx.cursor.col === 0 ? 1 : 0);

/**
 * Step one cell to the right, wrapping P2 → next row's P1. Returns null when
 * already on the very last cell (caller decides whether that's a no-op or a
 * jump to the first unscored row).
 */
export function stepRight(
  cell: CellRef,
  rowCount: number,
  isRowEditable?: (row: number) => boolean,
): CellRef | null {
  if (cell.col === 0) return { row: cell.row, col: 1 };
  const row = nextEditableRow(cell.row, 1, rowCount, isRowEditable);
  return row === null ? null : { row, col: 0 };
}

/** Step one cell to the left, wrapping P1 → previous row's P2. */
export function stepLeft(
  cell: CellRef,
  rowCount: number,
  isRowEditable?: (row: number) => boolean,
): CellRef | null {
  if (cell.col === 1) return { row: cell.row, col: 0 };
  const row = nextEditableRow(cell.row, -1, rowCount, isRowEditable);
  return row === null ? null : { row, col: 1 };
}

/**
 * First cell of the first incomplete row at or after `from`, wrapping once to
 * the top. Returns null when every row is scored — that's the signal the round
 * is ready to end. This is the Excel "jump to the next blank" behavior, and it
 * targets exactly the rows End Round blocks on.
 */
export function nextUnscored(
  from: number,
  rowCount: number,
  isRowComplete: (row: number) => boolean,
): CellRef | null {
  for (let i = 0; i < rowCount; i++) {
    const row = (from + i) % rowCount;
    if (!isRowComplete(row)) return { row, col: 0 };
  }
  return null;
}

/** A row's two scores, either of which may still be unset. */
export interface ScorePair {
  p1: number | null;
  p2: number | null;
}

/**
 * Whether writing `next` over `current` should hit the database now.
 *
 * - `commit`  — this keystroke completed a previously incomplete row.
 * - `defer`   — the row was already complete, so this is a correction in
 *               progress. Holding the write until the cursor leaves the row
 *               means re-typing 3-1 as 1-3 produces ONE save, not a spurious
 *               1-1 tie followed by a race to overwrite it.
 * - `none`    — still half-filled; nothing to persist.
 *
 * Pure and exported so the rule is testable without rendering the grid; the
 * hook that owns draft state is where this used to live implicitly, and where
 * the intermediate-write bug lived with it.
 */
export function commitDecision(
  current: ScorePair,
  next: ScorePair,
): "commit" | "defer" | "none" {
  const nowComplete = next.p1 !== null && next.p2 !== null;
  if (!nowComplete) return "none";
  const wasComplete = current.p1 !== null && current.p2 !== null;
  return wasComplete ? "defer" : "commit";
}

/**
 * Whether a deferred correction still needs flushing when the cursor leaves.
 * Returns false when the draft matches what's already saved, so merely tabbing
 * across an untouched row doesn't fire a pointless write.
 */
export function needsFlush(draft: ScorePair | undefined, saved: ScorePair): boolean {
  if (!draft) return false;
  if (draft.p1 === null || draft.p2 === null) return false;
  return draft.p1 !== saved.p1 || draft.p2 !== saved.p2;
}

/** Modifier state of the keystroke. Absent fields are treated as false. */
export interface KeyModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * Interpret a keystroke. `key` is a raw KeyboardEvent.key.
 *
 * Enter is deliberately NOT a commit key — writes are committed by the
 * component when the cursor leaves a row, so a digit keystroke alone is enough.
 * Enter just advances to the next row, matching spreadsheet muscle memory.
 *
 * `mods` must be passed through from the event. Without it, Cmd+1 (switch to
 * browser tab 1) and Cmd+0 (reset zoom) arrive here as a bare "1"/"0" and get
 * written into the focused cell — a real score, silently saved.
 */
export function handleGridKey(
  key: string,
  ctx: GridContext,
  mods: KeyModifiers = {},
): GridAction {
  const { cursor, rowCount, maxScore, isRowEditable } = ctx;
  if (rowCount === 0) return { kind: "passthrough" };

  // A row without score cells never needs the cursor, whatever its scores say.
  const isRowComplete = (row: number) =>
    (isRowEditable ? !isRowEditable(row) : false) || ctx.isRowComplete(row);

  // Any Ctrl/Cmd/Alt combination belongs to the browser or the OS, never to the
  // grid. Bail before the digit branch so accelerators keep working untouched.
  if (mods.ctrlKey || mods.metaKey || mods.altKey) return { kind: "passthrough" };

  // A digit writes and auto-advances. This is the hot path: "3" "1" fills a
  // whole match and lands on the next one.
  if (/^[0-9]$/.test(key)) {
    const value = Number(key);
    if (value > maxScore) return { kind: "reject", at: cursor };
    const forward = stepRight(cursor, rowCount, isRowEditable);
    // Falling off the last cell parks on the first still-unscored row so the
    // host is never left staring at a dead cursor with blanks above them.
    const then =
      forward ??
      nextUnscored(0, rowCount, (r) =>
        // Treat the row we're completing as done, but only when this keystroke
        // actually completes it — on a half-filled row the other cell is still
        // blank and the host needs to be sent back to it.
        r === cursor.row
          ? valueAtOtherColumn(ctx) !== null
          : isRowComplete(r),
      ) ??
      cursor;
    return { kind: "write", at: cursor, value, then };
  }

  switch (key) {
    case "ArrowUp":
      return {
        kind: "move",
        to: {
          row: nextEditableRow(cursor.row, -1, rowCount, isRowEditable) ?? cursor.row,
          col: cursor.col,
        },
      };

    case "ArrowDown":
      return {
        kind: "move",
        to: {
          row: nextEditableRow(cursor.row, 1, rowCount, isRowEditable) ?? cursor.row,
          col: cursor.col,
        },
      };

    case "ArrowLeft":
      return { kind: "move", to: stepLeft(cursor, rowCount, isRowEditable) ?? cursor };

    case "ArrowRight":
      return { kind: "move", to: stepRight(cursor, rowCount, isRowEditable) ?? cursor };

    case "Enter": {
      const below = nextEditableRow(cursor.row, 1, rowCount, isRowEditable);
      const target =
        below !== null
          ? { row: below, col: 0 as ScoreColumn }
          : nextUnscored(0, rowCount, isRowComplete);
      // Every row scored and Enter pressed on the last one — hold position
      // rather than wrapping the host back to the top unnecessarily.
      return { kind: "move", to: target ?? cursor };
    }

    case "Backspace":
    case "Delete":
      return { kind: "clear", at: cursor };

    case "Home":
      return {
        kind: "move",
        to: { row: nextEditableRow(-1, 1, rowCount, isRowEditable) ?? cursor.row, col: 0 },
      };

    case "End":
      return {
        kind: "move",
        to: { row: nextEditableRow(rowCount, -1, rowCount, isRowEditable) ?? cursor.row, col: 1 },
      };

    case "Escape":
      // First Escape abandons the in-progress edit; a second one (nothing left
      // to revert) releases focus back to the page.
      return ctx.isDirty ? { kind: "revert", at: cursor } : { kind: "exit" };

    case "?":
      return { kind: "help" };

    default:
      // Tab/Shift+Tab included: DOM order already matches the grid order, so
      // the browser's native tabbing is correct. Don't fight it.
      return { kind: "passthrough" };
  }
}
