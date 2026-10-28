import type { Bracket, BracketEntry, BracketGame, BracketMatch, Shape, Stage } from './types';
import {
  byPlayOrder, findMatch, labelForMatch, loserTarget, roundNames, seriesState, shapeOf, winnerTarget,
} from './index';

/**
 * What a bracket's results say, deck by deck.
 *
 * Pure functions over the loaded rows, so the breakdown page can be tested
 * without a database. Single elimination gives tiers rather than places —
 * both semifinal losers finish equal — so a finish is the round a deck went
 * out in, and `place` is the tier's rank (1, 2, 3, 5, 9) for sorting. With a
 * losers bracket a deck is out only after its second loss, and the losers
 * rounds give 3rd, 4th, then tiers again.
 */

export interface StandingsInput {
  bracket: Bracket;
  entries: BracketEntry[];
  matches: BracketMatch[];
  games: BracketGame[];
}

export type Finish =
  | { kind: 'champion'; place: 1 }
  | { kind: 'out'; place: number; round: number; stage: Stage }
  /** Still in: `reached` is the highest round the deck has a seat in. */
  | { kind: 'alive'; reached: number };

export interface GameLine {
  gameNumber: number;
  won: boolean;
  /** Null when unknown — a hand-recorded game has no first player. */
  wentFirst: boolean | null;
  souls: { own: number; opponent: number } | null;
  /** Time at the table; null for hand-recorded games and games resumed later. */
  minutes: number | null;
  byHand: boolean;
}

export interface SeriesLine {
  matchId: string;
  label: string;
  round: number;
  opponentId: string;
  opponentName: string;
  /** Null while the series is undecided. */
  won: boolean | null;
  wins: number;
  losses: number;
  games: GameLine[];
}

export interface StandingRow {
  entry: BracketEntry;
  finish: Finish;
  finishLabel: string;
  games: { won: number; lost: number };
  series: { won: number; lost: number };
  /** Null until a game with souls on both sides has been recorded. */
  souls: { rescued: number; conceded: number; games: number } | null;
  /** Every series the deck has a filled opponent in, round order; byes skipped. */
  road: SeriesLine[];
}

/** A wall-clock game longer than this was resumed later, not played in one sitting. */
const MAX_PLAUSIBLE_MINUTES = 180;

