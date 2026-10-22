/** Redemption Nationals History — shared types. */

// ── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  playerName: string;
  firstPlaces: number;
  podiums: number;  // top-3 finishes
  appearances: number;
}

/** A single trivia leaderboard row (from nationals_trivia_scores table). */
export interface TriviaScoreEntry {
  name: string;
  score: number;
  created_at: string;
}

// ── Tournament ──────────────────────────────────────────────────────────────

export interface FantasyPickBreakdown {
  format: string;
  pts: number;
}

export interface FantasyPlayer {
  name: string;
  pts: number;
  breakdown: FantasyPickBreakdown[];
  draftPick: number;
}

export interface FantasyTeam {
  gm: string;
  pts: number;
  players: FantasyPlayer[];
}

export interface FantasyDraft {
  year: number;
  teams: FantasyTeam[];
}

export interface Tournament {
  id: string;
  year: number;
  location: string;
  dates: string;
  venue: string;
  attendance: number | null;
  formats: string[];
  notes: string;
  fantasyDraft?: FantasyDraft;
  topCut?: number | null;
  topCutFormats?: string[];
  /**
   * Tracker tournament id per format (`/tournaments/results/<id>`), for years
   * whose standings and decklists were published through the app.
   */
  resultsIds?: Record<string, string>;
}

// ── Player ──────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  handle: string;
  region: string;
  notes: string;
}

// ── Result (standings entry for a format+year) ──────────────────────────────

export interface ResultEntry {
  id: string;
  playerName: string;
  placement: number;
  deck: string;
  record: string;
  notes: string;
  /** Published decklist in the app (`/decklist/<deckId>`), when the event's decklists were published through the tracker. */
  deckId?: string;
}

/** Key: "<year>_<format>", value: array of result rows */
export type ResultsMap = Record<string, ResultEntry[]>;

// ── Match ────────────────────────────────────────────────────────────────────

export interface MatchEntry {
  id: string;
  round: string;
  table: number | null;
  playerA: string;
  playerB: string;
  scoreA: number | null;
  scoreB: number | null;
  winner: string;
  notes: string;
  topCut?: boolean;
}

/** Key: "<year>_<format>", value: array of matches */
export type MatchesMap = Record<string, MatchEntry[]>;

// ── Multiplayer W/L/D map ────────────────────────────────────────────────────

/** Per-format multiplayer win/loss/draw record for a single player. */
export type MultiWLMap = Record<string, Record<string, { W: number; L: number; D: number }>>;

// ── Root data shape ──────────────────────────────────────────────────────────

export interface NationalsData {
  tournaments: Tournament[];
  players: Player[];
  results: ResultsMap;
  matches: MatchesMap;
  multiWL: MultiWLMap;
}

/** Alias used by HistoryClient for the full JSON payload. */
export type SeedData = NationalsData;
