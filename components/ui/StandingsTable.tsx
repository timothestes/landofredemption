"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Crown } from "lucide-react";
import { createClient } from "../../utils/supabase/client";
import InfoHint, { MP_HINT, DIFF_HINT } from "./InfoHint";
import {
  gameScoreForMatch,
  differentialForMatch,
} from "../../lib/tournament/standingsScoring";
import { orderByTiebreakers } from "../../lib/tournament/standings";
import { forfeitSideOf } from "../../lib/tournament/dropForfeit";
import type { Tiebreak } from "../../lib/tournament/types";
import { printFinalStandings } from "../../utils/printUtils";

interface Participant {
  id: string;
  name: string;
  match_points: number | null;
  differential: number | null;
  dropped_out: boolean;
}

interface MatchRow {
  id: string;
  round: number;
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: string | null;
  is_tie: boolean | null;
  /** Forfeit flags (migration 110). Optional so older test rows still fit. */
  player1_forfeit?: boolean | null;
  player2_forfeit?: boolean | null;
}

interface ByeRow {
  participant_id: string;
  round_number: number;
}

interface StandingsTableProps {
  tournamentId: string;
  participants: Participant[];
  tournamentEnded: boolean;
  /** Bumped by the page on data-changing events (drop player, End Round, repair)
   * so this component re-fetches matches/byes. Without it the standings only
   * refetch on tournamentId change. */
  matchesRefreshNonce?: number;
  /** The currently-in-progress round (1-indexed). Used to filter the W-L-T
   * display so byes pre-staged for the upcoming round (after End Round writes
   * the next round's pairings) don't count as wins before that round is
   * played. When undefined or 0, all byes are counted. */
  currentRound?: number | null;
}

export interface StandingRow {
  participant: Participant;
  /** 1-indexed placing. Players a tiebreaker cannot separate share a place,
   * and the next place skips ahead by the size of the tie. */
  place: number;
  wins: number;
  losses: number;
  ties: number;
  byes: number;
  /** Match points computed LIVE from matches + gated byes (mirrors the stored
   * participants.match_points written by End Round; see migration 039). */
  mp: number;
  /** Differential computed LIVE from matches (mirrors stored differential). */
  diff: number;
  /** Which tiebreaker settled this placing, and against whom. */
  tiebreak: Tiebreak;
}

/** Default tournament win threshold; only used when max_score isn't supplied
 * (older callsites / tests). Matches the app's standard 5-soul win. */
const DEFAULT_MAX_SCORE = 5;

/**
 * Per-player W/L/T computed strictly from match + bye history.
 * - Byes count as wins (the algorithm awards 3 MP, same as a full win).
 * - A forfeit is a loss for the forfeiter and a win for their opponent; a
 *   double forfeit is a loss for both (nobody is awarded the win).
 * - Otherwise we rely on the stored winner_id + is_tie the tracker writes.
 */
function computeRecord(
  participantId: string,
  matches: MatchRow[],
  byes: ByeRow[],
): { wins: number; losses: number; ties: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const m of matches) {
    if (m.player1_id !== participantId && m.player2_id !== participantId) continue;
    if (m.player1_score === null || m.player2_score === null) continue;
    const forfeit = forfeitSideOf(m);
    if (forfeit) {
      const isP1 = m.player1_id === participantId;
      const forfeited = forfeit === "both" || forfeit === (isP1 ? "player1" : "player2");
      if (forfeited) losses++;
      else wins++;
      continue;
    }
    if (m.is_tie) {
      ties++;
      continue;
    }
    if (m.winner_id === participantId) {
      wins++;
    } else if (m.winner_id) {
      losses++;
    }
  }

  for (const b of byes) {
    if (b.participant_id === participantId) wins++;
  }

  return { wins, losses, ties };
}

/**
 * Did `aId` defeat `bId`? True when a won more of their matches than b did —
 * a pair normally meets at most once, but the rematch fallback can pair them
 * twice in a small field.
 */
