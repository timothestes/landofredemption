/**
 * Redemption Nationals History — pure derived selectors.
 * No React, no DOM. All inputs come from NationalsData (the seed JSON).
 */

import type { NationalsData, MatchEntry } from "./types";

// ── Champion ──────────────────────────────────────────────────────────────────

export interface Champion {
  /** Player name */
  name: string;
  /** Total championship wins (= years.length) */
  wins: number;
  /** Years in which they won at least one format */
  years: number[];
  /** Distinct set of formats in which they won at least once (NOT parallel to `years`) */
  formats: string[];
  /** Win years broken out per format, for format-scoped views */
  byFormat: Record<string, number[]>;
}

/**
 * Returns all unique format strings present in the results map,
 * sorted alphabetically (the "All" sentinel is NOT included here —
 * the UI layer adds it if needed).
 *
 * Ports SRC:928-933.
 */
export function getAllFormats(seed: NationalsData): string[] {
  const fmts = new Set<string>();
  for (const key of Object.keys(seed.results)) {
    const i = key.indexOf("_");
    fmts.add(key.slice(i + 1));
  }
  return Array.from(fmts).sort();
}

/**
 * Builds a list of champions (players with at least one 1st-place finish),
 * each with aggregated win count, years, and formats.
 *
 * Ports SRC:934-947.
 */
export function buildChampionData(seed: NationalsData): Champion[] {
  /** Intermediate: playerName → formatName → years[] */
  const byPlayer: Record<string, Record<string, number[]>> = {};

  for (const [key, results] of Object.entries(seed.results)) {
    const i = key.indexOf("_");
    const year = parseInt(key.slice(0, i), 10);
    const fmt = key.slice(i + 1);

    const winners = results.filter((r) => r.placement === 1);
    if (!winners.length) continue;

    for (const winner of winners) {
      const name = winner.playerName;
      if (!byPlayer[name]) byPlayer[name] = {};
      if (!byPlayer[name][fmt]) byPlayer[name][fmt] = [];
      byPlayer[name][fmt].push(year);
    }
  }

  return Object.entries(byPlayer).map(([name, fmtMap]) => {
    const years: number[] = [];

    for (const fmtYears of Object.values(fmtMap)) {
      for (const y of fmtYears) {
        years.push(y);
      }
    }

    years.sort((a, b) => a - b);

    // formats is a de-duped list of distinct formats won (not index-parallel to years)
    const formats = Array.from(new Set(Object.keys(fmtMap)));

    const byFormat: Record<string, number[]> = {};
    for (const [fmt, fmtYears] of Object.entries(fmtMap)) {
      byFormat[fmt] = [...fmtYears].sort((a, b) => a - b);
    }

    return { name, wins: years.length, years, formats, byFormat };
  });
}

// ── PlayerProfile ─────────────────────────────────────────────────────────────

/** Per-format or per-opponent win/loss/draw record. */
export interface WLDRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** A single career history entry (a placement in one format+year). */
export interface CareerHistoryEntry {
  year: number;
  format: string;
  id: string;
  playerName: string;
  placement: number;
  deck: string;
  record: string;
  notes: string;
  /** Published decklist id, when the event's decklists live in the app. */
  deckId?: string;
  /** Distinct players who played Round 1 that year+format, or null if no match data exists for that key. */
  fieldSize: number | null;
  /** (fieldSize - placement) / (fieldSize - 1) * 100, clamped 0-100; null if fieldSize is unknown or 1. */
  fieldPct: number | null;
  /** This player's W-L-D record in that year+format, derived from match data; null if no match data exists for that key. */
  matchRecord: string | null;
}

/**
 * Counts distinct participants in a format's Round 1, from match data.
 * Round 1 is used (rather than the results/standings list) because some
 * entrants drop before final standings are recorded, undercounting the
 * true field size; Round 1 attendance isn't affected by drops.
 * Returns null when no match data exists for the key (older years, or
 * multiplayer formats that aren't tracked in the matches map).
 */
