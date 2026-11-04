"use client";

import { useReducer, useMemo, useRef, useEffect, useCallback, useState } from "react";
import { BarChart3, TriangleAlert } from "lucide-react";
import { useSeed } from "../seed-context";
import type { ViewId } from "../NavTabs";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";
import { DataCoverageModal } from "../components/DataCoverageModal";
import {
  AM_MODES,
  AM_COLS,
  computeMetric,
  sortRows,
  type MetricFilters,
  type Col,
} from "@/lib/nationals/metrics";

// ── Format label ↔ internal key ──────────────────────────────────────────────

function fmtLabel(f: string): string {
  if (f === "Booster Draft") return "Booster Draft (2P)";
  return f;
}

const FULL_THRESH = 3;
const SKIP_FMTS = new Set(["Sealed 2-Player", "Sealed Multiplayer"]);

/** Returns { labels: string[]; map: Map<label, internalKey> }. "All" is first. */
function getAllFmts(
  results: Record<string, unknown[]>,
  multiWL?: Record<string, Record<string, unknown>> | null
): { labels: string[]; map: Map<string, string> } {
  const fmts = new Set<string>();
  Object.keys(results).forEach((k) => {
    const u = k.indexOf("_");
    const fmt = k.slice(u + 1);
    if (fmt) fmts.add(fmt);
  });
  const display = new Map<string, string>();
  Array.from(fmts)
    .filter((f) => f && !SKIP_FMTS.has(f))
    .forEach((f) => display.set(fmtLabel(f), f));
  if (multiWL) {
    Object.values(multiWL).forEach((d) => {
      if (d && typeof d === "object") {
        Object.keys(d).forEach((f) => {
          if (!SKIP_FMTS.has(f)) display.set(f, f);
        });
      }
    });
  }
  const sorted = ["All", ...Array.from(display.keys()).sort()];
  return { labels: sorted, map: display };
}

/** Returns all years that have full-standings entries, sorted. */
function getFullYears(results: Record<string, unknown[]>): number[] {
  const s = new Set<number>();
  Object.entries(results).forEach(([k, entries]) => {
    if (entries.length > FULL_THRESH) {
      const yr = parseInt(k.slice(0, k.indexOf("_")));
      s.add(yr);
    }
  });
  return Array.from(s).sort((a, b) => a - b);
}

// ── State ────────────────────────────────────────────────────────────────────

interface UIState {
  filters: MetricFilters;
  // sort overrides (empty = use default from cols)
  sortCol: string;
  sortAsc: boolean;
  // custom year picker open
  yearPickerOpen: boolean;
  // compare typeahead
  compareQuery: string;
  compareDropdownOpen: boolean;
  // vsp typeahead
  vspQuery: string;
  vspDropdownOpen: boolean;
  // format multi-select modal
  fmtModalOpen: boolean;
  fmtModalScratch: Set<string>; // labels (not internal keys)
  // "display labels" for selected formats (Set<label>; 'All' or specific labels)
  selectedFmtLabels: Set<string>;
}

