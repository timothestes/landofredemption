// lib/tournament/liveRound.ts
//
// Pure helpers for the public live round page (/t/[code]). Everything here
// takes the JSON returned by the `get_public_round_view` RPC (migration 109)
// and turns it into what the page renders. No I/O, no React.
//
// Standings deliberately go through `buildStandings` — the same function the
// host's live Standings tab uses — so a player's phone and the host's laptop
// can never disagree about a placing.

import { buildStandings, type StandingRow } from "@/components/ui/StandingsTable";
import { getRemainingSeconds } from "./roundTimer";

// ─── RPC shape ───────────────────────────────────────────────────────

export interface PublicRoundTournament {
  id: string;
  name: string;
  current_round: number | null;
  n_rounds: number | null;
  /** Minutes. */
  round_length: number | null;
  /** Win threshold (5 for Type 1, 7 for Type 2). */
  max_score: number | null;
  has_started: boolean;
  has_ended: boolean;
  results_published: boolean;
  deck_format: string | null;
  category: string | null;
  starting_table_number: number | null;
  numbering_mode: string | null;
}

export interface PublicRound {
  id: string;
  round_number: number;
  started_at: string | null;
  is_completed: boolean | null;
}

export interface PublicMatch {
  id: string;
  round: number;
  match_order: number | null;
  table_number: number | null;
  player1_id: string | null;
  player2_id: string | null;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: string | null;
  is_tie: boolean | null;
}

export interface PublicBye {
  id: string;
  round_number: number;
  participant_id: string;
}

export interface PublicParticipant {
  id: string;
  name: string | null;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean;
}

export interface PublicRoundView {
  /** Postgres now() at query time — the clock every countdown is anchored to. */
  server_now: string;
  tournament: PublicRoundTournament;
  rounds: PublicRound[];
  matches: PublicMatch[];
  byes: PublicBye[];
  participants: PublicParticipant[];
}

// ─── Name matching ───────────────────────────────────────────────────

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Case- and whitespace-insensitive prefix match against the full name or any
 * word in it, so "anders" finds "Alice Anderson" but "lice" does not.
 */
export function nameMatches(query: string, name: string | null): boolean {
  const q = normalizeName(query);
  if (!q) return false;
  const n = normalizeName(name ?? "");
  if (n.startsWith(q)) return true;
  return n.split(" ").some((word) => word.startsWith(q));
}

/**
 * Candidates for "Find your name". An exact match wins outright; otherwise
 * every prefix match comes back and the UI pins only when there is one.
 */
export function findParticipants<P extends { name: string | null }>(
  query: string,
  participants: P[],
): P[] {
  const q = normalizeName(query);
  if (!q) return [];
  const exact = participants.filter((p) => normalizeName(p.name ?? "") === q);
  if (exact.length === 1) return exact;
  return participants.filter((p) => nameMatches(query, p.name));
}

// ─── Timer math ──────────────────────────────────────────────────────

/** Server clock minus the phone's clock, in ms. Zero if the server time is unreadable. */
export function clockOffsetMs(serverNowIso: string, localNowMs: number): number {
  const serverMs = Date.parse(serverNowIso);
  return Number.isFinite(serverMs) ? serverMs - localNowMs : 0;
}

/** `getRemainingSeconds` evaluated on the server's clock rather than the phone's. */
export function remainingSecondsWithOffset(
  startedAt: string | null,
  roundLengthMinutes: number | null,
  localNowMs: number,
  offsetMs: number,
): number {
  return getRemainingSeconds(startedAt, roundLengthMinutes ?? 0, localNowMs + offsetMs);
}

// ─── Round phase ─────────────────────────────────────────────────────

export type RoundPhase =
  | { kind: "ended" }
  /** Pairings are posted (End Round stages them) but the host hasn't pressed Start. */
  | { kind: "waiting"; round: number }
  | { kind: "running"; round: number; startedAt: string }
  | { kind: "complete"; round: number };

export function roundPhase(view: PublicRoundView): RoundPhase {
  const t = view.tournament;
  if (t.has_ended) return { kind: "ended" };
  const round = t.current_round ?? 0;
  const row = view.rounds.find((r) => Number(r.round_number) === round);
  if (!row || !row.started_at) return { kind: "waiting", round };
  if (row.is_completed) return { kind: "complete", round };
  return { kind: "running", round, startedAt: row.started_at };
}

// ─── Standings ───────────────────────────────────────────────────────

const DEFAULT_MAX_SCORE = 5;