export function gameMinutes(game: BracketGame): number | null {
  if (game.mode === 'manual' || !game.finishedAt) return null;
  const ms = new Date(game.finishedAt).getTime() - new Date(game.startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes > MAX_PLAUSIBLE_MINUTES ? null : minutes;
}

/** Losers of round r finish tied at size / 2^r + 1: 5th in an 8-deck bracket's first round. */
export function placeForRound(size: number, round: number): number {
  return size / 2 ** round + 1;
}

/**
 * Where a loss in each match puts a deck when a losers bracket is played:
 * the grand final's loser is 2nd, then each losers round's losers finish
 * behind everyone still in after it. Byes eliminate no one. A winners-bracket
 * loss is not an elimination; its worst case is the losers match it drops into.
 */
function losersBracketPlaces(matches: BracketMatch[]): Map<string, number> {
  const shape = shapeOf(matches);
  const places = new Map<string, number>();
  let ahead = 1; // the champion
  const final = matches.find(m => m.stage === 'final');
  if (final) places.set(final.id, ++ahead);
  const rounds = [...new Set(matches.filter(m => m.stage === 'losers').map(m => m.round))].sort((x, y) => y - x);
  for (const round of rounds) {
    const inRound = matches.filter(m => m.stage === 'losers' && m.round === round);
    for (const m of inRound) places.set(m.id, ahead + 1);
    ahead += inRound.filter(m => !m.isBye).length;
  }
  for (const m of matches.filter(x => x.stage === 'winners')) {
    const t = loserTarget(shape, m);
    const drop = t && findMatch(matches, t);
    if (drop) places.set(m.id, places.get(drop.id)!);
  }
  return places;
}

export function finishLabel(finish: Finish, size: Bracket['size']): string {
  if (finish.kind === 'champion') return 'Champion';
  if (finish.kind === 'alive') return 'Still in';
  if (finish.stage === 'final') return 'Runner-up';
  if (finish.stage === 'losers') return finish.place === 3 ? 'Third' : finish.place === 4 ? 'Fourth' : `Losers round ${finish.round}`;
  const name = roundNames(size)[finish.round - 1];
  if (name === 'Final') return 'Runner-up';
  if (name === 'Semifinals') return 'Semifinalist';
  if (name === 'Quarterfinals') return 'Quarterfinalist';
  return name;
}

const soulsDiff = (row: StandingRow) => (row.souls ? row.souls.rescued - row.souls.conceded : 0);

export function computeStandings(input: StandingsInput): StandingRow[] {
  const { bracket, entries, matches, games } = input;
  const shape: Shape = { ...shapeOf(matches), size: bracket.size };
  const byId = new Map(entries.map(e => [e.id, e]));
  const doublePlaces = shape.losers ? losersBracketPlaces(matches) : null;
  /** The place a loss in this match means, at worst. */
  const placeFor = (m: BracketMatch) => doublePlaces?.get(m.id) ?? placeForRound(bracket.size, m.round);
  const worstCase = new Map<string, number>();

  const rows = entries.map((entry): StandingRow => {
    const seated = matches
      .filter(m => m.entryAId === entry.id || m.entryBId === entry.id)
      .sort(byPlayOrder);

    const road: SeriesLine[] = [];
    for (const m of seated) {
      if (m.isBye) continue;
      const isA = m.entryAId === entry.id;
      const opponentId = isA ? m.entryBId : m.entryAId;
      if (!opponentId) continue;
      const s = seriesState(games, m, bracket.bestOf);
      const lines = games
        .filter(g => g.matchId === m.id && g.winnerEntryId !== null)
        .sort((x, y) => x.gameNumber - y.gameNumber)
        .map((g): GameLine => ({
          gameNumber: g.gameNumber,
          won: g.winnerEntryId === entry.id,
          wentFirst: g.firstEntryId === null ? null : g.firstEntryId === entry.id,
          souls: g.soulsA !== null && g.soulsB !== null
            ? { own: isA ? g.soulsA : g.soulsB, opponent: isA ? g.soulsB : g.soulsA }
            : null,
          minutes: gameMinutes(g),
          byHand: g.mode === 'manual',
        }));
      road.push({
        matchId: m.id,
        label: labelForMatch(shape, m),
        round: m.round,
        opponentId,
        opponentName: byId.get(opponentId)?.deckName ?? 'Unknown deck',
        won: m.winnerEntryId ? m.winnerEntryId === entry.id : null,
        wins: isA ? s.winsA : s.winsB,
        losses: isA ? s.winsB : s.winsA,
        games: lines,
      });
    }

    let finish: Finish;
    const wonFinal = seated.some(m => winnerTarget(shape, m) === 'champion' && m.winnerEntryId === entry.id);
    // A winners-bracket loss with a losers bracket behind it only drops the deck down.
    const lost = seated.find(m => !m.isBye && m.winnerEntryId !== null && m.winnerEntryId !== entry.id
      && !loserTarget(shape, m));
    if (bracket.championEntryId === entry.id || wonFinal) finish = { kind: 'champion', place: 1 };
    else if (lost) finish = { kind: 'out', place: placeFor(lost), round: lost.round, stage: lost.stage };
    else {
      const current = seated.at(-1);
      finish = { kind: 'alive', reached: current?.round ?? 1 };
      worstCase.set(entry.id, current ? placeFor(current) : placeForRound(bracket.size, 1));
    }

    const played = road.flatMap(r => r.games);
    const scored = played.filter(g => g.souls !== null);
    return {
      entry,
      finish,
      finishLabel: finishLabel(finish, bracket.size),
      games: { won: played.filter(g => g.won).length, lost: played.filter(g => !g.won).length },
      series: { won: road.filter(r => r.won === true).length, lost: road.filter(r => r.won === false).length },
      souls: scored.length
        ? {
            rescued: scored.reduce((n, g) => n + g.souls!.own, 0),
            conceded: scored.reduce((n, g) => n + g.souls!.opponent, 0),
            games: scored.length,
          }
        : null,
      road,
    };
  });

  // Rank by the finish a deck is already guaranteed: a decided deck by its
  // place, a live one by the tier it would drop to if it lost its next series.
  // Matches can be played in any order, so a semifinal loser (3rd at worst)
  // outranks four quarterfinalists who have not played yet (5th at worst).
  const guaranteed = (row: StandingRow) =>
    row.finish.kind === 'champion' ? 1 : row.finish.kind === 'out' ? row.finish.place : worstCase.get(row.entry.id)!;
  return rows.sort((a, b) => (
    guaranteed(a) - guaranteed(b)
    || Number(a.finish.kind === 'out') - Number(b.finish.kind === 'out')
    || b.games.won - a.games.won
    || a.games.lost - b.games.lost
    || soulsDiff(b) - soulsDiff(a)
    || a.entry.seed - b.entry.seed
  ));
}

/** 'Beat Joshua 2–0' / 'Lost to Nativity 1–2'; scores are dropped for best-of-one. */
export function describeSeries(line: SeriesLine, bestOf: Bracket['bestOf']): string | null {
  if (line.won === null) return null;
  const verb = line.won ? 'Beat' : 'Lost to';
  return bestOf === 1 ? `${verb} ${line.opponentName}` : `${verb} ${line.opponentName} ${line.wins}–${line.losses}`;
}

export type MomentKind = 'closest' | 'blowout' | 'comeback' | 'distance' | 'longest' | 'fastest';

export interface Moment {
  kind: MomentKind;
  title: string;
  text: string;
}

/**
 * The night's story, one line each, and only the ones that happened: nothing
 * here renders as an empty tile. Souls-based lines skip games the winner
 * ended short of the loser's count (a resignation or a claimed timeout).
 */
export function computeMoments(input: StandingsInput): Moment[] {
  const { bracket, entries, matches, games } = input;
  const bestOf = bracket.bestOf;
  const name = (id: string | null) => (id && entries.find(e => e.id === id)?.deckName) || 'Unknown deck';
  const matchById = new Map(matches.map(m => [m.id, m]));
  const shape: Shape = { ...shapeOf(matches), size: bracket.size };
  const label = (m: BracketMatch) => labelForMatch(shape, m);
  const where = (m: BracketMatch, g: BracketGame) => (bestOf === 1 ? label(m) : `${label(m)}, game ${g.gameNumber}`);

  const decided = games
    .filter(g => g.winnerEntryId !== null && matchById.has(g.matchId))
    .sort((x, y) => {
      const a = matchById.get(x.matchId)!;
      const b = matchById.get(y.matchId)!;
      return byPlayOrder(a, b) || x.gameNumber - y.gameNumber;
    });

  const scored = decided.flatMap(g => {
    const m = matchById.get(g.matchId)!;
    const winnerIsA = g.winnerEntryId === m.entryAId;
    const ws = winnerIsA ? g.soulsA : g.soulsB;
    const ls = winnerIsA ? g.soulsB : g.soulsA;
    if (ws === null || ls === null || ws <= ls) return [];
    const loserId = winnerIsA ? m.entryBId : m.entryAId;
    return [{ g, m, ws, ls, margin: ws - ls, winner: name(g.winnerEntryId), loser: name(loserId) }];
  });
  const scoreline = (s: (typeof scored)[number]) => `${where(s.m, s.g)} · ${s.winner} ${s.ws}–${s.ls} ${s.loser}`;

  const moments: Moment[] = [];
  // One scored game is neither the closest nor the widest of anything.
  if (scored.length >= 2) {
    const closest = scored.reduce((best, s) => (s.margin < best.margin ? s : best));
    moments.push({ kind: 'closest', title: 'Closest game', text: scoreline(closest) });
    const blowout = scored.reduce((best, s) => (s.margin > best.margin ? s : best));
    if (blowout.margin > closest.margin) {
      moments.push({ kind: 'blowout', title: 'Biggest blowout', text: scoreline(blowout) });
    }
  }

  if (bestOf > 1) {
    const series = matches
      .filter(m => !m.isBye && m.winnerEntryId !== null && m.entryAId && m.entryBId)
      .sort(byPlayOrder);
    for (const m of series) {
      const own = decided.filter(g => g.matchId === m.id);
      const s = seriesState(games, m, bestOf);
      const winnerIsA = m.winnerEntryId === m.entryAId;
      const [w, l] = winnerIsA ? [s.winsA, s.winsB] : [s.winsB, s.winsA];
      const winner = name(m.winnerEntryId);
      const loser = name(winnerIsA ? m.entryBId : m.entryAId);
      // The deepest hole the winner climbed out of: 0–1 in a best of three, 0–2 or 1–2 in a best of five.
      let winnerWins = 0;
      let loserWins = 0;
      let hole: [number, number] | null = null;
      for (const g of own) {
        if (g.winnerEntryId === m.winnerEntryId) winnerWins += 1;
        else loserWins += 1;
        if (loserWins > winnerWins && (!hole || loserWins - winnerWins > hole[1] - hole[0])) hole = [winnerWins, loserWins];
      }
      if (hole) {
        moments.push({
          kind: 'comeback',
          title: 'Comeback',
          text: `${winner} came back from ${hole[0]}–${hole[1]} to take ${label(m)} ${w}–${l}`,
        });
      } else if (own.length === bestOf) {
        moments.push({ kind: 'distance', title: 'Went the distance', text: `${label(m)} · ${winner} ${w}–${l} ${loser}` });
      }
    }
  }

  // Timed lines take only games won on souls, so a one-minute resignation
  // after loading the wrong deck never becomes the fastest win.
  const timed = scored.flatMap(s => {
    const minutes = gameMinutes(s.g);
    return minutes === null ? [] : [{ ...s, minutes }];
  });
  if (timed.length >= 2) {
    const longest = timed.reduce((best, t) => (t.minutes > best.minutes ? t : best));
    const fastest = timed.reduce((best, t) => (t.minutes < best.minutes ? t : best));
    if (longest.g.id !== fastest.g.id) {
      const versus = (t: (typeof timed)[number]) => `${t.winner} over ${t.loser}`;
      moments.push({ kind: 'longest', title: 'Longest game', text: `${where(longest.m, longest.g)} · ${longest.minutes} min · ${versus(longest)}` });
      moments.push({ kind: 'fastest', title: 'Fastest win', text: `${where(fastest.m, fastest.g)} · ${fastest.minutes} min · ${versus(fastest)}` });
    }
  }

  return moments;
}

/** Below this many games a first-player count is a handful of coin flips. */
export const GOING_FIRST_MIN_GAMES = 4;

/** Every game's first player is a coin flip. */
export interface FirstRecord { firstWon: number; total: number }

/** Hand-recorded games have no first player and are left out. */
export function goingFirst(games: BracketGame[]): FirstRecord {
  const record: FirstRecord = { firstWon: 0, total: 0 };
  for (const g of games) {
    if (g.winnerEntryId === null || g.firstEntryId === null) continue;
    record.total += 1;
    if (g.winnerEntryId === g.firstEntryId) record.firstWon += 1;
  }
  return record;
}