type Action =
  | { type: "SET_MODE"; mode: string }
  | { type: "SET_FMT_LABELS"; labels: Set<string>; internalKeys: Set<string> }
  | { type: "SET_YEAR_FROM"; year: number }
  | { type: "SET_YEAR_TO"; year: number }
  | { type: "TOGGLE_CUSTOM_YEAR"; year: number }
  | { type: "SELECT_ALL_YEARS"; years: number[] }
  | { type: "CLEAR_ALL_YEARS" }
  | { type: "RESET_YEARS" }
  | { type: "TOGGLE_YEAR_PICKER" }
  | { type: "SET_MIN_APP"; val: number }
  | { type: "SET_MAX_APP"; val: number }
  | { type: "SET_MIN_NATS"; val: number }
  | { type: "SET_MAX_NATS"; val: number }
  | { type: "SET_COMPARE_QUERY"; q: string }
  | { type: "SET_COMPARE_PLAYER"; name: string }
  | { type: "CLEAR_COMPARE" }
  | { type: "SET_COMPARE_DROPDOWN"; open: boolean }
  | { type: "SET_RIVALRY_MODE"; mode: "wins" | "losses" }
  | { type: "SET_VSP_QUERY"; q: string }
  | { type: "SET_VSP_TARGET"; name: string }
  | { type: "CLEAR_VSP" }
  | { type: "SET_VSP_DROPDOWN"; open: boolean }
  | { type: "OPEN_FMT_MODAL"; scratch: Set<string> }
  | { type: "CLOSE_FMT_MODAL" }
  | { type: "FMT_MODAL_TOGGLE"; label: string }
  | { type: "FMT_MODAL_SELECT_ALL"; allLabels: string[] }
  | { type: "FMT_MODAL_CLEAR" }
  | { type: "FMT_MODAL_APPLY"; allLabels: string[]; map: Map<string, string> }
  | { type: "SET_SORT"; col: string; dfltAsc: boolean }
  | { type: "SELECT_FMT_SIMPLE"; label: string; internalKey: string };

const INITIAL_FILTERS: MetricFilters = {
  mode: "winpct",
  formats: new Set(["All"]),
  yearFrom: 2003,
  yearTo: 2025,
  customYears: null,
  minApp: 2,
  maxApp: 999,
  minNats: 1,
  maxNats: 99,
  comparePlayer: null,
  rivalryMode: "wins",
  vspTarget: null,
};

const INITIAL_STATE: UIState = {
  filters: INITIAL_FILTERS,
  sortCol: "",
  sortAsc: false,
  yearPickerOpen: false,
  compareQuery: "",
  compareDropdownOpen: false,
  vspQuery: "",
  vspDropdownOpen: false,
  fmtModalOpen: false,
  fmtModalScratch: new Set(),
  selectedFmtLabels: new Set(["All"]),
};

