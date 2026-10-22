import type {
  BestOf,
  Bracket,
  BracketEntry,
  BracketFormat,
  BracketGame,
  BracketMatch,
  BracketSize,
  GameMode,
} from '@/lib/bracket/types';

export interface DeckBracketRow {
  id: string;
  owner_id: string;
  name: string;
  format: BracketFormat;
  size: BracketSize;
  best_of: BestOf;
  status: 'active' | 'complete';
  champion_entry_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface DeckBracketEntryRow {
  id: string;
  bracket_id: string;
  seed: number;
  deck_id: string | null;
  deck_name: string;
  deck_format: string;
  preview_card_1: string | null;
  preview_card_2: string | null;
  paragon: string | null;
  key_cards: string[] | null;
}

export interface DeckBracketMatchRow {
  id: string;
  bracket_id: string;
  round: number;
  position: number;
  entry_a_id: string | null;
  entry_b_id: string | null;
  winner_entry_id: string | null;
  is_bye: boolean;
}

export interface DeckBracketGameRow {
  id: string;
  match_id: string;
  game_number: number;
  mode: GameMode;
  code: string | null;
  first_entry_id: string | null;
  winner_entry_id: string | null;
  souls_a: number | null;
  souls_b: number | null;
  started_at: string;
  finished_at: string | null;
}

export type BracketPageData = {
  bracket: Bracket;
  entries: BracketEntry[];
  matches: BracketMatch[];
  games: BracketGame[];
  ownerId: string;
  createdAt: string;
};

export const toBracket = (r: DeckBracketRow): Bracket => ({
  id: r.id,
  name: r.name,
  format: r.format,
  size: r.size,
  bestOf: r.best_of,
  status: r.status,
  championEntryId: r.champion_entry_id,
});

export const toEntry = (r: DeckBracketEntryRow): BracketEntry => ({
  id: r.id,
  seed: r.seed,
  deckId: r.deck_id,
  deckName: r.deck_name,
  deckFormat: r.deck_format,
  previewCard1: r.preview_card_1,
  previewCard2: r.preview_card_2,
  paragon: r.paragon,
  keyCards: r.key_cards ?? [],
});

export const toMatch = (r: DeckBracketMatchRow): BracketMatch => ({
  id: r.id,
  round: r.round,
  position: r.position,
  entryAId: r.entry_a_id,
  entryBId: r.entry_b_id,
  winnerEntryId: r.winner_entry_id,
  isBye: r.is_bye,
});

export const toGame = (r: DeckBracketGameRow): BracketGame => ({
  id: r.id,
  matchId: r.match_id,
  gameNumber: r.game_number,
  mode: r.mode,
  code: r.code,
  firstEntryId: r.first_entry_id,
  winnerEntryId: r.winner_entry_id,
  soulsA: r.souls_a,
  soulsB: r.souls_b,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});
