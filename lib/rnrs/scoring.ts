import {
  FORMATS,
  LEVELS,
  LEVEL_CAPS,
  LEVEL_PTS,
  SEASONS,
  STATE_TO_REGION,
} from "./config";
import type {
  FormatKey,
  Level,
  NormalizedData,
  PlayerFormatResult,
  SeasonKey,
} from "./types";

const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

/** Strip the "(ST)" state tag for display, e.g. "Tim Estes (CA)" → "Tim Estes". */
export function displayName(name: string): string {
  return name.replace(/\s*\([^)]*\)/, "").trim();
}

/** Lower-cased, tag-stripped key used for matching / searching. */
export function normName(name: string): string {
  return displayName(name).toLowerCase();
}

export function getState(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : "";
}

export function getRegion(name: string): string {
  return STATE_TO_REGION[getState(name)] ?? "";
}

// ---------------------------------------------------------------------------
// Placement labels (value → "1st" / "2nd" / "3rd"), including ties
// ---------------------------------------------------------------------------

interface PlaceEntry {
  val: number;
  label: string;
}

/** Build the set of point-values that map to a placement, including 2- and
 *  3-way ties (which split the combined points). Mirrors the prototype. */
function buildPlaceMap(pts: number[]): PlaceEntry[] {
  const map: PlaceEntry[] = [];
  const [p1, p2, p3] = pts;
  if (p1 !== undefined) {
    map.push({ val: p1, label: "1st" });
    if (p2 !== undefined) {
      map.push({ val: (p1 + p2) / 2, label: "1st" });
      if (p3 !== undefined) map.push({ val: (p1 + p2 + p3) / 3, label: "1st" });
    }
  }
  if (p2 !== undefined) {
    map.push({ val: p2, label: "2nd" });
    if (p3 !== undefined) {
      map.push({ val: (p2 + p3) / 2, label: "2nd" });
      map.push({ val: (p2 + p3 + p3) / 3, label: "2nd" });
    }
  }
  if (p3 !== undefined) {
    map.push({ val: p3, label: "3rd" });
    map.push({ val: p3 / 2, label: "3rd" });
    map.push({ val: p3 / 3, label: "3rd" });
  }
  return map;
}

const PLACE_MAPS: Record<Level, PlaceEntry[]> = LEVELS.reduce(
  (acc, level) => {
    acc[level] = buildPlaceMap(LEVEL_PTS[level]);
    return acc;
  },
  {} as Record<Level, PlaceEntry[]>,
);

export function placeLabel(pts: number, level: Level): string | null {
  const TOLERANCE = 0.05;
  // An exact placing value wins over a tie average that happens to equal it
  // (Seasonal 5/3/1: a 3-way 1st tie averages 3, the same as a 2nd place).
  const exact = LEVEL_PTS[level].findIndex((p) => Math.abs(p - pts) < TOLERANCE);
  if (exact >= 0) return ["1st", "2nd", "3rd"][exact] ?? null;
  const match = PLACE_MAPS[level].find((e) => Math.abs(e.val - pts) < TOLERANCE);
  return match ? match.label : null;
}

// ---------------------------------------------------------------------------
// Cap counting — the core correctness logic
// ---------------------------------------------------------------------------

export interface CountedLevel {
  raw: number;
  counted: number;
  capped: boolean;
  /** Win values sorted high→low; the first `cap` are what count. */
  valsDesc: number[];
  cap: number;
}

/**
 * Count one level's points within a SINGLE format: keep only the best `cap`
 * wins (caps are per-format). This is the rule the Google Sheet's Total uses,
 * so deriving totals from these values keeps every column summing to the Total.
 */