function reducer(state: UIState, action: Action): UIState {
  switch (action.type) {
    case "SET_MODE":
      return {
        ...state,
        filters: { ...state.filters, mode: action.mode },
        sortCol: "",
        sortAsc: false,
      };

    case "SET_FMT_LABELS":
      return {
        ...state,
        selectedFmtLabels: action.labels,
        filters: { ...state.filters, formats: action.internalKeys },
        sortCol: "",
      };

    case "SELECT_FMT_SIMPLE": {
      const labels = new Set([action.label]);
      const keys =
        action.label === "All"
          ? new Set(["All"])
          : new Set([action.internalKey]);
      return {
        ...state,
        selectedFmtLabels: labels,
        filters: { ...state.filters, formats: keys },
        sortCol: "",
      };
    }

    case "SET_YEAR_FROM":
      return {
        ...state,
        filters: {
          ...state.filters,
          yearFrom: action.year,
          yearTo: Math.max(state.filters.yearTo, action.year),
          customYears: null,
        },
      };

    case "SET_YEAR_TO":
      return {
        ...state,
        filters: {
          ...state.filters,
          yearTo: action.year,
          yearFrom: Math.min(state.filters.yearFrom, action.year),
          customYears: null,
        },
      };

    case "TOGGLE_CUSTOM_YEAR": {
      const prev =
        state.filters.customYears ?? buildRangeSet(state.filters.yearFrom, state.filters.yearTo);
      const next = new Set(prev);
      if (next.has(action.year)) next.delete(action.year);
      else next.add(action.year);
      return { ...state, filters: { ...state.filters, customYears: next } };
    }

    case "SELECT_ALL_YEARS":
      return {
        ...state,
        filters: { ...state.filters, customYears: new Set(action.years) },
      };

    case "CLEAR_ALL_YEARS":
      return {
        ...state,
        filters: { ...state.filters, customYears: new Set() },
      };

    case "RESET_YEARS":
      return {
        ...state,
        filters: {
          ...state.filters,
          yearFrom: 2003,
          yearTo: 2025,
          customYears: null,
        },
        yearPickerOpen: false,
      };

    case "TOGGLE_YEAR_PICKER":
      return { ...state, yearPickerOpen: !state.yearPickerOpen };

    case "SET_MIN_APP":
      return { ...state, filters: { ...state.filters, minApp: action.val } };

    case "SET_MAX_APP":
      return { ...state, filters: { ...state.filters, maxApp: action.val } };

    case "SET_MIN_NATS":
      return { ...state, filters: { ...state.filters, minNats: action.val } };

    case "SET_MAX_NATS":
      return { ...state, filters: { ...state.filters, maxNats: action.val } };

    case "SET_COMPARE_QUERY":
      return {
        ...state,
        compareQuery: action.q,
        compareDropdownOpen: action.q.trim().length >= 2,
      };

    case "SET_COMPARE_PLAYER":
      return {
        ...state,
        filters: { ...state.filters, comparePlayer: action.name },
        compareQuery: action.name,
        compareDropdownOpen: false,
      };

    case "CLEAR_COMPARE":
      return {
        ...state,
        filters: { ...state.filters, comparePlayer: null },
        compareQuery: "",
        compareDropdownOpen: false,
      };

    case "SET_COMPARE_DROPDOWN":
      return { ...state, compareDropdownOpen: action.open };

    case "SET_RIVALRY_MODE":
      return {
        ...state,
        filters: { ...state.filters, rivalryMode: action.mode },
        sortCol: "",
      };

    case "SET_VSP_QUERY":
      return {
        ...state,
        vspQuery: action.q,
        vspDropdownOpen: action.q.trim().length >= 2,
      };

    case "SET_VSP_TARGET":
      return {
        ...state,
        filters: { ...state.filters, vspTarget: action.name },
        vspQuery: action.name,
        vspDropdownOpen: false,
        sortCol: "",
      };

    case "CLEAR_VSP":
      return {
        ...state,
        filters: { ...state.filters, vspTarget: null },
        vspQuery: "",
        vspDropdownOpen: false,
      };

    case "SET_VSP_DROPDOWN":
      return { ...state, vspDropdownOpen: action.open };

    case "OPEN_FMT_MODAL":
      return { ...state, fmtModalOpen: true, fmtModalScratch: action.scratch };

    case "CLOSE_FMT_MODAL":
      return { ...state, fmtModalOpen: false };

    case "FMT_MODAL_TOGGLE": {
      const next = new Set(state.fmtModalScratch);
      if (next.has(action.label)) next.delete(action.label);
      else next.add(action.label);
      return { ...state, fmtModalScratch: next };
    }

    case "FMT_MODAL_SELECT_ALL":
      return { ...state, fmtModalScratch: new Set(action.allLabels) };

    case "FMT_MODAL_CLEAR":
      return { ...state, fmtModalScratch: new Set() };

    case "FMT_MODAL_APPLY": {
      const scratch = state.fmtModalScratch;
      const allFmts = new Set(action.allLabels);
      let labels: Set<string>;
      let keys: Set<string>;
      if (
        scratch.size === 0 ||
        (scratch.size === allFmts.size &&
          [...scratch].every((f) => allFmts.has(f)))
      ) {
        // All selected → treat as "All"
        labels = new Set(["All"]);
        keys = new Set(["All"]);
      } else {
        labels = new Set(scratch);
        keys = new Set<string>();
        scratch.forEach((lbl) => {
          const internal = action.map.get(lbl);
          if (internal) keys.add(internal);
          else keys.add(lbl);
        });
      }
      return {
        ...state,
        fmtModalOpen: false,
        selectedFmtLabels: labels,
        filters: { ...state.filters, formats: keys },
        sortCol: "",
      };
    }

    case "SET_SORT": {
      const newAsc =
        state.sortCol === action.col ? !state.sortAsc : action.dfltAsc;
      return { ...state, sortCol: action.col, sortAsc: newAsc };
    }

    default:
      return state;
  }
}

function buildRangeSet(from: number, to: number): Set<number> {
  const s = new Set<number>();
  for (let y = from; y <= to; y++) s.add(y);
  return s;
}

