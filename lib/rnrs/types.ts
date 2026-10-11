/** Redemption National Ranking System (RNRS) — shared types. */

export type Level =
  | "local"
  | "district"
  | "seasonal"
  | "state"
  | "regional"
  | "national";
export type FormatKey =
  | "type1"
  | "type1Unlimited"
  | "teams"
  | "type2"
  | "closed"
  | "draft";
export type SeasonKey = "2023" | "2024" | "2025" | "2026" | "2027";

/** One player's results in a single (season, format) sheet. */
export interface PlayerFormatResult {
  /** Canonical name including the state tag, e.g. "Tim Estes (CA)". */
  name: string;
  /** Raw win point-values per level (before caps), e.g. district: [10,10,10]. */
  wins: Record<Level, number[]>;
  /** Total as published by the Google Sheet — used as a checksum. */
  sheetTotal: number;
}

/** All fetched data: data[season][format] = rows. Partial because a sheet may
 *  fail to load (we degrade gracefully to an empty array). */
export type NormalizedData = Partial<
  Record<SeasonKey, Partial<Record<FormatKey, PlayerFormatResult[]>>>
>;