export function countLevel(vals: number[], level: Level): CountedLevel {
  const cap = LEVEL_CAPS[level];
  const valsDesc = [...vals].sort((a, b) => b - a);
  const counted = sum(valsDesc.slice(0, cap));
  const raw = sum(valsDesc);
  return { raw, counted, capped: raw !== counted, valsDesc, cap };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface FormatBreakdown {
  formatKey: FormatKey;
  season: SeasonKey;
  valsDesc: number[];
  cap: number;
  raw: number;
  counted: number;
  capped: boolean;
}

export interface LevelContribution {
  level: Level;
  raw: number;
  counted: number;
  capped: boolean;
  /** Per-(season,format) contributions making up this level, for the
   *  expandable breakdown. Empty if the player has no results at this level. */
  perFormat: FormatBreakdown[];
}

export interface LeaderboardRow {
  name: string;
  displayName: string;
  state: string;
  region: string;
  /** Sum of counted points — the authoritative Total (rows sum to this). */
  total: number;
  /** Sum of raw (uncapped) points — always ≥ total. */
  rawTotal: number;
  /** Sum of the sheets' own Total columns (checksum; equals `total`). */
  sheetTotal: number;
  levels: Record<Level, LevelContribution>;
  hasAnyCap: boolean;
}

function emptyPerLevel(): Record<Level, FormatBreakdown[]> {
  return {
    local: [],
    district: [],
    seasonal: [],
    state: [],
    regional: [],
    national: [],
  };
}

/**
 * Build leaderboard rows for the given scope. Caps are applied per (season,
 * format) and then summed, so `total` is correct for single-format and
 * aggregate ("All Formats" / "All Seasons") views alike.
 */
export function buildLeaderboard(
  data: NormalizedData,
  season: SeasonKey | "all",
  format: FormatKey | "all",
): LeaderboardRow[] {
  const seasons: SeasonKey[] = season === "all" ? SEASONS : [season];
  const formats: FormatKey[] =
    format === "all" ? FORMATS.map((f) => f.key) : [format];

  const acc = new Map<
    string,
    { name: string; sheetTotal: number; perLevel: Record<Level, FormatBreakdown[]> }
  >();

  for (const s of seasons) {
    for (const f of formats) {
      const rows = data[s]?.[f] ?? [];
      for (const p of rows) {
        let entry = acc.get(p.name);
        if (!entry) {
          entry = { name: p.name, sheetTotal: 0, perLevel: emptyPerLevel() };
          acc.set(p.name, entry);
        }
        entry.sheetTotal += p.sheetTotal;
        for (const level of LEVELS) {
          const vals = p.wins[level];
          if (!vals || vals.length === 0) continue;
          const c = countLevel(vals, level);
          entry.perLevel[level].push({
            formatKey: f,
            season: s,
            valsDesc: c.valsDesc,
            cap: c.cap,
            raw: c.raw,
            counted: c.counted,
            capped: c.capped,
          });
        }
      }
    }
  }

  const out: LeaderboardRow[] = [];
  for (const entry of acc.values()) {
    const levels = {} as Record<Level, LevelContribution>;
    let total = 0;
    let rawTotal = 0;
    let hasAnyCap = false;
    for (const level of LEVELS) {
      const pf = entry.perLevel[level];
      const counted = sum(pf.map((x) => x.counted));
      const raw = sum(pf.map((x) => x.raw));
      const capped = raw !== counted;
      if (capped) hasAnyCap = true;
      total += counted;
      rawTotal += raw;
      levels[level] = { level, raw, counted, capped, perFormat: pf };
    }
    out.push({
      name: entry.name,
      displayName: displayName(entry.name),
      state: getState(entry.name),
      region: getRegion(entry.name),
      total,
      rawTotal,
      sheetTotal: entry.sheetTotal,
      levels,
      hasAnyCap,
    });
  }

  out.sort((a, b) => b.total - a.total);
  return out;
}

// ---------------------------------------------------------------------------
// Player lookup profile
// ---------------------------------------------------------------------------

export interface ProfilePlacing {
  level: Level;
  place: string;
  count: number;
}

export interface ProfileFormat {
  formatKey: FormatKey;
  label: string;
  total: number;
  placings: ProfilePlacing[];
}

export interface ProfileSeason {
  season: SeasonKey;
  total: number;
  formats: ProfileFormat[];
}

export interface PlayerProfile {
  name: string;
  displayName: string;
  state: string;
  region: string;
  totalPts: number;
  seasonCount: number;
  formatCount: number;
  seasons: ProfileSeason[];
}

/** Unique, alphabetically-sorted player names across all loaded data. */
export function allPlayerNames(data: NormalizedData): string[] {
  const set = new Set<string>();
  for (const s of SEASONS) {
    const seasonData = data[s];
    if (!seasonData) continue;
    for (const f of FORMATS) {
      for (const p of seasonData[f.key] ?? []) set.add(p.name);
    }
  }
  return [...set].sort((a, b) => normName(a).localeCompare(normName(b)));
}

function findPlayerRow(
  data: NormalizedData,
  season: SeasonKey,
  format: FormatKey,
  norm: string,
): PlayerFormatResult | undefined {
  return (data[season]?.[format] ?? []).find((r) => normName(r.name) === norm);
}

/** Build a season-by-season profile for one player (counted totals). */
export function buildPlayerProfile(
  data: NormalizedData,
  name: string,
): PlayerProfile | null {
  const norm = normName(name);
  const seasons: ProfileSeason[] = [];
  const formatsSeen = new Set<FormatKey>();
  let canonical = name;
  let totalPts = 0;

  for (const season of SEASONS) {
    const formatBlocks: ProfileFormat[] = [];
    let seasonTotal = 0;
    for (const f of FORMATS) {
      const row = findPlayerRow(data, season, f.key, norm);
      if (!row) continue;
      canonical = row.name;
      let fmtTotal = 0;
      const placings: ProfilePlacing[] = [];
      for (const level of LEVELS) {
        const vals = row.wins[level];
        if (!vals || vals.length === 0) continue;
        fmtTotal += countLevel(vals, level).counted;
        const counts: Record<string, number> = {};
        for (const v of vals) {
          const place = placeLabel(v, level);
          if (place) counts[place] = (counts[place] ?? 0) + 1;
        }
        for (const [place, count] of Object.entries(counts)) {
          placings.push({ level, place, count });
        }
      }
      if (fmtTotal > 0 || placings.length > 0) {
        formatBlocks.push({
          formatKey: f.key,
          label: f.label,
          total: fmtTotal,
          placings,
        });
        formatsSeen.add(f.key);
        seasonTotal += fmtTotal;
      }
    }
    if (formatBlocks.length > 0) {
      seasons.push({ season, total: seasonTotal, formats: formatBlocks });
      totalPts += seasonTotal;
    }
  }

  if (seasons.length === 0) return null;

  return {
    name: canonical,
    displayName: displayName(canonical),
    state: getState(canonical),
    region: getRegion(canonical),
    totalPts,
    seasonCount: seasons.length,
    formatCount: formatsSeen.size,
    seasons,
  };
}