function activeYearsSet(filters: MetricFilters): Set<number> {
  if (filters.customYears) return filters.customYears;
  return buildRangeSet(filters.yearFrom, filters.yearTo);
}

// ── Cell formatter ────────────────────────────────────────────────────────────

function formatCell(col: Col, val: unknown, mode: string): string {
  if (val === null || val === undefined) return "—";
  if (col.id === "pct" || col.id === "podiumRate") {
    const n = val as number;
    return (n * 100).toFixed(1) + "%";
  }
  const n = typeof val === "number" ? val : null;
  if (mode === "lsd") {
    if (col.id === "avg" && n !== null) {
      const sign = n >= 0 ? "+" : "";
      return sign + (n % 1 === 0 ? String(n) : n.toFixed(1));
    }
    if (col.id === "best" && n !== null) {
      return "+" + String(n);
    }
    if (col.id === "worst" && n !== null) {
      return String(n);
    }
    if (col.id === "total" && n !== null) {
      return (n >= 0 ? "+" : "") + String(n);
    }
  }
  if (mode === "pts") {
    if ((col.id === "avg" || col.id === "total" || col.id === "best") && n !== null) {
      return n.toFixed(1);
    }
  }
  if (mode === "placement") {
    if (col.id === "avg" && n !== null) {
      return n % 1 === 0 ? String(n) : n.toFixed(2);
    }
  }
  if (mode === "percentile") {
    if ((col.id === "avg" || col.id === "best" || col.id === "worst") && n !== null) {
      return n.toFixed(1) + "%";
    }
  }
  if (n !== null) return String(n);
  return String(val);
}

// ── All player names for typeahead ────────────────────────────────────────────

function allPlayerNames(seed: ReturnType<typeof useSeed>): string[] {
  const names = new Set<string>();
  Object.values(seed.results).forEach((entries) =>
    entries.forEach((e) => {
      if (e.playerName && e.playerName !== "bye") names.add(e.playerName);
    })
  );
  if (seed.multiWL) {
    Object.keys(seed.multiWL).forEach((n) => names.add(n));
  }
  return Array.from(names).sort();
}

// ── Subtitle helper ───────────────────────────────────────────────────────────

