"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import {
  saveMatchScore,
  validateScorePair,
  SESSION_EXPIRED_MESSAGE,
} from "../../utils/tournament/saveMatchScore";
import { saveWithRetry } from "../../lib/tournament/saveRetry";
import {
  handleGridKey,
  commitDecision,
  needsFlush,
  type CellRef,
  type ScoreColumn,
} from "../../lib/tournament/scoreGridNav";

/**
 * Cursor, optimistic draft state, and background persistence for the desktop
 * keyboard score grid.
 *
 * Saving is deliberately decoupled from typing: a digit updates local state and
 * moves the cursor immediately, and the write fires in the background once a
 * row holds both scores. The host never waits on a round-trip.
 */

export type RowSaveState = "idle" | "saving" | "saved" | "error";

/** Local, not-yet-confirmed scores, keyed by match id. */
type Draft = Record<string, { p1: number | null; p2: number | null }>;

export interface ScoreGridMatch {
  id: string;
  player1_id: { id: string; name: string };
  player2_id: { id: string; name: string };
  player1_score: number | null;
  player2_score: number | null;
}

/** How long a green "saved" tick stays up before the row goes quiet again. */
const SAVED_INDICATOR_MS = 2000;

export function useScoreGrid({
  matches,
  maxScore,
  enabled,
  onSaved,
  onOpenHelp,
}: {
  matches: ScoreGridMatch[];
  maxScore: number;
  enabled: boolean;
  /** Called after a successful write so the parent can refetch. */
  onSaved?: (matchId: string) => void;
  onOpenHelp?: () => void;
}) {
  const [cursor, setCursor] = useState<CellRef | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saveState, setSaveState] = useState<Record<string, RowSaveState>>({});
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  // Rows whose last write to the database failed, as opposed to rows in
  // "error" because the typed pair is illegal. Only these can be retried.
  const [writeFailed, setWriteFailed] = useState<Record<string, boolean>>({});
  const [rejected, setRejected] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Latest draft, readable from async callbacks without going stale. `draft`
  // state drives rendering; this mirror is what commit logic reads.
  const draftRef = useRef<Draft>({});
  useEffect(() => { draftRef.current = draft; }, [draft]);

  // Monotonic per-match write counter. A response only gets to touch state if
  // it belongs to the newest write for that row, so two commits racing on the
  // same match can't resolve out of order and leave the earlier value showing.
  const writeSeq = useRef<Map<string, number>>(new Map());
  const savedTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const timers = savedTimers.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  const cellKey = (row: number, col: ScoreColumn) => `${row}:${col}`;

  const registerInput = useCallback(
    (row: number, col: ScoreColumn, el: HTMLInputElement | null) => {
      const key = cellKey(row, col);
      if (el) inputRefs.current.set(key, el);
      else inputRefs.current.delete(key);
    },
    [],
  );

  /** Effective value for a cell: the local draft if present, else the DB value. */
  const valueAt = useCallback(
    (row: number, col: ScoreColumn): number | null => {
      const match = matches[row];
      if (!match) return null;
      const d = draft[match.id];
      if (d) return col === 0 ? d.p1 : d.p2;
      return col === 0 ? match.player1_score : match.player2_score;
    },
    [matches, draft],
  );

  const isRowComplete = useCallback(
    (row: number) => valueAt(row, 0) !== null && valueAt(row, 1) !== null,
    [valueAt],
  );

  /**
   * Move the cursor and focus synchronously.
   *
   * Focusing on a later frame is not safe here: the cell a keystroke targets is
   * derived from the focused element, so if a re-render (every save triggers
   * one) delays the focus move past the next keypress, that keypress lands on
   * the cell we just left and overwrites the score just entered. Every row is
   * already mounted, so the ref is always populated and this can be immediate.
   *
   * The one row with no ref is a forfeited match, which renders no cells. The
   * key handler steps over those; if a target without an input arrives anyway,
   * leave the cursor on the cell that still has focus rather than pointing it
   * at a row the next keystroke can't reach.
   */
  const focusCell = useCallback((to: CellRef) => {
    const el = inputRefs.current.get(cellKey(to.row, to.col));
    if (!el) return;
    setCursor(to);
    el.focus();
    el.select();
  }, []);

  const markSaved = useCallback((matchId: string) => {
    setSaveState((s) => ({ ...s, [matchId]: "saved" }));
    const existing = savedTimers.current.get(matchId);
    if (existing) clearTimeout(existing);
    savedTimers.current.set(
      matchId,
      setTimeout(() => {
        setSaveState((s) => (s[matchId] === "saved" ? { ...s, [matchId]: "idle" } : s));
        savedTimers.current.delete(matchId);
      }, SAVED_INDICATOR_MS),
    );
  }, []);

  /**
   * Persist a row. Only ever called with a complete, legal pair — partial rows
   * and illegal pairs are filtered by the callers so a half-typed correction
   * never reaches the database.
   */
  const commitRow = useCallback(
    async (row: number, next: { p1: number; p2: number }) => {
      const match = matches[row];
      if (!match) return;

      setWriteFailed((f) => (f[match.id] ? { ...f, [match.id]: false } : f));

      const invalid = validateScorePair(next.p1, next.p2, maxScore);
      if (invalid) {
        setSaveState((s) => ({ ...s, [match.id]: "error" }));
        setSaveError((e) => ({ ...e, [match.id]: invalid }));
        return;
      }

      const seq = (writeSeq.current.get(match.id) ?? 0) + 1;
      writeSeq.current.set(match.id, seq);

      setSaveState((s) => ({ ...s, [match.id]: "saving" }));
      setSaveError((e) => { const { [match.id]: _drop, ...rest } = e; return rest; });

      // A dropped request is re-sent twice before the row is marked unsaved.
      // Not when the session is gone (a retry can't fix that), and not once a
      // newer write for this row has started.
      const result = await saveWithRetry(
        () =>
          saveMatchScore(createClient(), {
            matchId: match.id,
            player1Id: match.player1_id.id,
            player2Id: match.player2_id.id,
            player1Score: next.p1,
            player2Score: next.p2,
            maxScore,
          }),
        {
          shouldRetry: (error) =>
            error !== SESSION_EXPIRED_MESSAGE &&
            writeSeq.current.get(match.id) === seq,
        },
      );

      // A newer write for this row superseded us — discard this response.
      if (writeSeq.current.get(match.id) !== seq) return;

      if (result.ok === false) {
        setSaveState((s) => ({ ...s, [match.id]: "error" }));
        setSaveError((e) => ({ ...e, [match.id]: result.error }));
        setWriteFailed((f) => ({ ...f, [match.id]: true }));
        return;
      }

      markSaved(match.id);
      // The draft is deliberately NOT dropped here. onSaved only *schedules* a
      // refetch; dropping now would blank the cells for a full round-trip. The
      // effect below retires each draft when the refetched row matches it.
      onSaved?.(match.id);
    },
    [matches, maxScore, onSaved, markSaved],
  );

  /**
   * Retire drafts once the refetched `matches` agree with them. This is what
   * makes the optimistic value survive the gap between save and refetch, and
   * it self-heals: a draft the server never accepted stays visible.
   */
  useEffect(() => {
    setDraft((d) => {
      if (Object.keys(d).length === 0) return d;
      let changed = false;
      const next: Draft = {};
      for (const [matchId, value] of Object.entries(d)) {
        const row = matches.find((m) => m.id === matchId);
        const settled =
          row &&
          row.player1_score === value.p1 &&
          row.player2_score === value.p2;
        if (settled) changed = true;
        else next[matchId] = value;
      }
      return changed ? next : d;
    });
  }, [matches]);

  /**
   * Drop whatever was typed into a row so its cells show the saved result
   * again. For a save made outside the grid (the pencil dialog): the effect
   * above only retires a draft the saved row agrees with, so a half-typed
   * row, a rejected pair, or a cleared cell would otherwise keep showing
   * over the dialog's result until a reload.
   */
  const discardDraft = useCallback((matchId: string) => {
    if (draftRef.current[matchId] !== undefined) {
      const { [matchId]: _drop, ...rest } = draftRef.current;
      draftRef.current = rest;
      setDraft(rest);
    }
    // A rejected pair's error belongs to the typed value that is now gone.
    setSaveState((s) => (s[matchId] === "error" ? { ...s, [matchId]: "idle" } : s));
  }, []);

  const draftFor = useCallback(
    (match: ScoreGridMatch) =>
      draftRef.current[match.id] ?? {
        p1: match.player1_score,
        p2: match.player2_score,
      },
    [],
  );

  const writeCell = useCallback(
    (at: CellRef, value: number) => {
      const match = matches[at.row];
      if (!match) return;
      const current = draftFor(match);
      const next =
        at.col === 0 ? { ...current, p1: value } : { ...current, p2: value };

      draftRef.current = { ...draftRef.current, [match.id]: next };
      setDraft((d) => ({ ...d, [match.id]: next }));

      switch (commitDecision(current, next)) {
        case "commit":
          void commitRow(at.row, { p1: next.p1 as number, p2: next.p2 as number });
          break;
        case "defer":
          // Correction in progress — flushRow persists it when the cursor
          // leaves, so two digits produce one save rather than an intermediate.
          setSaveState((s) => ({ ...s, [match.id]: "idle" }));
          break;
        case "none":
          break;
      }
    },
    [matches, draftFor, commitRow],
  );

  /**
   * Flush a pending correction when the cursor leaves its row. Pairs with
   * writeCell's deferral so re-typing both scores is a single write.
   */
  const flushRow = useCallback(
    (row: number) => {
      const match = matches[row];
      if (!match) return;
      const d = draftRef.current[match.id];
      const saved = { p1: match.player1_score, p2: match.player2_score };
      if (!needsFlush(d, saved)) return;
      void commitRow(row, { p1: d!.p1 as number, p2: d!.p2 as number });
    },
    [matches, commitRow],
  );

  /**
   * Blur handler for a cell. Flushes only when focus is genuinely LEAVING the
   * row — moving P1 → P2 within a row must not flush, or a correction commits
   * its half-typed intermediate (retyping 3-1 as 1-3 would save 1-1 the moment
   * the cursor crossed to P2, exactly the write the deferral exists to avoid).
   *
   * This is the single flush point: focusCell is synchronous, so every cursor
   * move — keyboard, click, or exit — produces a blur here.
   */
  const onBlurCell = useCallback(
    (e: React.FocusEvent, row: number) => {
      const next = e.relatedTarget as Node | null;
      if (next) {
        const p1 = inputRefs.current.get(cellKey(row, 0));
        const p2 = inputRefs.current.get(cellKey(row, 1));
        if (next === p1 || next === p2) return; // still inside this row
      }
      flushRow(row);
    },
    [flushRow],
  );

  /** Clear a cell locally AND in the database, so the two can't disagree. */
  const clearCell = useCallback(
    async (at: CellRef) => {
      const match = matches[at.row];
      if (!match) return;
      const current = draftFor(match);
      const next =
        at.col === 0 ? { ...current, p1: null } : { ...current, p2: null };

      draftRef.current = { ...draftRef.current, [match.id]: next };
      setDraft((d) => ({ ...d, [match.id]: next }));

      // Nothing recorded yet — the local clear is the whole job.
      if (match.player1_score === null && match.player2_score === null) {
        setSaveState((s) => ({ ...s, [match.id]: "idle" }));
        return;
      }

      const seq = (writeSeq.current.get(match.id) ?? 0) + 1;
      writeSeq.current.set(match.id, seq);
      setSaveState((s) => ({ ...s, [match.id]: "saving" }));
      setWriteFailed((f) => (f[match.id] ? { ...f, [match.id]: false } : f));

      const client = createClient();
      const { error } = await client
        .from("matches")
        .update({
          player1_score: null,
          player2_score: null,
          is_tie: null,
          winner_id: null,
          updated_at: new Date(),
        })
        .eq("id", match.id);

      if (writeSeq.current.get(match.id) !== seq) return;

      if (error) {
        setSaveState((s) => ({ ...s, [match.id]: "error" }));
        setSaveError((e) => ({
          ...e,
          [match.id]: "Couldn't clear this result. Please try again.",
        }));
        setWriteFailed((f) => ({ ...f, [match.id]: true }));
        return;
      }

      markSaved(match.id);
      onSaved?.(match.id);
    },
    [matches, draftFor, onSaved, markSaved],
  );

  /**
   * True while a row shows digits (or a blank) that did not save: its last
   * write failed and what was typed is still on screen. Goes false as soon
   * as the typed value is dropped (Escape, or a save from the pencil dialog).
   */
  const isUnsaved = useCallback(
    (matchId: string) =>
      saveState[matchId] === "error" &&
      writeFailed[matchId] === true &&
      draft[matchId] !== undefined,
    [saveState, writeFailed, draft],
  );

  /** Send a row's unsaved value again: the typed pair, or the clear. */
  const retryRow = useCallback(
    (row: number) => {
      const match = matches[row];
      if (!match) return;
      const d = draftRef.current[match.id];
      if (!d) return;
      if (d.p1 !== null && d.p2 !== null) {
        void commitRow(row, { p1: d.p1, p2: d.p2 });
      } else {
        void clearCell({ row, col: d.p1 === null ? 0 : 1 });
      }
    },
    [matches, commitRow, clearCell],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, at: CellRef) => {
      if (!enabled) return;

      const match = matches[at.row];
      const action = handleGridKey(
        e.key,
        {
          cursor: at,
          rowCount: matches.length,
          maxScore,
          isRowComplete,
          valueAt,
          isDirty: match ? draftRef.current[match.id] !== undefined : false,
          // A forfeited row registers no inputs; navigation must skip it.
          isRowEditable: (row) => inputRefs.current.has(cellKey(row, 0)),
        },
        { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey },
      );

      if (action.kind === "passthrough") return;
      e.preventDefault();
      // The cheatsheet's Dialog listens for Escape on document; without this the
      // same press would both close it and discard the cell underneath.
      e.stopPropagation();

      switch (action.kind) {
        // No explicit flush on either of these: focusCell moves focus
        // synchronously, so onBlurCell fires and decides whether the row is
        // actually being left. Flushing here too would double-post the write.
        case "move":
          focusCell(action.to);
          break;
        case "write":
          writeCell(action.at, action.value);
          focusCell(action.then);
          break;
        case "clear":
          void clearCell(action.at);
          break;
        case "revert": {
          if (match) {
            const { [match.id]: _drop, ...rest } = draftRef.current;
            draftRef.current = rest;
            setDraft(rest);
            setSaveState((s) => ({ ...s, [match.id]: "idle" }));
          }
          break;
        }
        case "exit":
          inputRefs.current.get(cellKey(at.row, at.col))?.blur();
          setCursor(null);
          break;
        case "reject": {
          const key = cellKey(action.at.row, action.at.col);
          setRejected(key);
          setTimeout(() => setRejected((r) => (r === key ? null : r)), 400);
          break;
        }
        case "help":
          onOpenHelp?.();
          break;
      }
    },
    [
      enabled,
      matches,
      maxScore,
      isRowComplete,
      valueAt,
      focusCell,
      writeCell,
      clearCell,
      flushRow,
      onOpenHelp,
    ],
  );

  const isCursor = useCallback(
    (row: number, col: ScoreColumn) =>
      cursor?.row === row && cursor?.col === col,
    [cursor],
  );

  const isRejected = useCallback(
    (row: number, col: ScoreColumn) => rejected === cellKey(row, col),
    [rejected],
  );

  return {
    cursor,
    valueAt,
    saveState,
    saveError,
    registerInput,
    focusCell,
    onBlurCell,
    onKeyDown,
    discardDraft,
    isCursor,
    isRejected,
    isUnsaved,
    retryRow,
  };
}
