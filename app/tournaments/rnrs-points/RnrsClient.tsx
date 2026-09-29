"use client";

import { useMemo, useState } from "react";
import {
  FORMATS,
  LEVELS,
  LEVEL_LABELS,
  REGION_NAMES,
  SEASONS,
} from "@/lib/rnrs/config";
import {
  allPlayerNames,
  buildLeaderboard,
  normName,
  placeLabel,
} from "@/lib/rnrs/scoring";
import type { LeaderboardRow } from "@/lib/rnrs/scoring";
import type { FormatKey, Level, NormalizedData, SeasonKey } from "@/lib/rnrs/types";
import RnrsLeaderboard, { type SortKey } from "./RnrsLeaderboard";
import RnrsPlayerLookup from "./RnrsPlayerLookup";
import PointSystemKey from "./PointSystemKey";

type View = "leaderboard" | "lookup";
type Placing = "all" | "1st" | "2nd" | "3rd";

const controlClass =
  "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-muted-foreground/50";

function rowHasPlacing(row: LeaderboardRow, level: Level, placing: Placing): boolean {
  const pf = row.levels[level].perFormat;
  if (pf.length === 0) return false;
  if (placing === "all") return true;
  return pf.some((f) => f.valsDesc.some((v) => placeLabel(v, level) === placing));
}

export default function RnrsClient({ data }: { data: NormalizedData }) {
  const [view, setView] = useState<View>("leaderboard");
  const [season, setSeason] = useState<SeasonKey | "all">("2026");
  const [format, setFormat] = useState<FormatKey | "all">("type1");
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState<Level | "all">("all");
  const [placingFilter, setPlacingFilter] = useState<Placing>("all");
  const [lookupName, setLookupName] = useState<string | null>(null);

  const allNames = useMemo(() => allPlayerNames(data), [data]);

  const rows = useMemo(
    () => buildLeaderboard(data, season, format),
    [data, season, format],
  );

  const stateOptions = useMemo(
    () => [...new Set(rows.map((r) => r.state).filter(Boolean))].sort(),
    [rows],
  );

  const sortedRows = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (search && !normName(r.name).includes(search.toLowerCase())) return false;
      if (regionFilter !== "all" && r.region !== regionFilter) return false;
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (levelFilter !== "all" && !rowHasPlacing(r, levelFilter, placingFilter))
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = normName(a.name).localeCompare(normName(b.name));
      } else if (sortKey === "home_state") {
        cmp = (a.state || "ZZ").localeCompare(b.state || "ZZ");
        if (cmp === 0) cmp = a.total - b.total;
      } else if (sortKey === "region") {
        cmp = (a.region || "ZZ").localeCompare(b.region || "ZZ");
        if (cmp === 0) cmp = a.total - b.total;
      } else if (sortKey === "total") {
        cmp = a.total - b.total;
      } else {
        cmp = a.levels[sortKey].counted - b.levels[sortKey].counted;
      }
      return cmp * dir;
    });
  }, [
    rows,
    search,
    regionFilter,
    stateFilter,
    levelFilter,
    placingFilter,
    sortKey,
    sortDir,
  ]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "name" || key === "region" || key === "home_state"
          ? "asc"
          : "desc",
      );
    }
  };

  const onPlayerClick = (name: string) => {
    setLookupName(name);
    setView("lookup");
  };

  const onExportCsv = () => {
    if (sortedRows.length === 0) return;

    const escapeCsv = (value: string | number): string => {
      const str = String(value ?? "");
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headers = [
      "Rank",
      "Player",
      "State",
      "Region",
      ...LEVELS.map((l) => LEVEL_LABELS[l]),
      "Total",
    ];

    const rows = sortedRows.map((row, i) => [
      i + 1,
      row.displayName,
      row.state,
      row.region,
      ...LEVELS.map((l) => row.levels[l].counted),
      row.total,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(","))
      .join("\r\n");

    // Prepend a BOM so Excel reads it as UTF-8
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const formatPart = format === "all" ? "all-formats" : format;
    a.download = `rnrs-points-${season}-${formatPart}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const sortButtons: { label: string; key: SortKey }[] = [
    { label: "Total pts", key: "total" },
    { label: "Name", key: "name" },
    { label: "State", key: "home_state" },
    { label: "Region", key: "region" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-cinzel text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            RNRS Points
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Redemption National Ranking System standings
          </p>
        </div>
        <select
          value={season}
          onChange={(e) => setSeason(e.target.value as SeasonKey | "all")}
          className={controlClass}
          aria-label="Season"
        >
          {SEASONS.map((s) => (
            <option key={s} value={s}>
              {s} Season
            </option>
          ))}
          <option value="all">All Seasons</option>
        </select>
      </div>

      {/* View tabs */}
      <div className="mt-4 flex gap-1 border-b border-border">
        {(
          [
            ["leaderboard", "Leaderboard"],
            ["lookup", "Player Lookup"],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              view === v
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "leaderboard" ? (
        <div className="mt-4 space-y-4">
          {/* Format tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-border">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormat(f.key)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                  format === f.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFormat("all")}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                format === "all"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              All Formats
            </button>
          </div>

          <PointSystemKey />

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Sort
              </span>
              {sortButtons.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onSort(b.key)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    sortKey === b.key
                      ? "border-border bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <select
              value={levelFilter}
              onChange={(e) => {
                const v = e.target.value as Level | "all";
                setLevelFilter(v);
                if (v === "all") setPlacingFilter("all");
              }}
              className={controlClass}
              aria-label="Filter by level"
            >
              <option value="all">All levels</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>

            {levelFilter !== "all" && (
              <select
                value={placingFilter}
                onChange={(e) => setPlacingFilter(e.target.value as Placing)}
                className={controlClass}
                aria-label="Filter by placing"
              >
                <option value="all">Any placing</option>
                <option value="1st">1st place</option>
                <option value="2nd">2nd place</option>
                <option value="3rd">3rd place</option>
              </select>
            )}

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className={controlClass}
              aria-label="Filter by region"
            >
              <option value="all">All regions</option>
              {REGION_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className={controlClass}
              aria-label="Filter by state"
            >
              <option value="all">All states</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player…"
              className={`${controlClass} min-w-[160px] flex-1`}
              aria-label="Search player"
            />

            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {sortedRows.length} player{sortedRows.length !== 1 ? "s" : ""}
            </span>

            <button
              type="button"
              onClick={onExportCsv}
              disabled={sortedRows.length === 0}
              className={`${controlClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Export CSV
            </button>
          </div>

          <RnrsLeaderboard
            rows={sortedRows}
            season={season}
            format={format}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            onPlayerClick={onPlayerClick}
          />
        </div>
      ) : (
        <div className="mt-4">
          <RnrsPlayerLookup
            data={data}
            allNames={allNames}
            initialName={lookupName}
          />
        </div>
      )}
    </div>
  );
}
