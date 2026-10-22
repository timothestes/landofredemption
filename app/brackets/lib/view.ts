import {
  canPlayMatch, currentRoundName, firstEntryForGame, matchLabel, matchState, roundCount, seriesState,
} from '@/lib/bracket';
import type {
  Bracket, BracketEntry, BracketGame, BracketMatch, MatchState, SeriesState,
} from '@/lib/bracket/types';

export interface BracketData {
  bracket: Bracket;
  entries: BracketEntry[];
  matches: BracketMatch[];
  games: BracketGame[];
}

export interface MatchView {
  match: BracketMatch;
  label: string;
  state: MatchState;
  series: SeriesState;
  a: BracketEntry | null;
  b: BracketEntry | null;
  /** Text for an empty slot: 'Winner of QF2', 'Bye', or '' when the slot is filled or has no feeder. */
  placeholderA: string;
  placeholderB: string;
  /** Who goes first in the next game; set only for game 2+ of a `ready` match. */
  firstToPlayName: string | null;
  canPlay: boolean;
}

/** Views indexed [round - 1][position]. */
export function buildMatchViews(data: BracketData): MatchView[][] {
  const { bracket, entries, matches, games } = data;
  const byId = new Map(entries.map(e => [e.id, e]));
  const rounds = roundCount(bracket.size);

  const placeholder = (match: BracketMatch, side: 'a' | 'b'): string => {
    if ((side === 'a' ? match.entryAId : match.entryBId) !== null) return '';
    if (match.isBye) return side === 'b' ? 'Bye' : '';
    if (match.round === 1) return '';
    const feeder = match.position * 2 + (side === 'a' ? 0 : 1);
    return `Winner of ${matchLabel(bracket.size, match.round - 1, feeder)}`;
  };

  return Array.from({ length: rounds }, (_, i) =>
    matches
      .filter(m => m.round === i + 1)
      .sort((x, y) => x.position - y.position)
      .map((match): MatchView => {
        const state = matchState(match, games, bracket.bestOf);
        const series = seriesState(games, match, bracket.bestOf);
        const first = state === 'ready' && series.nextGameNumber >= 2
          ? byId.get(firstEntryForGame(games, match, 'a'))?.deckName ?? null
          : null;
        return {
          match,
          label: matchLabel(bracket.size, match.round, match.position),
          state,
          series,
          a: match.entryAId ? byId.get(match.entryAId) ?? null : null,
          b: match.entryBId ? byId.get(match.entryBId) ?? null : null,
          placeholderA: placeholder(match, 'a'),
          placeholderB: placeholder(match, 'b'),
          firstToPlayName: first,
          canPlay: canPlayMatch(match, byId, state),
        };
      }),
  );
}

/** One line per series the champion won, in round order: 'Beat Gold Temple 2–0'. Byes are skipped. */
export function championPath(data: BracketData, championEntryId: string): string[] {
  const byId = new Map(data.entries.map(e => [e.id, e]));
  return data.matches
    .filter(m => !m.isBye && m.winnerEntryId === championEntryId)
    .sort((x, y) => x.round - y.round)
    .map(m => {
      const s = seriesState(data.games, m, data.bracket.bestOf);
      const isA = m.entryAId === championEntryId;
      const opponentId = isA ? m.entryBId : m.entryAId;
      const name = (opponentId && byId.get(opponentId)?.deckName) || 'Unknown deck';
      const [won, lost] = isA ? [s.winsA, s.winsB] : [s.winsB, s.winsA];
      return `Beat ${name} ${won}–${lost}`;
    });
}

/** The match to scroll to on phones: the first live one, else the first ready one, in round order. */
export function firstActionableMatchId(views: MatchView[][]): string | null {
  const flat = views.flat();
  return (flat.find(v => v.state === 'live') ?? flat.find(v => v.state === 'ready'))?.match.id ?? null;
}

/** The header's second line, shared by the bracket and breakdown pages: 'T1 · 8 decks · Best of 3 · Quarterfinals'. */
export function bracketMeta(data: BracketData): string {
  return [
    data.bracket.format,
    `${data.entries.length} decks`,
    `Best of ${data.bracket.bestOf}`,
    currentRoundName(data.bracket, data.matches, data.games),
  ].join(' · ');
}