function beatHeadToHead(aId: string, bId: string, matches: MatchRow[]): boolean {
  let aWins = 0;
  let bWins = 0;
  for (const m of matches) {
    if (m.player1_score === null || m.player2_score === null) continue;
    if (m.is_tie) continue;
    const isAvsB =
      (m.player1_id === aId && m.player2_id === bId) ||
      (m.player1_id === bId && m.player2_id === aId);
    if (!isAvsB) continue;
    if (m.winner_id === aId) aWins++;
    else if (m.winner_id === bId) bWins++;
  }
  return aWins > bWins;
}

/**
 * Build sorted standings rows. Ordering is delegated to
 * `orderByTiebreakers` so this tab ranks players exactly the way the
 * published placings do: MP desc, then head-to-head, then differential, with
 * shared places for players nothing separates.
 *
 * The Byes column shown in the UI reports how many byes each player has been
 * awarded in completed rounds (each counts as a win in the W-L-T record).
 *
 * `currentRound` (1-indexed, the round being played) gates which byes count
 * toward the W-L-T display: a bye for round N+1 is staged the moment End
 * Round N completes (createPairing inserts it), but it shouldn't show as
 * a "win" before round N+1 is played. Only byes for completed rounds
 * (round_number < currentRound) count. The MP/differential numbers are
 * computed LIVE here from the same matches + gated byes (per migration 039's
 * recompute_participant_totals formula), so they always agree with the W-L-T
 * record the instant a score is entered — the stored
 * participants.match_points/differential are not read for display.
 *
 * Exported for unit testing.
 */
export function buildStandings(
  participants: Participant[],
  matches: MatchRow[],
  byes: ByeRow[],
  currentRound?: number | null,
  startedRounds?: number[] | null,
  maxScore: number = DEFAULT_MAX_SCORE,
): StandingRow[] {
  // Active participants only — drop-outs are excluded from standings per
  // algorithm.md §"Determining Final Standings" step 1.
  const active = participants.filter((p) => !p.dropped_out);
  // A bye only counts once its round has actually started (Option C) — a round
  // staged by End Round but not yet started must not show the bye as a win or
  // award its points. This mirrors the server recompute exactly. Fall back to
  // the older current-round cutoff (then to "count all") for callsites/tests
  // that don't supply startedRounds.
  const playedByes = startedRounds
    ? byes.filter((b) => startedRounds.includes(b.round_number))
    : currentRound && currentRound > 0
      ? byes.filter((b) => b.round_number < currentRound)
      : byes;

  // Compute MP and DIFF LIVE from the same matches + gated byes used for the
  // W-L-T record, so every column stays consistent the instant a score is
  // entered (the stored participants.match_points/differential only update on
  // End Round). The per-match formula mirrors migration 039's
  // recompute_participant_totals; gated byes add +3 MP / +0 DIFF each.
  const liveTotals = (participantId: string): { mp: number; diff: number } => {
    let mp = 0;
    let diff = 0;
    for (const m of matches) {
      mp += gameScoreForMatch(participantId, m, maxScore);
      diff += differentialForMatch(participantId, m);
    }
    const byeCount = playedByes.filter(
      (b) => b.participant_id === participantId,
    ).length;
    mp += 3 * byeCount;
    return { mp, diff };
  };

  const totals = new Map<string, { mp: number; diff: number }>(
    active.map((p) => [p.id, liveTotals(p.id)]),
  );

  const ranked = orderByTiebreakers(
    active.map((p) => {
      const t = totals.get(p.id)!;
      return {
        id: p.id,
        gameScore: t.mp,
        lostSoulScore: t.diff,
        participant: p,
      };
    }),
    (a, b) => beatHeadToHead(a, b, matches),
  );

  return ranked.map((entry) => {
    const p = entry.row.participant;
    const record = computeRecord(p.id, matches, playedByes);
    const byeCount = playedByes.filter((b) => b.participant_id === p.id).length;
    const t = totals.get(p.id)!;
    return {
      participant: p,
      place: entry.place,
      wins: record.wins,
      losses: record.losses,
      ties: record.ties,
      byes: byeCount,
      mp: t.mp,
      diff: t.diff,
      tiebreak: entry.tiebreak,
    };
  });
}

