import type {
  Bracket, BracketEntry, BracketGame, BracketMatch, BracketSize, BestOf,
  MatchState, RowUpdate, SeriesState, Shape, Slot, Stage, Target,
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

/** Two decks would only replay their match, so a losers bracket starts at three. */
export const MIN_LOSERS_BRACKET_DECKS = 3;

/** Two losers rounds per winners round after the first: one to pair the drops, one to take the next drops in. */
export function losersRoundCount(size: BracketSize): number {
  return 2 * (roundCount(size) - 1);
}

function losersMatchCount(size: BracketSize, round: number): number {
  return size / 2 ** (Math.floor((round + 1) / 2) + 1);
}

/** The bracket's shape, read off its match rows: a losers bracket is there when its matches are. */
export function shapeOf(matches: BracketMatch[]): Shape {
  const winnersRounds = Math.max(1, ...matches.filter(m => m.stage === 'winners').map(m => m.round));
  return { size: 2 ** winnersRounds as BracketSize, losers: matches.some(m => m.stage !== 'winners') };
}

export const hasLosersBracket = (matches: BracketMatch[]) => shapeOf(matches).losers;

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

/** A round's heading: 'Semifinals', 'Winners final', 'Losers round 2', 'Grand final'. */
export function stageRoundName(shape: Shape, stage: Stage, round: number): string {
  if (stage === 'final') return 'Grand final';
  if (stage === 'losers') return round === losersRoundCount(shape.size) ? 'Losers final' : `Losers round ${round}`;
  const name = roundNames(shape.size)[round - 1];
  return name === 'Final' && shape.losers ? 'Winners final' : name;
}

/** A match's short name: 'QF2', 'Final', 'L1-2', 'Losers final', 'Grand final'. */
export function labelForMatch(shape: Shape, m: Pick<BracketMatch, 'stage' | 'round' | 'position'>): string {
  if (m.stage === 'winners') {
    const label = matchLabel(shape.size, m.round, m.position);
    return label === 'Final' && shape.losers ? 'Winners final' : label;
  }
  if (m.stage === 'losers' && m.round !== losersRoundCount(shape.size)) return `L${m.round}-${m.position + 1}`;
  return stageRoundName(shape, m.stage, m.round);
}

export function nextSlot(round: number, position: number): Slot & { round: number } {
  return { round: round + 1, position: Math.floor(position / 2), side: position % 2 ? 'b' : 'a' };
}

/** Where a match's winner goes next. */
export function winnerTarget(shape: Shape, m: Pick<BracketMatch, 'stage' | 'round' | 'position'>): Target | 'champion' {
  if (m.stage === 'final') return 'champion';
  if (m.stage === 'winners') {
    if (m.round < roundCount(shape.size)) return { stage: 'winners', ...nextSlot(m.round, m.position) };
    return shape.losers ? { stage: 'final', round: 1, position: 0, side: 'a' } : 'champion';
  }
  if (m.round === losersRoundCount(shape.size)) return { stage: 'final', round: 1, position: 0, side: 'b' };
  // An odd losers round feeds the next round's same-numbered match, whose other
  // slot takes a winners-bracket drop; an even round halves like the winners side.
  if (m.round % 2 === 1) return { stage: 'losers', round: m.round + 1, position: m.position, side: 'a' };
  return { stage: 'losers', ...nextSlot(m.round, m.position) };
}

/** Where a match's loser goes: into the losers bracket from the winners side, otherwise out. */
export function loserTarget(shape: Shape, m: Pick<BracketMatch, 'stage' | 'round' | 'position'>): Target | null {
  if (!shape.losers || m.stage !== 'winners') return null;
  if (m.round === 1) {
    return { stage: 'losers', round: 1, position: Math.floor(m.position / 2), side: m.position % 2 ? 'b' : 'a' };
  }
  // Drops land in reverse order, so a deck does not meet the one it just beat.
  const round = 2 * (m.round - 1);
  return { stage: 'losers', round, position: losersMatchCount(shape.size, round) - 1 - m.position, side: 'b' };
}

/** A sort key that puts every match after the matches that feed it. */
export function playOrder(m: Pick<BracketMatch, 'stage' | 'round'>): number {
  if (m.stage === 'winners') return 3 * m.round;
  if (m.stage === 'losers') return 3 * (Math.floor(m.round / 2) + 1) + (m.round % 2 === 0 ? 1 : 2);
  return Number.MAX_SAFE_INTEGER;
}

export const byPlayOrder = (x: BracketMatch, y: BracketMatch) =>
  playOrder(x) - playOrder(y) || x.position - y.position;

export function findMatch(matches: BracketMatch[], t: Target): BracketMatch | undefined {
  return matches.find(m => m.stage === t.stage && m.round === t.round && m.position === t.position);
}

export type Source = { match: BracketMatch; outcome: 'winner' | 'loser' };

/** For each match, which match result fills each of its slots. First-round winners slots are seeded instead. */
export function feeders(matches: BracketMatch[]): Map<string, { a?: Source; b?: Source }> {
  const shape = shapeOf(matches);
  const out = new Map<string, { a?: Source; b?: Source }>();
  const link = (t: Target | 'champion' | null, source: Source) => {
    if (!t || t === 'champion') return;
    const target = findMatch(matches, t);
    if (target) out.set(target.id, { ...out.get(target.id), [t.side]: source });
  };
  for (const m of matches) {
    link(winnerTarget(shape, m), { match: m, outcome: 'winner' });
    link(loserTarget(shape, m), { match: m, outcome: 'loser' });
  }
  return out;
}

/**
 * Slots no deck will ever reach: the loser of a bye, or the winner of a match
 * that is itself empty. A losers match with one such slot is a bye; with two
 * it is empty and never plays.
 */
export function voidSlots(matches: BracketMatch[]): Map<string, { a: boolean; b: boolean }> {
  const fed = feeders(matches);
  const out = new Map<string, { a: boolean; b: boolean }>();
  const emptyMatch = (id: string) => { const v = out.get(id); return !!v && v.a && v.b; };
  for (const m of [...matches].sort(byPlayOrder)) {
    if (m.stage === 'winners') {
      out.set(m.id, { a: false, b: m.round === 1 && m.isBye });
      continue;
    }
    const isVoid = (s?: Source) => !!s && (s.outcome === 'loser' ? s.match.isBye : emptyMatch(s.match.id));
    out.set(m.id, { a: isVoid(fed.get(m.id)?.a), b: isVoid(fed.get(m.id)?.b) });
  }
  return out;
}

export function buildBracket(entries: BracketEntry[], ids: () => string, losers = false): BracketMatch[] {
  const size = sizeFor(entries.length);
  if (losers && entries.length < MIN_LOSERS_BRACKET_DECKS) {
    throw new RangeError(`A losers bracket needs at least ${MIN_LOSERS_BRACKET_DECKS} decks`);
  }
  const blank = (stage: Stage, round: number, position: number): BracketMatch =>
    ({ id: ids(), stage, round, position, entryAId: null, entryBId: null, winnerEntryId: null, isBye: false });

  const matches: BracketMatch[] = [];
  for (let round = 1; round <= roundCount(size); round++) {
    for (let position = 0; position < size / 2 ** round; position++) matches.push(blank('winners', round, position));
  }
  const at = (round: number, position: number) =>
    matches.find(m => m.stage === 'winners' && m.round === round && m.position === position)!;

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

  if (losers) matches.push(...losersMatches(size, ids, matches));
  return matches;
}

/**
 * The losers bracket and grand final for an existing winners bracket, byes
 * marked. One grand final: the losers-bracket winner has to beat the
 * winners-bracket winner once, no reset match.
 */
export function losersMatches(size: BracketSize, ids: () => string, winners: BracketMatch[]): BracketMatch[] {
  const blank = (stage: Stage, round: number, position: number): BracketMatch =>
    ({ id: ids(), stage, round, position, entryAId: null, entryBId: null, winnerEntryId: null, isBye: false });
  const added: BracketMatch[] = [];
  for (let round = 1; round <= losersRoundCount(size); round++) {
    for (let position = 0; position < losersMatchCount(size, round); position++) added.push(blank('losers', round, position));
  }
  added.push(blank('final', 1, 0));
  const voids = voidSlots([...winners.filter(m => m.stage === 'winners'), ...added]);
  for (const m of added) {
    const v = voids.get(m.id)!;
    m.isBye = v.a || v.b;
  }
  return added;
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

/** Seats a deck in a slot. A bye passes it straight on, since its other slot never fills. */
function routeInto(shape: Shape, matches: BracketMatch[], t: Target | 'champion' | null, entryId: string | null, updates: RowUpdate[]) {
  if (!t || !entryId) return;
  if (t === 'champion') {
    updates.push({ kind: 'champion', entryId });
    return;
  }
  const target = findMatch(matches, t);
  if (!target) return;
  updates.push({ kind: 'match-slot', matchId: target.id, side: t.side, entryId });
  if (target.isBye) {
    updates.push({ kind: 'match-winner', matchId: target.id, winnerEntryId: entryId });
    routeInto(shape, matches, winnerTarget(shape, target), entryId, updates);
  }
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

  const [seriesWinner, seriesLoser] = series.winner === 'a'
    ? [match.entryAId!, match.entryBId!]
    : [match.entryBId!, match.entryAId!];
  const shape = shapeOf(matches);
  updates.push({ kind: 'match-winner', matchId: match.id, winnerEntryId: seriesWinner });
  routeInto(shape, matches, winnerTarget(shape, match), seriesWinner, updates);
  routeInto(shape, matches, loserTarget(shape, match), seriesLoser, updates);
  return updates;
}

/** The first non-bye match a slot leads to; a bye that already passed a deck on is looked through. */
function blockedBy(shape: Shape, matches: BracketMatch[], games: BracketGame[], t: Target | 'champion' | null): boolean {
  if (!t || t === 'champion') return false;
  const target = findMatch(matches, t);
  if (!target) return false;
  if (target.isBye) return !!target.winnerEntryId && blockedBy(shape, matches, games, winnerTarget(shape, target));
  return games.some(g => g.matchId === target.id);
}

/** A match can be reopened only while the matches it fed have no games. */
export function resetMatchAllowed(matches: BracketMatch[], games: BracketGame[], matchId: string): boolean {
  const match = matches.find(m => m.id === matchId);
  if (!match || match.isBye) return false;
  const shape = shapeOf(matches);
  return !blockedBy(shape, matches, games, winnerTarget(shape, match))
    && !blockedBy(shape, matches, games, loserTarget(shape, match));
}

export function resetMatchUpdates(matches: BracketMatch[], _bracket: Bracket, matchId: string): RowUpdate[] {
  const match = matches.find(m => m.id === matchId);
  if (!match) throw new Error('match not found');
  const shape = shapeOf(matches);
  const updates: RowUpdate[] = [{ kind: 'match-winner', matchId, winnerEntryId: '' }];
  const clear = (t: Target | 'champion' | null) => {
    if (!t) return;
    if (t === 'champion') {
      updates.push({ kind: 'champion', entryId: null });
      return;
    }
    const target = findMatch(matches, t);
    if (!target) return;
    updates.push({ kind: 'match-slot', matchId: target.id, side: t.side, entryId: null });
    if (target.isBye && target.winnerEntryId) {
      updates.push({ kind: 'match-winner', matchId: target.id, winnerEntryId: '' });
      clear(winnerTarget(shape, target));
    }
  };
  clear(winnerTarget(shape, match));
  clear(loserTarget(shape, match));
  return updates;
}

export function currentRoundName(bracket: Bracket, matches: BracketMatch[], _games: BracketGame[]): string {
  const shape = { ...shapeOf(matches), size: bracket.size };
  const open = [...matches].sort(byPlayOrder).find(m => !m.isBye && !m.winnerEntryId);
  return open ? stageRoundName(shape, open.stage, open.round) : 'Complete';
}

/**
 * Repairs a half-applied advancement (the writes are separate, non-transactional
 * updates), and seats the decks of a newly added losers bracket. Every emitted
 * update is a value-set write, so repeating one is safe. Works on a copy in
 * play order, so a repair that seats a deck in a bye passes it on in one call.
 */
export function reconcileUpdates(bracket: Bracket, matches: BracketMatch[], games: BracketGame[]): RowUpdate[] {
  const shape = shapeOf(matches);
  const copy = matches.map(m => ({ ...m }));
  let champion = bracket.championEntryId;
  const updates: RowUpdate[] = [];

  const ensure = (t: Target | 'champion' | null, entryId: string | null) => {
    if (!t || !entryId) return;
    if (t === 'champion') {
      if (champion !== entryId) {
        updates.push({ kind: 'champion', entryId });
        champion = entryId;
      }
      return;
    }
    const target = findMatch(copy, t);
    if (!target) return;
    const held = t.side === 'a' ? target.entryAId : target.entryBId;
    if (held === entryId) return;
    updates.push({ kind: 'match-slot', matchId: target.id, side: t.side, entryId });
    if (t.side === 'a') target.entryAId = entryId;
    else target.entryBId = entryId;
  };

  for (const match of [...copy].sort(byPlayOrder)) {
    let winner = match.winnerEntryId;
    if (!winner) {
      if (match.isBye) {
        winner = match.entryAId ?? match.entryBId;
      } else {
        const series = seriesState(games, match, bracket.bestOf);
        if (series.decided) winner = series.winner === 'a' ? match.entryAId : match.entryBId;
      }
      if (winner) {
        updates.push({ kind: 'match-winner', matchId: match.id, winnerEntryId: winner });
        match.winnerEntryId = winner;
      }
    }
    if (!winner) continue;
    ensure(winnerTarget(shape, match), winner);
    if (!match.isBye) ensure(loserTarget(shape, match), winner === match.entryAId ? match.entryBId : match.entryAId);
  }
  return updates;
}

/**
 * A bracket can be rebuilt (decks, format, series) until its first result is
 * recorded. Started-but-unfinished games don't lock it; the rebuild drops them.
 */
export function canEditBracket(games: BracketGame[]): boolean {
  return !games.some(g => g.winnerEntryId);
}

/** A losers bracket can be added to a running single-elimination bracket of three or more decks. */
export function canAddLosersBracket(bracket: Bracket, entryCount: number, matches: BracketMatch[]): boolean {
  return bracket.status === 'active' && entryCount >= MIN_LOSERS_BRACKET_DECKS && !hasLosersBracket(matches);
}
