import type { BestOf, BracketFormat } from '@/lib/bracket/types';

/** The sessionStorage prefix the play client reads its lobby params from. */
export const SESSION_KEY_PREFIX = 'stdb_game_params_';

/** sessionStorage key the result overlay's "Next match" sets so the bracket page plays the write-in. */
export const DECIDED_KEY = 'bracket_decided_match';

export interface BracketGameParams {
  gameId: string;
  bracketId: string;
  matchId: string;
  gameNumber: number;
  bestOf: BestOf;
  mode: 'solo' | 'online';
  entryAId: string;
  entryBId: string;
  deckAName: string;
  deckBName: string;
  returnTo: string;
}

function write(code: string, params: Record<string, unknown>) {
  sessionStorage.setItem(SESSION_KEY_PREFIX + code, JSON.stringify(params));
}

export function writeSoloGameParams(code: string, p: {
  deckAId: string; deckBId: string; displayName: string; supabaseUserId: string;
  format: string; firstSeat: 0 | 1; bracket: BracketGameParams;
}): void {
  write(code, {
    role: 'solo',
    deckId: p.deckAId,
    soloDeckBId: p.deckBId,
    displayName: p.displayName,
    supabaseUserId: p.supabaseUserId,
    format: p.format,
    firstSeat: p.firstSeat,
    bracket: p.bracket,
  });
}

export function writeHostGameParams(code: string, p: {
  deckAId: string; deckAName: string; displayName: string; supabaseUserId: string;
  format: string; bracket: BracketGameParams;
}): void {
  write(code, {
    role: 'create',
    deckId: p.deckAId,
    deckName: p.deckAName,
    displayName: p.displayName,
    supabaseUserId: p.supabaseUserId,
    format: p.format,
    isPublic: false,
    lobbyMessage: '',
    bracket: p.bracket,
  });
}

export function writeJoinGameParams(code: string, p: {
  deckBId: string; deckBName: string; displayName: string; supabaseUserId: string;
  format: string; bracket: BracketGameParams;
}): void {
  write(code, {
    role: 'join',
    deckId: p.deckBId,
    deckName: p.deckBName,
    displayName: p.displayName,
    supabaseUserId: p.supabaseUserId,
    format: p.format,
    bracket: p.bracket,
  });
}

const STDB_FORMAT: Record<BracketFormat, string> = { T1: 'Type 1', T2: 'Type 2', Paragon: 'Paragon' };

/** The play table's format string for a bracket's format family. */
export function stdbFormatFor(family: BracketFormat): string {
  return STDB_FORMAT[family];
}