/** Everything `buildStandings` needs beyond the participant roster. */
async function fetchStandingsInputs(tournamentId: string): Promise<{
  matches: MatchRow[];
  byes: ByeRow[];
  startedRounds: number[];
  maxScore: number;
}> {
  const client = createClient();
  const [matchesRes, byesRes, roundsRes, tournamentRes] = await Promise.all([
    client
      .from("matches")
      .select(
        "id, round, player1_id, player2_id, player1_score, player2_score, winner_id, is_tie, player1_forfeit, player2_forfeit",
      )
      .eq("tournament_id", tournamentId),
    client
      .from("byes")
      .select("participant_id, round_number")
      .eq("tournament_id", tournamentId),
    // Started rounds gate which byes count — a bye only scores once its
    // round has actually started (Option C), matching the server recompute.
    client
      .from("rounds")
      .select("round_number, started_at")
      .eq("tournament_id", tournamentId),
    // max_score is the win threshold ("full win") used by the live MP
    // formula — same value migration 039 reads from tournaments.max_score.
    client
      .from("tournaments")
      .select("max_score")
      .eq("id", tournamentId)
      .single(),
  ]);
  const ms = (tournamentRes.data as any)?.max_score;
  return {
    matches: (matchesRes.data ?? []) as MatchRow[],
    byes: (byesRes.data ?? []) as ByeRow[],
    startedRounds: (roundsRes.data ?? [])
      .filter((r: any) => r.started_at != null)
      .map((r: any) => Number(r.round_number)),
    maxScore: ms != null ? Number(ms) : DEFAULT_MAX_SCORE,
  };
}

/**
 * Print the final standings, ranked the same way this tab (and the published
 * placings) rank them. The Print Final Standings buttons live outside this
 * component, so they come back through here rather than re-deriving an order
 * from the stored participant columns — that shortcut is what let the printed
 * sheet disagree with the published result.
 */
export async function printFinalStandingsFor(
  tournamentId: string,
  participants: Participant[],
  tournamentName?: string | null,
): Promise<void> {
  const inputs = await fetchStandingsInputs(tournamentId);
  const rows = buildStandings(
    participants,
    inputs.matches,
    inputs.byes,
    null,
    inputs.startedRounds,
    inputs.maxScore,
  );
  printFinalStandings(
    rows.map((r) => ({
      place: r.place,
      name: r.participant.name,
      mp: r.mp,
      diff: r.diff,
    })),
    tournamentName,
    participants
      .filter((p) => p.dropped_out)
      .map((p) => ({
        name: p.name,
        match_points: p.match_points,
        differential: p.differential,
      })),
  );
}