function countRoundOneField(matches: MatchEntry[] | undefined): number | null {
  if (!matches) return null;
  const names = new Set<string>();
  for (const m of matches) {
    if (m.round !== "Round 1") continue;
    for (const n of [m.playerA, m.playerB]) {
      if (n && n.toLowerCase() !== "bye") names.add(n);
    }
  }
  return names.size > 0 ? names.size : null;
}

/**
 * Derives every player's W-L-D record for a single year+format from that
 * key's match data, keyed by player name. Mirrors the per-key record math in
 * playerProfile (Teams rounds collapse to one W/L/D by majority of their
 * per-pairing games), generalized to every player instead of one.
 */
export function recordsForKey(matches: MatchEntry[] | undefined, format: string): Record<string, string> {
  const totals: Record<string, WLDRecord> = {};
  if (!matches) return {};
  const isTeams = format === "Teams";
  const roundTally: Record<string, Record<string, WLDRecord>> = {};

  for (const m of matches) {
    for (const name of [m.playerA, m.playerB]) {
      if (!name) continue;
      const won = m.winner === name;
      const lost = !!m.winner && m.winner !== name;
      const draw = !m.winner;
      const target = isTeams
        ? (roundTally[name] ??= {})[m.round] ??= { wins: 0, losses: 0, draws: 0 }
        : (totals[name] ??= { wins: 0, losses: 0, draws: 0 });
      if (won) target.wins++;
      else if (lost) target.losses++;
      else if (draw) target.draws++;
    }
  }

  if (isTeams) {
    for (const [name, rounds] of Object.entries(roundTally)) {
      const rec = (totals[name] ??= { wins: 0, losses: 0, draws: 0 });
      for (const t of Object.values(rounds)) {
        if (t.wins > t.losses) rec.wins++;
        else if (t.losses > t.wins) rec.losses++;
        else rec.draws++;
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [name, rec] of Object.entries(totals)) {
    out[name] = `${rec.wins}–${rec.losses}–${rec.draws}`;
  }
  return out;
}

/** A match entry enriched with year and format (derived from the matches map key). */
export interface MatchRow extends MatchEntry {
  year: number;
  format: string;
}

/** Fantasy draft entry for a player in a given year. */
export interface FantasyDraftEntry {
  year: number;
  /** Name of the GM who drafted this player */
  gmName: string;
  /** Draft pick number (1-based) */
  draftPick: number;
  /** Points this player earned for their fantasy team */
  pts: number;
  /** Per-format breakdown of those points */
  breakdown: { format: string; pts: number }[];
}

/**
 * Structured data for a player's full career profile.
 *
 * Task 10 renders this — see field docs for display guidance.
 *
 * Ports the DATA math in `openPlayerProfile` SRC:1011-1189.
 *
 * Shape:
 * ```
 * {
 *   name: string,
 *   handle: string,
 *   region: string,
 *   initials: string,           // 2-char for avatar
 *   appearances: number,        // total result rows found
 *   bestPlacement: number|null, // lowest placement number seen
 *   championships: number,      // count of placement===1
 *   placements: CareerHistoryEntry[],  // sorted newest-first
 *
 *   // 2-player & Teams match data (from matches map)
 *   matchStatsByFmt: Record<format, WLDRecord>,
 *   matchStatsByOpp: Record<opponentName, WLDRecord>,
 *   allMatches: MatchRow[],     // every match involving this player
 *   tp2Wins: number,
 *   tp2Losses: number,
 *   tp2Draws: number,
 *   tp2WinPct: string,          // e.g. "62.5%" or "—"
 *   topCutWins: number,
 *   topCutLosses: number,
 *   topCutWinPct: string,
 *
 *   // Multiplayer data (from multiWL map)
 *   multiWLByFmt: Record<format, {W:number,L:number,D:number}>,
 *   multiWins: number,
 *   multiLosses: number,
 *   multiDraws: number,
 *   multiWinPct: string,
 *   hasMulti: boolean,
 *
 *   fantasyDraftHistory: FantasyDraftEntry[],
 * }
 * ```
 */
export interface PlayerProfile {
  // Identity
  name: string;
  handle: string;
  region: string;
  initials: string;

  // Career overview
  appearances: number;
  bestPlacement: number | null;
  championships: number;
  /** Career result history, sorted newest-first */
  placements: CareerHistoryEntry[];

  // 2P & Teams match record (from matches map)
  matchStatsByFmt: Record<string, WLDRecord>;
  matchStatsByOpp: Record<string, WLDRecord>;
  allMatches: MatchRow[];
  tp2Wins: number;
  tp2Losses: number;
  tp2Draws: number;
  /** Win % string over decisive games, e.g. "62.5%" or "—" */
  tp2WinPct: string;
  /** Average placement-vs-field-size percentage (100 = won, 0 = last), or null if no placements have known field size */
  avgFieldPct: number | null;

  // Top-cut record
  topCutWins: number;
  topCutLosses: number;
  topCutWinPct: string;

  // Multiplayer record (from multiWL map)
  multiWLByFmt: Record<string, { W: number; L: number; D: number }>;
  multiWins: number;
  multiLosses: number;
  multiDraws: number;
  multiWinPct: string;
  hasMulti: boolean;

  // Fantasy draft history
  fantasyDraftHistory: FantasyDraftEntry[];
}

/**
 * Derives a full player profile from the seed data.
 *
 * Returns structured data only — no JSX, no HTML.
 * Ports `openPlayerProfile` SRC:1011-1189.
 */
export function playerProfile(seed: NationalsData, name: string): PlayerProfile {
  const player = seed.players?.find((p) => p.name === name) ?? { name, handle: "", region: "", id: "", notes: "" };
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // ── Career history (from results map) ──────────────────────────────────────
  const placements: CareerHistoryEntry[] = [];
  for (const [key, results] of Object.entries(seed.results)) {
    const i = key.indexOf("_");
    const year = parseInt(key.slice(0, i), 10);
    const fmt = key.slice(i + 1);
    const r = results.find((x) => x.playerName === name);
    if (r) {
      const fieldSize = countRoundOneField(seed.matches[key]);
      const fieldPct =
        fieldSize != null && fieldSize > 1 && r.placement
          ? Math.max(0, Math.min(100, ((fieldSize - r.placement) / (fieldSize - 1)) * 100))
          : null;
      placements.push({ year, format: fmt, ...r, fieldSize, fieldPct, matchRecord: null });
    }
  }
  placements.sort((a, b) => b.year - a.year);

  // ── Match stats (from matches map) ─────────────────────────────────────────
  const matchStatsByFmt: Record<string, WLDRecord> = {};
  const matchStatsByOpp: Record<string, WLDRecord> = {};
  const allMatches: MatchRow[] = [];
  // Per year+format record (mirrors matchStatsByFmt, but scoped to one key
  // instead of aggregated across years) — feeds CareerHistoryEntry.matchRecord.
  const recordByKey: Record<string, WLDRecord> = {};

  for (const [key, matches] of Object.entries(seed.matches)) {
    const i = key.indexOf("_");
    const year = parseInt(key.slice(0, i), 10);
    const fmt = key.slice(i + 1);
    const isTeams = fmt === "Teams";
    const keyRecord: WLDRecord = { wins: 0, losses: 0, draws: 0 };

    // Teams is team-vs-team: each player plays every opposing player, so a player
    // has multiple cross-pairing records per round. Head-to-head keeps full per-game
    // credit, but the format record should count one result per team round. Tally
    // this player's games per round, then collapse by majority (tie -> draw).
    // Round labels are unique within a year+format key, so a plain map is safe.
    const roundTally: Record<string, WLDRecord> = {};

    for (const m of matches) {
      if (m.playerA !== name && m.playerB !== name) continue;

      const opp = m.playerA === name ? m.playerB : m.playerA;
      const won = m.winner === name;
      const lost = !!m.winner && m.winner !== name;
      const draw = !m.winner;

      // Head-to-head: always full per-game credit, every format.
      if (!matchStatsByOpp[opp]) matchStatsByOpp[opp] = { wins: 0, losses: 0, draws: 0 };
      if (won) matchStatsByOpp[opp].wins++;
      else if (lost) matchStatsByOpp[opp].losses++;
      else if (draw) matchStatsByOpp[opp].draws++;

      // Keep every individual game in allMatches (only consumed for top-cut and a
      // non-empty flag; no Teams record has topCut, so this is pure data fidelity).
      allMatches.push({ year, format: fmt, ...m });

      if (isTeams) {
        // Defer format credit until the whole round is aggregated.
        if (!roundTally[m.round]) roundTally[m.round] = { wins: 0, losses: 0, draws: 0 };
        if (won) roundTally[m.round].wins++;
        else if (lost) roundTally[m.round].losses++;
        else if (draw) roundTally[m.round].draws++;
        continue;
      }

      // Non-Teams: one record == one game == one format credit.
      if (!matchStatsByFmt[fmt]) matchStatsByFmt[fmt] = { wins: 0, losses: 0, draws: 0 };
      if (won) { matchStatsByFmt[fmt].wins++; keyRecord.wins++; }
      else if (lost) { matchStatsByFmt[fmt].losses++; keyRecord.losses++; }
      else if (draw) { matchStatsByFmt[fmt].draws++; keyRecord.draws++; }
    }

    // Teams: collapse each round into a single W/L/D by majority of its games.
    if (isTeams) {
      for (const t of Object.values(roundTally)) {
        if (!matchStatsByFmt[fmt]) matchStatsByFmt[fmt] = { wins: 0, losses: 0, draws: 0 };
        if (t.wins > t.losses) { matchStatsByFmt[fmt].wins++; keyRecord.wins++; }
        else if (t.losses > t.wins) { matchStatsByFmt[fmt].losses++; keyRecord.losses++; }
        else { matchStatsByFmt[fmt].draws++; keyRecord.draws++; }
      }
    }

    if (keyRecord.wins + keyRecord.losses + keyRecord.draws > 0) {
      recordByKey[key] = keyRecord;
    }
  }

  // Attach each placement's year+format match record, now that recordByKey is built.
  for (const p of placements) {
    const rec = recordByKey[`${p.year}_${p.format}`];
    p.matchRecord = rec ? `${rec.wins}–${rec.losses}–${rec.draws}` : null;
  }

  // ── Multiplayer W/L/D (from multiWL map) ───────────────────────────────────
  const multiWLByFmt: Record<string, { W: number; L: number; D: number }> =
    seed.multiWL?.[name] ?? {};

  const mwlTotals = Object.values(multiWLByFmt).reduce(
    (acc, v) => { acc.W += v.W || 0; acc.L += v.L || 0; acc.D += v.D || 0; return acc; },
    { W: 0, L: 0, D: 0 }
  );
  const multiWins = mwlTotals.W;
  const multiLosses = mwlTotals.L;
  const multiDraws = mwlTotals.D;
  const multiDecisive = multiWins + multiLosses;
  const multiWinPct =
    multiDecisive > 0 ? ((multiWins / multiDecisive) * 100).toFixed(1) + "%" : "—";
  const hasMulti = Object.keys(multiWLByFmt).length > 0;

  // ── 2P/Teams aggregate totals ───────────────────────────────────────────────
  const tp2Wins = Object.values(matchStatsByFmt).reduce((s, v) => s + v.wins, 0);
  const tp2Losses = Object.values(matchStatsByFmt).reduce((s, v) => s + v.losses, 0);
  const tp2Draws = Object.values(matchStatsByFmt).reduce((s, v) => s + v.draws, 0);
  const tp2Decisive = tp2Wins + tp2Losses;
  const tp2WinPct =
    tp2Decisive > 0 ? ((tp2Wins / tp2Decisive) * 100).toFixed(1) + "%" : "—";

  // Field % — average of each placement's fieldPct (see the placements loop above).
  const fieldPcts = placements
    .map((p) => p.fieldPct)
    .filter((v): v is number => v != null);
  const avgFieldPct =
    fieldPcts.length > 0
      ? fieldPcts.reduce((a, b) => a + b, 0) / fieldPcts.length
      : null;

  // ── Top-cut record ──────────────────────────────────────────────────────────
  let topCutWins = 0;
  let topCutLosses = 0;
  for (const m of allMatches) {
    if (!m.topCut) continue;
    if (m.winner === name) topCutWins++;
    else if (m.winner && m.winner !== name) topCutLosses++;
  }
  const tcTotal = topCutWins + topCutLosses;
  const topCutWinPct =
    tcTotal > 0 ? ((topCutWins / tcTotal) * 100).toFixed(1) + "%" : "—";

  // ── Career overview stats ───────────────────────────────────────────────────
  const bests = placements.filter((h) => h.placement).map((h) => h.placement);
  const bestPlacement = bests.length ? Math.min(...bests) : null;
  const championships = placements.filter((h) => h.placement === 1).length;

  // ── Fantasy draft history ───────────────────────────────────────────────────
  const fantasyDraftHistory: FantasyDraftEntry[] = [];
  for (const t of seed.tournaments) {
    if (!t.fantasyDraft) continue;
    for (const team of t.fantasyDraft.teams) {
      for (const fp of team.players) {
        if (fp.name === name) {
          fantasyDraftHistory.push({
            year: t.fantasyDraft.year,
            gmName: team.gm,
            draftPick: fp.draftPick,
            pts: fp.pts,
            breakdown: fp.breakdown,
          });
        }
      }
    }
  }
  fantasyDraftHistory.sort((a, b) => b.year - a.year);

  return {
    name,
    handle: player.handle ?? "",
    region: player.region ?? "",
    initials,
    appearances: placements.length,
    bestPlacement,
    championships,
    placements,
    matchStatsByFmt,
    matchStatsByOpp,
    allMatches,
    tp2Wins,
    tp2Losses,
    tp2Draws,
    tp2WinPct,
    avgFieldPct,
    topCutWins,
    topCutLosses,
    topCutWinPct,
    multiWLByFmt,
    multiWins,
    multiLosses,
    multiDraws,
    multiWinPct,
    hasMulti,
    fantasyDraftHistory,
  };
}

// ── Head-to-Head ──────────────────────────────────────────────────────────────

/**
 * Computes head-to-head record between two players across all matches.
 *
 * Returns wins/losses/draws from player `a`'s perspective.
 * Ports `renderH2H` SRC:1190-1216 (data portion only).
 */
export function headToHead(
  seed: NationalsData,
  a: string,
  b: string
): { wins: number; losses: number; draws: number; matches: MatchRow[] } {
  const matches: MatchRow[] = [];

  for (const [key, keyMatches] of Object.entries(seed.matches)) {
    const i = key.indexOf("_");
    const year = parseInt(key.slice(0, i), 10);
    const fmt = key.slice(i + 1);

    for (const m of keyMatches) {
      const involves =
        (m.playerA === a || m.playerB === a) &&
        (m.playerA === b || m.playerB === b);
      if (!involves) continue;
      matches.push({ year, format: fmt, ...m });
    }
  }

  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (const m of matches) {
    if (m.winner === a) wins++;
    else if (m.winner === b) losses++;
    else draws++;
  }

  return { wins, losses, draws, matches };
}
