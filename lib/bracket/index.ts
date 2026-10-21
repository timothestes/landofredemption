import type {
  Bracket, BracketEntry, BracketGame, BracketMatch, BracketSize, BestOf,
  MatchState, RowUpdate, SeriesState, Slot,
} from './types';

export function sizeFor(entryCount: number): BracketSize {
  if (!Number.isInteger(entryCount) || entryCount < 2 || entryCount > 16) {
    throw new RangeError(`A bracket needs 2 to 16 decks, got ${entryCount}`);
  }
  if (entryCount <= 2) return 2;
  if (entryCount <= 4) return 4;
  if (entryCount <= 8) return 8;
  return 16;
}

export function roundCount(size: BracketSize): number {
  return Math.log2(size);
}

/** Every 'a' slot top-down, then every 'b' slot, so a bye never meets a bye. */
export function slotOrder(size: BracketSize): Slot[] {
  const half = size / 2;
  const column = (side: 'a' | 'b') => Array.from({ length: half }, (_, position) => ({ position, side }));
  return [...column('a'), ...column('b')];
}

const ROUND_NAMES = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];

export function roundNames(size: BracketSize): string[] {
  return ROUND_NAMES.slice(ROUND_NAMES.length - roundCount(size));
}

const LABEL_PREFIX: Record<string, string> = {
  'Round of 16': 'R16-',
  Quarterfinals: 'QF',
  Semifinals: 'SF',
};

export function matchLabel(size: BracketSize, round: number, position: number): string {
  const name = roundNames(size)[round - 1];
  return name === 'Final' ? name : `${LABEL_PREFIX[name]}${position + 1}`;
}

export function nextSlot(round: number, position: number): Slot & { round: number } {
  return { round: round + 1, position: Math.floor(position / 2), side: position % 2 ? 'b' : 'a' };
}

export function buildBracket(entries: BracketEntry[], ids: () => string): BracketMatch[] {
  const size = sizeFor(entries.length);
  const matches: BracketMatch[] = [];
  for (let round = 1; round <= roundCount(size); round++) {
    for (let position = 0; position < size / 2 ** round; position++) {
      matches.push({ id: ids(), round, position, entryAId: null, entryBId: null, winnerEntryId: null, isBye: false });
    }
  }
  const at = (round: number, position: number) =>
    matches.find(m => m.round === round && m.position === position)!;

  const seeded = [...entries].sort((a, b) => a.seed - b.seed);
  slotOrder(size).forEach((slot, i) => {
    const e = seeded[i];
    if (!e) return;
    const m = at(1, slot.position);
    if (slot.side === 'a') m.entryAId = e.id;
    else m.entryBId = e.id;
  });

  for (const m of matches.filter(x => x.round === 1 && x.entryBId === null)) {
    m.isBye = true;
    m.winnerEntryId = m.entryAId;
    const next = nextSlot(m.round, m.position);
    const target = at(next.round, next.position);
    if (next.side === 'a') target.entryAId = m.winnerEntryId;
    else target.entryBId = m.winnerEntryId;
  }
  return matches;
}

const gamesOf = (games: BracketGame[], match: BracketMatch) =>
  games.filter(g => g.matchId === match.id).sort((a, b) => a.gameNumber - b.gameNumber);

export function seriesState(games: BracketGame[], match: BracketMatch, bestOf: BestOf): SeriesState {
  const own = gamesOf(games, match);
  const decidedGames = own.filter(g => g.winnerEntryId !== null);
  const winsA = decidedGames.filter(g => g.winnerEntryId === match.entryAId).length;
  const winsB = decidedGames.filter(g => g.winnerEntryId === match.entryBId).length;
  const needed = (bestOf + 1) / 2;
  const winner = winsA >= needed ? 'a' : winsB >= needed ? 'b' : null;
  const inProgress = own.find(g => g.winnerEntryId === null) ?? null;
  return {
    winsA, winsB, needed,
    decided: winner !== null,
    winner,
    nextGameNumber: inProgress ? inProgress.gameNumber : decidedGames.length + 1,
    inProgress,
  };
}

