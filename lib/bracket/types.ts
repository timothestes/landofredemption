export type BracketFormat = 'T1' | 'T2' | 'Paragon';
export type BestOf = 1 | 3 | 5;
export type BracketSize = 2 | 4 | 8 | 16;

export interface BracketEntry {
  id: string;
  seed: number;
  deckId: string | null;
  deckName: string;
  deckFormat: string;
  previewCard1: string | null;
  previewCard2: string | null;
  paragon: string | null;
}

export interface BracketMatch {
  id: string;
  round: number;
  position: number;
  entryAId: string | null;
  entryBId: string | null;
  winnerEntryId: string | null;
  isBye: boolean;
}

export type GameMode = 'solo' | 'online' | 'manual';

export interface BracketGame {
  id: string;
  matchId: string;
  gameNumber: number;
  mode: GameMode;
  code: string | null;
  firstEntryId: string | null;
  winnerEntryId: string | null;
  soulsA: number | null;
  soulsB: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Bracket {
  id: string;
  name: string;
  format: BracketFormat;
  size: BracketSize;
  bestOf: BestOf;
  status: 'active' | 'complete';
  championEntryId: string | null;
}

export type MatchState = 'bye' | 'waiting' | 'ready' | 'live' | 'done';

export interface SeriesState {
  winsA: number;
  winsB: number;
  needed: number;
  decided: boolean;
  winner: 'a' | 'b' | null;
  nextGameNumber: number;
  inProgress: BracketGame | null;
}

export type Slot = { position: number; side: 'a' | 'b' };

/** A `match-winner` update with `winnerEntryId: ''` means "clear". */
export type RowUpdate =
  | { kind: 'game'; gameId: string; winnerEntryId: string }
  | { kind: 'match-winner'; matchId: string; winnerEntryId: string }
  | { kind: 'match-slot'; matchId: string; side: 'a' | 'b'; entryId: string | null }
  | { kind: 'champion'; entryId: string | null };