/** Rank everyone exactly as the host's Standings tab does. Drop-outs are excluded. */
export function buildLiveStandings(view: PublicRoundView): StandingRow[] {
  const participants = view.participants.map((p) => ({
    id: p.id,
    name: p.name ?? "—",
    match_points: p.match_points,
    differential: p.differential,
    dropped_out: p.dropped_out === true,
  }));
  const matches = view.matches
    .filter((m) => m.player1_id && m.player2_id)
    .map((m) => ({
      id: m.id,
      round: m.round,
      player1_id: m.player1_id as string,
      player2_id: m.player2_id as string,
      player1_score: m.player1_score,
      player2_score: m.player2_score,
      winner_id: m.winner_id,
      is_tie: m.is_tie,
    }));
  const byes = view.byes.map((b) => ({
    participant_id: b.participant_id,
    round_number: Number(b.round_number),
  }));
  // A bye only scores once its round has started — same gate as the host
  // tab and the server recompute (migration 039).
  const startedRounds = view.rounds
    .filter((r) => r.started_at != null)
    .map((r) => Number(r.round_number));
  const maxScore = view.tournament.max_score ?? DEFAULT_MAX_SCORE;
  return buildStandings(
    participants,
    matches,
    byes,
    view.tournament.current_round,
    startedRounds,
    maxScore,
  );
}

// ─── Pairings ────────────────────────────────────────────────────────

export type MatchOutcome = "pending" | "p1" | "p2" | "tie";

export interface PairingMatch {
  id: string;
  tableNumber: number;
  p1: PublicParticipant | null;
  p2: PublicParticipant | null;
  score1: number | null;
  score2: number | null;
  outcome: MatchOutcome;
}

export interface PairingBye {
  id: string;
  participant: PublicParticipant | null;
}

export interface Pairings {
  matches: PairingMatch[];
  byes: PairingBye[];
}

export function tableLabel(tableNumber: number, seatsMode: boolean): string {
  return seatsMode
    ? `Seats ${2 * tableNumber - 1}·${2 * tableNumber}`
    : `Table ${tableNumber}`;
}

function outcomeOf(m: PublicMatch): MatchOutcome {
  if (m.player1_score == null || m.player2_score == null) return "pending";
  if (m.is_tie) return "tie";
  if (m.winner_id && m.winner_id === m.player1_id) return "p1";
  if (m.winner_id && m.winner_id === m.player2_id) return "p2";
  if (m.player1_score === m.player2_score) return "tie";
  return m.player1_score > m.player2_score ? "p1" : "p2";
}

/**
 * One round's pairings in table order, byes last.
 *
 * Legacy rows without a persisted `table_number` are numbered positionally
 * from `starting_table_number` in the host's fetch order (table_number nulls
 * first, then match_order) — the same fallback the host page applies.
 */
export function buildPairings(view: PublicRoundView, roundNumber: number): Pairings {
  const byId = new Map(view.participants.map((p) => [p.id, p]));
  const start = view.tournament.starting_table_number || 1;

  const rows = view.matches
    .filter((m) => Number(m.round) === roundNumber)
    .sort((a, b) => {
      const at = a.table_number ?? -Infinity;
      const bt = b.table_number ?? -Infinity;
      if (at !== bt) return at - bt;
      return (a.match_order ?? 0) - (b.match_order ?? 0);
    });

  const matches: PairingMatch[] = rows
    .map((m, index) => ({
      id: m.id,
      tableNumber: m.table_number ?? index + start,
      p1: m.player1_id ? (byId.get(m.player1_id) ?? null) : null,
      p2: m.player2_id ? (byId.get(m.player2_id) ?? null) : null,
      score1: m.player1_score,
      score2: m.player2_score,
      outcome: outcomeOf(m),
    }))
    .sort((a, b) => a.tableNumber - b.tableNumber);

  const byes: PairingBye[] = view.byes
    .filter((b) => Number(b.round_number) === roundNumber)
    .map((b) => ({ id: b.id, participant: byId.get(b.participant_id) ?? null }));

  return { matches, byes };
}

export type MyPairing =
  | { kind: "none" }
  | { kind: "bye" }
  | {
      kind: "match";
      tableNumber: number;
      opponent: PublicParticipant | null;
      myScore: number | null;
      theirScore: number | null;
      result: "pending" | "won" | "lost" | "tie";
    };

/** The pinned player's own pairing, seen from their side of the table. */
export function pairingFor(pairings: Pairings, participantId: string): MyPairing {
  for (const match of pairings.matches) {
    const isP1 = match.p1?.id === participantId;
    const isP2 = match.p2?.id === participantId;
    if (!isP1 && !isP2) continue;
    const mySide: MatchOutcome = isP1 ? "p1" : "p2";
    const result =
      match.outcome === "pending"
        ? "pending"
        : match.outcome === "tie"
          ? "tie"
          : match.outcome === mySide
            ? "won"
            : "lost";
    return {
      kind: "match",
      tableNumber: match.tableNumber,
      opponent: isP1 ? match.p2 : match.p1,
      myScore: isP1 ? match.score1 : match.score2,
      theirScore: isP1 ? match.score2 : match.score1,
      result,
    };
  }
  if (pairings.byes.some((b) => b.participant?.id === participantId)) return { kind: "bye" };
  return { kind: "none" };
}

// ─── "Updated Xs ago" ────────────────────────────────────────────────

export function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