export function firstEntryForGame(games: BracketGame[], match: BracketMatch, coinFlip: 'a' | 'b'): string {
  const decided = gamesOf(games, match).filter(g => g.winnerEntryId !== null);
  const last = decided[decided.length - 1];
  if (!last) return (coinFlip === 'a' ? match.entryAId : match.entryBId)!;
  return (last.winnerEntryId === match.entryAId ? match.entryBId : match.entryAId)!;
}

export function matchState(match: BracketMatch, games: BracketGame[], bestOf: BestOf): MatchState {
  if (match.isBye) return 'bye';
  if (match.winnerEntryId) return 'done';
  if (!match.entryAId || !match.entryBId) return 'waiting';
  return seriesState(games, match, bestOf).inProgress ? 'live' : 'ready';
}

/** Recording a result never needs a deck; playing one does. */
export function canPlayMatch(match: BracketMatch, entriesById: Map<string, BracketEntry>, state: MatchState): boolean {
  if (state !== 'ready' && state !== 'live') return false;
  return [match.entryAId, match.entryBId].every(id => !!id && !!entriesById.get(id)?.deckId);
}

export function applyGameResult(args: {
  bracket: Bracket; matches: BracketMatch[]; games: BracketGame[]; gameId: string; winnerEntryId: string;
}): RowUpdate[] {
  const { bracket, matches, games, gameId, winnerEntryId } = args;
  const game = games.find(g => g.id === gameId);
  if (!game) throw new Error('game not found');
  if (game.winnerEntryId) throw new Error('game already decided');
  const match = matches.find(m => m.id === game.matchId);
  if (!match) throw new Error('match not found');
  if (match.winnerEntryId) throw new Error('match already decided');
  if (winnerEntryId !== match.entryAId && winnerEntryId !== match.entryBId) {
    throw new Error('winner is not in this match');
  }

  const updates: RowUpdate[] = [{ kind: 'game', gameId, winnerEntryId }];
  const after = games.map(g => (g.id === gameId ? { ...g, winnerEntryId } : g));
  const series = seriesState(after, match, bracket.bestOf);
  if (!series.decided) return updates;

  const seriesWinner = series.winner === 'a' ? match.entryAId! : match.entryBId!;
  updates.push({ kind: 'match-winner', matchId: match.id, winnerEntryId: seriesWinner });
  if (match.round === roundCount(bracket.size)) {
    updates.push({ kind: 'champion', entryId: seriesWinner });
  } else {
    const next = nextSlot(match.round, match.position);
    const target = matches.find(m => m.round === next.round && m.position === next.position);
    if (target) updates.push({ kind: 'match-slot', matchId: target.id, side: next.side, entryId: seriesWinner });
  }
  return updates;
}

function fedMatch(matches: BracketMatch[], match: BracketMatch) {
  const next = nextSlot(match.round, match.position);
  const target = matches.find(m => m.round === next.round && m.position === next.position);
  return target ? { target, side: next.side } : null;
}

/** A match can be reopened only while the match it fed has no games. */
export function resetMatchAllowed(matches: BracketMatch[], games: BracketGame[], matchId: string): boolean {
  const match = matches.find(m => m.id === matchId);
  if (!match || match.isBye) return false;
  const fed = fedMatch(matches, match);
  return !fed || !games.some(g => g.matchId === fed.target.id);
}

export function resetMatchUpdates(matches: BracketMatch[], bracket: Bracket, matchId: string): RowUpdate[] {
  const match = matches.find(m => m.id === matchId);
  if (!match) throw new Error('match not found');
  const updates: RowUpdate[] = [{ kind: 'match-winner', matchId, winnerEntryId: '' }];
  if (match.round === roundCount(bracket.size)) {
    updates.push({ kind: 'champion', entryId: null });
  } else {
    const fed = fedMatch(matches, match);
    if (fed) updates.push({ kind: 'match-slot', matchId: fed.target.id, side: fed.side, entryId: null });
  }
  return updates;
}

export function currentRoundName(bracket: Bracket, matches: BracketMatch[], _games: BracketGame[]): string {
  const names = roundNames(bracket.size);
  for (let round = 1; round <= names.length; round++) {
    if (matches.some(m => m.round === round && !m.isBye && !m.winnerEntryId)) return names[round - 1];
  }
  return 'Complete';
}
