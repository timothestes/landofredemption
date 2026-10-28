import {
  byPlayOrder, canPlayMatch, currentRoundName, feeders, labelForMatch, matchState, seriesState, shapeOf, voidSlots,
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
  /** Text for an empty slot: 'Winner of QF2', 'Loser of SF1', 'Bye', or '' when the slot is filled or has no feeder. */
  placeholderA: string;
  placeholderB: string;
  canPlay: boolean;
  /** A losers-bracket match no deck can reach (both its feeders were byes). */
  empty: boolean;
}

export interface StageViews {
  /** Indexed [round - 1][position]. */
  winners: MatchView[][];
  /** Empty without a losers bracket. */
  losers: MatchView[][];
  final: MatchView | null;
}

export function buildMatchViews(data: BracketData): StageViews {
  const { bracket, entries, matches, games } = data;
  const byId = new Map(entries.map(e => [e.id, e]));
  const shape = { ...shapeOf(matches), size: bracket.size };
  const fed = feeders(matches);
  const voids = voidSlots(matches);

  const placeholder = (match: BracketMatch, side: 'a' | 'b'): string => {
    if ((side === 'a' ? match.entryAId : match.entryBId) !== null) return '';
    if (voids.get(match.id)?.[side]) return 'Bye';
    const source = fed.get(match.id)?.[side];
    if (!source) return '';
    return `${source.outcome === 'winner' ? 'Winner' : 'Loser'} of ${labelForMatch(shape, source.match)}`;
  };

  const view = (match: BracketMatch): MatchView => {
    const state = matchState(match, games, bracket.bestOf);
    const series = seriesState(games, match, bracket.bestOf);
    const v = voids.get(match.id);
    return {
      match,
      label: labelForMatch(shape, match),
      state,
      series,
      a: match.entryAId ? byId.get(match.entryAId) ?? null : null,
      b: match.entryBId ? byId.get(match.entryBId) ?? null : null,
      placeholderA: placeholder(match, 'a'),
      placeholderB: placeholder(match, 'b'),
      canPlay: canPlayMatch(match, byId, state),
      empty: !!v && v.a && v.b,
    };
  };

  const columns = (stage: 'winners' | 'losers'): MatchView[][] => {
    const inStage = matches.filter(m => m.stage === stage);
    const rounds = Math.max(0, ...inStage.map(m => m.round));
    return Array.from({ length: rounds }, (_, i) =>
      inStage.filter(m => m.round === i + 1).sort((x, y) => x.position - y.position).map(view));
  };

  const final = matches.find(m => m.stage === 'final');
  return { winners: columns('winners'), losers: columns('losers'), final: final ? view(final) : null };
}

/** Every match view, in the order the matches can be played. */
export function allViews(views: StageViews): MatchView[] {
  return [...views.winners.flat(), ...views.losers.flat(), ...(views.final ? [views.final] : [])]
    .sort((x, y) => byPlayOrder(x.match, y.match));
}

/** One line per series the champion won, in round order: 'Beat Gold Temple 2–0'. Byes are skipped. */
export function championPath(data: BracketData, championEntryId: string): string[] {
  const byId = new Map(data.entries.map(e => [e.id, e]));
  return data.matches
    .filter(m => !m.isBye && m.winnerEntryId === championEntryId)
    .sort(byPlayOrder)
    .map(m => {
      const s = seriesState(data.games, m, data.bracket.bestOf);
      const isA = m.entryAId === championEntryId;
      const opponentId = isA ? m.entryBId : m.entryAId;
      const name = (opponentId && byId.get(opponentId)?.deckName) || 'Unknown deck';
      const [won, lost] = isA ? [s.winsA, s.winsB] : [s.winsB, s.winsA];
      return `Beat ${name} ${won}–${lost}`;
    });
}

/** The match to scroll to on phones: the first live one, else the first ready one, in play order. */
export function firstActionableMatchId(views: StageViews): string | null {
  const flat = allViews(views);
  return (flat.find(v => v.state === 'live') ?? flat.find(v => v.state === 'ready'))?.match.id ?? null;
}

/** The header's second line, shared by the bracket and breakdown pages: 'T1 · 8 decks · Best of 3 · Quarterfinals'. */
export function bracketMeta(data: BracketData): string {
  return [
    data.bracket.format,
    `${data.entries.length} decks`,
    `Best of ${data.bracket.bestOf}`,
    ...(shapeOf(data.matches).losers ? ['Losers bracket'] : []),
    currentRoundName(data.bracket, data.matches, data.games),
  ].join(' · ');
}