function buildSubtitle(
  filters: MetricFilters,
  selectedFmtLabels: Set<string>
): string {
  const mode = AM_MODES.find((m) => m.id === filters.mode);
  const yrs = [...activeYearsSet(filters)].sort((a, b) => a - b);
  const span =
    yrs.length > 6 ? `${yrs[0]}–${yrs[yrs.length - 1]}` : yrs.join(", ");
  const fmtLabel =
    selectedFmtLabels.has("All") || selectedFmtLabels.size === 0
      ? "All Formats"
      : selectedFmtLabels.size === 1
      ? [...selectedFmtLabels][0]
      : `Custom (${selectedFmtLabels.size} formats)`;
  return `${mode?.label ?? "?"} · ${fmtLabel} · ${span}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MetricsViewProps {
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
}

export function MetricsView({ setView }: MetricsViewProps) {
  const seed = useSeed();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { filters, sortCol, sortAsc, selectedFmtLabels } = state;

  // Derived: format labels available
  const { labels: fmtLabels, map: fmtMap } = useMemo(
    () => getAllFmts(seed.results, seed.multiWL),
    [seed.results, seed.multiWL]
  );

  // Derived: full years list
  const allYears = useMemo(() => getFullYears(seed.results), [seed.results]);

  // Derived: all player names for typeaheads
  const playerNames = useMemo(() => allPlayerNames(seed), [seed]);

  // Derived: metric result
  const { columns, rows: rawRows } = useMemo(
    () => computeMetric(seed, filters),
    [seed, filters]
  );

  // Derived: sorted rows (user sort overrides default)
  const rows = useMemo(() => {
    if (!sortCol) return rawRows; // computeMetric already applied default sort
    return sortRows(rawRows, columns, sortCol, sortAsc);
  }, [rawRows, columns, sortCol, sortAsc]);

  // Active years for custom picker highlighting
  const activeYrs = useMemo(() => activeYearsSet(filters), [filters]);

  // Subtitle
  const subtitle = useMemo(
    () => buildSubtitle(filters, selectedFmtLabels),
    [filters, selectedFmtLabels]
  );

  // Format dropdown select value
  const fmtSelectVal = useMemo(() => {
    if (selectedFmtLabels.has("All") || selectedFmtLabels.size === 0)
      return "All";
    if (selectedFmtLabels.size === 1) return [...selectedFmtLabels][0];
    return "__custom__";
  }, [selectedFmtLabels]);

  // Resolve active sort col/asc (fall back to column default)
  const activeSortCol = useMemo(() => {
    if (sortCol) return sortCol;
    if (filters.mode === "rivalry")
      return filters.rivalryMode === "wins" ? "W" : "L";
    return columns.find((c) => c.dflt)?.id ?? "";
  }, [sortCol, filters.mode, filters.rivalryMode, columns]);

  const activeSortAsc = useMemo(() => {
    if (sortCol) return sortAsc;
    if (filters.mode === "rivalry") return false;
    return !!(columns.find((c) => c.dflt)?.dfltAsc);
  }, [sortCol, sortAsc, filters.mode, columns]);

  // Compare typeahead matches
  const compareMatches = useMemo(() => {
    if (!state.compareDropdownOpen) return [];
    const q = state.compareQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return playerNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 10);
  }, [state.compareDropdownOpen, state.compareQuery, playerNames]);

  // VSP typeahead matches
  const vspMatches = useMemo(() => {
    if (!state.vspDropdownOpen) return [];
    const q = state.vspQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return playerNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 10);
  }, [state.vspDropdownOpen, state.vspQuery, playerNames]);

  // Close dropdowns on outside click
  const compareRef = useRef<HTMLDivElement>(null);
  const vspRef = useRef<HTMLDivElement>(null);
  const handleDocClick = useCallback((e: MouseEvent) => {
    if (compareRef.current && !compareRef.current.contains(e.target as Node)) {
      dispatch({ type: "SET_COMPARE_DROPDOWN", open: false });
    }
    if (vspRef.current && !vspRef.current.contains(e.target as Node)) {
      dispatch({ type: "SET_VSP_DROPDOWN", open: false });
    }
  }, []);
  useEffect(() => {
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [handleDocClick]);

  // Data-coverage disclaimer modal
  const [coverageOpen, setCoverageOpen] = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleFmtSelectChange(val: string) {
    if (val === "__custom__") {
      const allLabels = fmtLabels.filter((l) => l !== "All");
      const scratch =
        selectedFmtLabels.has("All") || selectedFmtLabels.size === 0
          ? new Set(allLabels)
          : new Set(selectedFmtLabels);
      dispatch({ type: "OPEN_FMT_MODAL", scratch });
    } else {
      const internalKey = val === "All" ? "All" : fmtMap.get(val) ?? val;
      dispatch({ type: "SELECT_FMT_SIMPLE", label: val, internalKey });
    }
  }

  function handleColClick(col: Col) {
    if (col.nosort) return;
    const dfltAsc = col.dfltAsc ?? true;
    dispatch({ type: "SET_SORT", col: col.id, dfltAsc });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const inputCls =
    "bg-card border border-border text-foreground rounded-md text-sm px-2.5 py-1.5 focus-visible:outline-none focus-visible:border-primary transition";
  const labelCls =
    "text-[0.72rem] font-medium uppercase tracking-wide text-muted-foreground mb-1";
  const btnCls =
    "px-2.5 py-1.5 rounded-md border border-border bg-muted text-muted-foreground text-xs cursor-pointer hover:bg-accent transition";

  return (
    <div>
      <SectionTitle title="Advanced Metrics" sub={subtitle} />

      {/* Data coverage disclaimer — not all years/formats have full data */}
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
          Data not available for all years and formats.
        </span>
        <button
          type="button"
          onClick={() => setCoverageOpen(true)}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Click for details
        </button>
      </div>

      <DataCoverageModal open={coverageOpen} onClose={() => setCoverageOpen(false)} />

      {/* Mode tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {AM_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => dispatch({ type: "SET_MODE", mode: m.id })}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
              filters.mode === m.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Filters panel */}
      <div className="rounded-lg border border-border bg-card p-3.5 mb-3 space-y-3">
        {/* Row 1: Format + Year + min/max + compare */}
        <div className="flex flex-wrap gap-4 items-start">
          {/* Format */}
          <div className="min-w-[160px] flex-1">
            <div className={labelCls}>Format</div>
            <select
              value={fmtSelectVal}
              onChange={(e) => handleFmtSelectChange(e.target.value)}
              className={`${inputCls} w-full`}
            >
              <option value="All">All Formats</option>
              {fmtLabels
                .filter((l) => l !== "All")
                .map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              <option value="__custom__">Custom…</option>
            </select>
            {fmtSelectVal === "__custom__" && (
              <div className="mt-1 text-[0.72rem] text-primary">
                {[...selectedFmtLabels].sort().join(", ")}
              </div>
            )}
          </div>

          {/* Year range */}
          <div className="min-w-[260px] flex-2">
            <div className={labelCls}>Years</div>
            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={filters.yearFrom}
                onChange={(e) =>
                  dispatch({
                    type: "SET_YEAR_FROM",
                    year: parseInt(e.target.value),
                  })
                }
                className={inputCls}
              >
                {allYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">to</span>
              <select
                value={filters.yearTo}
                onChange={(e) =>
                  dispatch({
                    type: "SET_YEAR_TO",
                    year: parseInt(e.target.value),
                  })
                }
                className={inputCls}
              >
                {allYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button
                onClick={() => dispatch({ type: "TOGGLE_YEAR_PICKER" })}
                className={btnCls}
              >
                Custom…
              </button>
              <button
                onClick={() => dispatch({ type: "RESET_YEARS" })}
                className={btnCls}
              >
                All
              </button>
            </div>
          </div>

          {/* Min appearances */}
          <div className="min-w-[120px]">
            <div className={labelCls}>Min appearances</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={999}
                value={filters.minApp}
                onChange={(e) =>
                  dispatch({
                    type: "SET_MIN_APP",
                    val: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                className={`${inputCls} w-16 text-center`}
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>

          {/* Max appearances */}
          <div className="min-w-[120px]">
            <div className={labelCls}>Max appearances</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={999}
                value={filters.maxApp === 999 ? "" : filters.maxApp}
                placeholder="∞"
                onChange={(e) =>
                  dispatch({
                    type: "SET_MAX_APP",
                    val: e.target.value ? parseInt(e.target.value) : 999,
                  })
                }
                className={`${inputCls} w-16 text-center`}
              />
              <span className="text-xs text-muted-foreground">max</span>
            </div>
          </div>

          {/* Min Nats */}
          <div className="min-w-[120px]">
            <div className={labelCls}>Min Nats attended</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={32}
                value={filters.minNats}
                onChange={(e) =>
                  dispatch({
                    type: "SET_MIN_NATS",
                    val: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                className={`${inputCls} w-16 text-center`}
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>

          {/* Max Nats */}
          <div className="min-w-[120px]">
            <div className={labelCls}>Max Nats attended</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={32}
                value={filters.maxNats === 99 ? "" : filters.maxNats}
                placeholder="∞"
                onChange={(e) =>
                  dispatch({
                    type: "SET_MAX_NATS",
                    val: e.target.value ? parseInt(e.target.value) : 99,
                  })
                }
                className={`${inputCls} w-16 text-center`}
              />
              <span className="text-xs text-muted-foreground">max</span>
            </div>
          </div>

          {/* Compare player */}
          <div className="min-w-[200px] flex-2" ref={compareRef}>
            <div className={labelCls}>Compare player</div>
            <div className="flex gap-1.5 relative">
              <input
                type="text"
                placeholder="Player name…"
                value={state.compareQuery}
                onChange={(e) =>
                  dispatch({ type: "SET_COMPARE_QUERY", q: e.target.value })
                }
                onFocus={() => {
                  if (state.compareQuery.trim().length >= 2)
                    dispatch({ type: "SET_COMPARE_DROPDOWN", open: true });
                }}
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => dispatch({ type: "CLEAR_COMPARE" })}
                className={btnCls}
              >
                ✕
              </button>
              {state.compareDropdownOpen && compareMatches.length > 0 && (
                <div className="absolute top-full left-0 z-50 mt-1 w-full min-w-[200px] bg-card border border-border rounded-md shadow-lg max-h-44 overflow-y-auto">
                  {compareMatches.map((n) => (
                    <button
                      key={n}
                      onMouseDown={() =>
                        dispatch({ type: "SET_COMPARE_PLAYER", name: n })
                      }
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted border-b border-border last:border-0"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {filters.comparePlayer && (
              <div className="mt-1 text-[0.72rem] text-primary">
                Highlighting: {filters.comparePlayer}
              </div>
            )}
          </div>
        </div>

        {/* Custom year picker */}
        {state.yearPickerOpen && (
          <div className="border-t border-border pt-3">
            <div className="text-[0.72rem] text-muted-foreground mb-2">
              Select individual years:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allYears.map((y) => {
                const active = activeYrs.has(y);
                return (
                  <button
                    key={y}
                    onClick={() =>
                      dispatch({ type: "TOGGLE_CUSTOM_YEAR", year: y })
                    }
                    className={`px-2 py-0.5 rounded text-xs border transition ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() =>
                  dispatch({ type: "SELECT_ALL_YEARS", years: allYears })
                }
                className={btnCls}
              >
                All
              </button>
              <button
                onClick={() => dispatch({ type: "CLEAR_ALL_YEARS" })}
                className={btnCls}
              >
                None
              </button>
            </div>
          </div>
        )}

        {/* Rivalry sub-control */}
        {filters.mode === "rivalry" && (
          <div className="border-t border-border pt-3">
            <div className={labelCls}>Show players with most…</div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() =>
                  dispatch({ type: "SET_RIVALRY_MODE", mode: "wins" })
                }
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  filters.rivalryMode === "wins"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                Wins vs one opponent
              </button>
              <button
                onClick={() =>
                  dispatch({ type: "SET_RIVALRY_MODE", mode: "losses" })
                }
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                  filters.rivalryMode === "losses"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                Losses vs one opponent
              </button>
            </div>
          </div>
        )}

        {/* VSP sub-control */}
        {filters.mode === "vsp" && (
          <div className="border-t border-border pt-3">
            <div className={labelCls}>Show records against…</div>
            <div
              className="flex gap-2 items-center flex-wrap"
              ref={vspRef}
            >
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <input
                  type="text"
                  placeholder="Search player…"
                  value={state.vspQuery}
                  onChange={(e) =>
                    dispatch({ type: "SET_VSP_QUERY", q: e.target.value })
                  }
                  onFocus={() => {
                    if (state.vspQuery.trim().length >= 2)
                      dispatch({ type: "SET_VSP_DROPDOWN", open: true });
                  }}
                  className={`${inputCls} w-full`}
                />
                {state.vspDropdownOpen && vspMatches.length > 0 && (
                  <div className="absolute top-full left-0 z-50 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-44 overflow-y-auto">
                    {vspMatches.map((n) => (
                      <button
                        key={n}
                        onMouseDown={() =>
                          dispatch({ type: "SET_VSP_TARGET", name: n })
                        }
                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted border-b border-border last:border-0"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => dispatch({ type: "CLEAR_VSP" })}
                className={btnCls}
              >
                ✕ Clear
              </button>
            </div>
            {filters.vspTarget && (
              <div className="mt-1.5 text-[0.72rem] text-primary">
                Showing records vs {filters.vspTarget}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table / empty state */}
      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={
            filters.mode === "vsp" && !filters.vspTarget
              ? "Search for a player above to see records against them."
              : "No results — try adjusting the filters or lowering the minimum appearances."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {columns.map((col) => {
                    const isActive = col.id === activeSortCol;
                    const arrow = isActive
                      ? activeSortAsc
                        ? " ▲"
                        : " ▼"
                      : "";
                    return (
                      <th
                        key={col.id}
                        onClick={() => handleColClick(col)}
                        className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap select-none transition ${
                          col.nosort
                            ? "text-muted-foreground w-9"
                            : isActive
                            ? "text-primary cursor-pointer"
                            : "text-muted-foreground cursor-pointer hover:text-foreground"
                        }`}
                      >
                        {col.label}
                        {arrow}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isCompare =
                    filters.comparePlayer &&
                    row.name === filters.comparePlayer;
                  return (
                    <tr
                      key={row.name ?? i}
                      className={`border-b border-border last:border-0 ${
                        isCompare
                          ? "bg-primary/10 border-l-2 border-l-primary"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          className="px-3 py-2 text-foreground"
                        >
                          {(col.id === "name" || col.id === "opponent") && row[col.id]
                            ? (
                              <button
                                onClick={() =>
                                  setView("player", {
                                    playerName: row[col.id],
                                    backTo: "stats",
                                  })
                                }
                                className="hover:text-primary hover:underline text-left transition-colors"
                              >
                                {row[col.id]}
                              </button>
                            )
                            : col.nosort
                            ? col.id === "_rank"
                              ? i + 1
                              : row[col.id]
                            : formatCell(col, row[col.id], filters.mode)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Result count */}
          <div className="mt-2 text-xs text-muted-foreground pl-0.5">
            {(() => {
              const yrs = [...activeYrs].sort((a, b) => a - b);
              const yrSpan =
                yrs.length > 6
                  ? `${yrs[0]}–${yrs[yrs.length - 1]}`
                  : yrs.join(", ");
              const fmtTag =
                selectedFmtLabels.has("All") || selectedFmtLabels.size === 0
                  ? "all formats"
                  : selectedFmtLabels.size === 1
                  ? [...selectedFmtLabels][0]
                  : `custom (${selectedFmtLabels.size} formats)`;
              return `${rows.length} player${rows.length !== 1 ? "s" : ""} · ${fmtTag} · ${yrSpan}`;
            })()}
          </div>
        </>
      )}

      {/* Format multi-select modal */}
      {state.fmtModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget)
              dispatch({ type: "CLOSE_FMT_MODAL" });
          }}
        >
          <div className="bg-card border border-border rounded-xl shadow-xl p-5 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Select Formats
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {fmtLabels
                .filter((l) => l !== "All")
                .map((label) => (
                  <label
                    key={label}
                    className="flex items-center gap-2.5 cursor-pointer px-2.5 py-1.5 rounded-md border border-border bg-muted hover:bg-accent transition"
                  >
                    <input
                      type="checkbox"
                      checked={state.fmtModalScratch.has(label)}
                      onChange={() =>
                        dispatch({ type: "FMT_MODAL_TOGGLE", label })
                      }
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                ))}
            </div>
            <div className="flex gap-2 justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    dispatch({
                      type: "FMT_MODAL_SELECT_ALL",
                      allLabels: fmtLabels.filter((l) => l !== "All"),
                    })
                  }
                  className={btnCls}
                >
                  All
                </button>
                <button
                  onClick={() => dispatch({ type: "FMT_MODAL_CLEAR" })}
                  className={btnCls}
                >
                  None
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => dispatch({ type: "CLOSE_FMT_MODAL" })}
                  className={btnCls}
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    dispatch({
                      type: "FMT_MODAL_APPLY",
                      allLabels: fmtLabels.filter((l) => l !== "All"),
                      map: fmtMap,
                    })
                  }
                  className="px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground text-xs font-medium cursor-pointer hover:opacity-90 transition"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