/** "Bob", "Bob and Carl", "Bob, Carl and Dave", "Bob, Carl, Dave and 3 others". */
function nameList(ids: string[], nameOf: (id: string) => string): string {
  const names = ids.map(nameOf);
  if (names.length <= 1) return names.join("");
  const MAX_NAMED = 3;
  if (names.length <= MAX_NAMED) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  const rest = names.length - MAX_NAMED;
  return `${names.slice(0, MAX_NAMED).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Plain-language reason a row sits where it does, for the hover hint next to
 * its place. Returns null when the player shared their game score with nobody
 * and there was nothing to break.
 *
 * Exported for unit testing.
 */
export function explainTiebreak(
  row: Pick<StandingRow, "place" | "mp" | "diff" | "tiebreak">,
  nameOf: (id: string) => string,
): string | null {
  const { tiedWith, by, others } = row.tiebreak;
  if (by === "none" || tiedWith.length === 0) return null;

  const tied = `Tied on ${row.mp} MP with ${nameList(tiedWith, nameOf)}.`;
  switch (by) {
    case "head_to_head":
      return `${tied} Placed ahead for beating ${nameList(others, nameOf)} head-to-head.`;
    case "lost_soul_score":
      return `${tied} No head-to-head win settled it, so the higher differential placed them ahead of ${nameList(
        others,
        nameOf,
      )}.`;
    case "shared":
      return `${tied} Same ${row.diff} differential, and ${
        others.length === 1
          ? "neither beat the other"
          : "nobody beat all the others"
      }, so they share ${ordinal(row.place)} — ranking points and prizes are split.`;
    case "behind":
      return `${tied} Placed behind them on head-to-head and differential.`;
  }
}

export default function StandingsTable({
  tournamentId,
  participants,
  tournamentEnded,
  matchesRefreshNonce,
  currentRound,
}: StandingsTableProps) {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [byes, setByes] = useState<ByeRow[]>([]);
  const [startedRounds, setStartedRounds] = useState<number[]>([]);
  const [maxScore, setMaxScore] = useState<number>(DEFAULT_MAX_SCORE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    (async () => {
      const inputs = await fetchStandingsInputs(tournamentId);
      if (cancelled) return;
      setMatches(inputs.matches);
      setByes(inputs.byes);
      setStartedRounds(inputs.startedRounds);
      setMaxScore(inputs.maxScore);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, matchesRefreshNonce]);

  const rows: StandingRow[] = useMemo(
    () =>
      buildStandings(
        participants,
        matches,
        byes,
        currentRound,
        startedRounds,
        maxScore,
      ),
    [participants, matches, byes, currentRound, startedRounds, maxScore],
  );

  // Tiebreak hints name the players a row was tied with, so the hint text
  // needs id → name for everyone on the roster.
  const nameOf = useMemo(() => {
    const names = new Map(participants.map((p) => [p.id, p.name]));
    return (id: string) => names.get(id) ?? "another player";
  }, [participants]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading standings…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active participants to rank yet.
      </p>
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <ul className="md:hidden space-y-2">
        {rows.map((row) => {
          const isWinner = tournamentEnded && row.place === 1;
          const why = explainTiebreak(row, nameOf);
          return (
            <li
              key={row.participant.id}
              className={`rounded-lg border border-border bg-card p-3 ${
                isWinner ? "ring-1 ring-yellow-500/40 bg-yellow-500/5" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                      #{row.place}
                    </span>
                    {why && <InfoHint text={why} />}
                    {isWinner && (
                      <Crown
                        className="w-4 h-4 text-orange-300 flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {row.participant.name}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>
                      <span className="text-muted-foreground/70">W-L-T</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.wins}-{row.losses}-{row.ties}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">MP</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.mp}
                      </span>
                      <InfoHint text={MP_HINT} />
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Diff</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.diff}
                      </span>
                      <InfoHint text={DIFF_HINT} />
                    </span>
                    <span title="Number of byes awarded in completed rounds (each counts as a win).">
                      <span className="text-muted-foreground/70">Byes</span>{" "}
                      <span className="text-foreground font-medium">
                        {row.byes}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="min-w-full text-sm text-left text-muted-foreground border border-border rounded-lg overflow-hidden">
          {/*
            Sort-hierarchy convention: active sort columns (MP primary, Diff
            tiebreaker) read as `text-foreground` with a muted chevron;
            inactive headers stay muted with no chevron. Communicates active
            sort via header tint rather than a bright accent on the icon.
            Head-to-head sits between the two but has no column of its own —
            it shows up in the per-row hint next to the place instead.
          */}
          <thead className="text-xs uppercase font-medium bg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-muted-foreground">
                Rank
              </th>
              <th scope="col" className="px-4 py-3 text-left text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Player
                </span>
              </th>
              <th scope="col" className="px-4 py-3 text-center text-muted-foreground">
                Record (W-L-T)
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center"
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  MP <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <InfoHint text={MP_HINT} />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center"
                aria-sort="descending"
              >
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  Diff <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                  <InfoHint text={DIFF_HINT} />
                </span>
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center text-muted-foreground"
                title="Number of byes awarded in completed rounds. Each bye counts as a win in the W-L-T record."
              >
                Byes
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isWinner = tournamentEnded && row.place === 1;
              const why = explainTiebreak(row, nameOf);
              return (
                <tr
                  key={row.participant.id}
                  className={`border-t border-border ${
                    isWinner ? "bg-yellow-500/5" : "hover:bg-muted/50"
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-foreground tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      {row.place}
                      {why && <InfoHint text={why} />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    <span className="inline-flex items-center gap-2">
                      {isWinner && (
                        <Crown
                          className="w-4 h-4 text-orange-300"
                          aria-hidden="true"
                        />
                      )}
                      {row.participant.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.wins}-{row.losses}-{row.ties}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-foreground">
                    {row.mp}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-foreground">
                    {row.diff}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.byes}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
