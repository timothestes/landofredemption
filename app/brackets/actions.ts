'use server';

import { createClient } from '@/utils/supabase/server';
import { getFormatDef } from '@/lib/formats';
import {
  applyGameResult, buildBracket, canPlayMatch, currentRoundName, firstEntryForGame,
  matchState, reconcileUpdates, resetMatchAllowed, resetMatchUpdates, roundNames, seriesState, sizeFor,
} from '@/lib/bracket';
import type {
  BestOf, Bracket, BracketEntry, BracketFormat, BracketGame, BracketMatch, RowUpdate, SeriesState,
} from '@/lib/bracket/types';
import {
  toBracket, toEntry, toGame, toMatch,
  type BracketPageData, type DeckBracketEntryRow, type DeckBracketGameRow,
  type DeckBracketMatchRow, type DeckBracketRow,
} from './types';
import { generateGameCode } from './lib/gameCode';
import type { BracketGameParams } from './lib/gameParams';
import { createAdminClient } from '@/utils/supabase/admin';
import { deckToGameData } from '@/app/play/lib/deckToGameData';
import type { GameCardData } from '@/app/play/actions';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;
type MatchWithGames = DeckBracketMatchRow & { deck_bracket_games: DeckBracketGameRow[] | null };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const BEST_OF: BestOf[] = [1, 3, 5];
const FORMATS: BracketFormat[] = ['T1', 'T2', 'Paragon'];

// RLS lets anyone read a bracket (public select), so ownership is proven by
// comparing owner_id to the signed-in user explicitly.
async function requireBracketOwner(
  supabase: Supabase,
  bracketId: string,
): Promise<{ ok: true; userId: string; row: DeckBracketRow } | { ok: false; error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('Sign in to continue.');
  const { data, error } = await supabase
    .from('deck_brackets').select('*').eq('id', bracketId).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail('Bracket not found.');
  const row = data as DeckBracketRow;
  if (row.owner_id !== user.id) return fail('Only the bracket owner can do that.');
  return { ok: true, userId: user.id, row };
}

interface Loaded {
  bracket: Bracket;
  entries: BracketEntry[];
  matches: BracketMatch[];
  games: BracketGame[];
}

async function loadAll(supabase: Supabase, bracketId: string): Promise<ActionResult<Loaded & { row: DeckBracketRow }>> {
  const [b, e, m] = await Promise.all([
    supabase.from('deck_brackets').select('*').eq('id', bracketId).maybeSingle(),
    supabase.from('deck_bracket_entries').select('*').eq('bracket_id', bracketId).order('seed'),
    supabase
      .from('deck_bracket_matches')
      .select('*, deck_bracket_games(*)')
      .eq('bracket_id', bracketId)
      .order('round')
      .order('position')
      .order('game_number', { foreignTable: 'deck_bracket_games' }),
  ]);
  if (b.error) return fail(b.error.message);
  if (!b.data) return fail('Bracket not found.');
  if (e.error) return fail(e.error.message);
  if (m.error) return fail(m.error.message);
  const matchRows = (m.data ?? []) as MatchWithGames[];
  return {
    ok: true,
    data: {
      row: b.data as DeckBracketRow,
      bracket: toBracket(b.data as DeckBracketRow),
      entries: ((e.data ?? []) as DeckBracketEntryRow[]).map(toEntry),
      matches: matchRows.map(toMatch),
      games: matchRows.flatMap(r => (r.deck_bracket_games ?? []).map(toGame)),
    },
  };
}

export async function createBracketAction(input: {
  name: string; format: BracketFormat; bestOf: BestOf; deckIds: string[];
}): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('Sign in to create a bracket.');

  const name = (input.name ?? '').trim();
  if (!name) return fail('Give the bracket a name.');
  if (!FORMATS.includes(input.format)) return fail('Choose a format.');
  if (!BEST_OF.includes(input.bestOf)) return fail('Best-of must be 1, 3, or 5.');
  const deckIds = input.deckIds ?? [];
  if (new Set(deckIds).size !== deckIds.length) return fail('Each deck can only be entered once.');
  if (deckIds.length < 2 || deckIds.length > 16) return fail('Pick between 2 and 16 decks.');

  const { data: deckRows, error: deckErr } = await supabase
    .from('decks')
    .select('id, name, format, preview_card_1, preview_card_2, paragon, user_id, is_public')
    .in('id', deckIds);
  if (deckErr) return fail(deckErr.message);
  const usable = new Map(
    (deckRows ?? [])
      .filter(d => d.user_id === user.id || d.is_public)
      .map(d => [d.id as string, d]),
  );
  const decks = deckIds.map(id => usable.get(id));
  if (decks.some(d => !d)) return fail('One or more decks could not be found.');
  for (const d of decks) {
    if (getFormatDef(d!.format).family !== input.format) {
      return fail(`Every deck must be a ${input.format} deck.`);
    }
  }

  let size;
  try { size = sizeFor(deckIds.length); } catch (e) { return fail(message(e)); }

  const { data: bracketRow, error: bErr } = await supabase
    .from('deck_brackets')
    .insert({ owner_id: user.id, name, format: input.format, size, best_of: input.bestOf })
    .select('id')
    .single();
  if (bErr || !bracketRow) return fail(bErr?.message ?? 'Could not create the bracket.');
  const bracketId = bracketRow.id as string;

  const rollback = async (msg: string) => {
    await supabase.from('deck_brackets').delete().eq('id', bracketId);
    return fail(msg);
  };

  const { data: entryRows, error: eErr } = await supabase
    .from('deck_bracket_entries')
    .insert(decks.map((d, i) => ({
      bracket_id: bracketId,
      seed: i + 1,
      deck_id: d!.id,
      deck_name: d!.name,
      deck_format: d!.format,
      preview_card_1: d!.preview_card_1,
      preview_card_2: d!.preview_card_2,
      paragon: d!.paragon,
    })))
    .select('*');
  if (eErr || !entryRows) return rollback(eErr?.message ?? 'Could not add the decks.');

  let matches: BracketMatch[];
  try {
    matches = buildBracket((entryRows as DeckBracketEntryRow[]).map(toEntry), () => crypto.randomUUID());
  } catch (e) {
    return rollback(message(e));
  }

  const { error: mErr } = await supabase.from('deck_bracket_matches').insert(
    matches.map(m => ({
      id: m.id,
      bracket_id: bracketId,
      round: m.round,
      position: m.position,
      entry_a_id: m.entryAId,
      entry_b_id: m.entryBId,
      winner_entry_id: m.winnerEntryId,
      is_bye: m.isBye,
    })),
  );
  if (mErr) return rollback(mErr.message);

  return { ok: true, data: { id: bracketId } };
}

export async function listMyBracketsAction(): Promise<ActionResult<Array<{
  id: string; name: string; format: BracketFormat; entryCount: number; bestOf: BestOf;
  status: 'active' | 'complete'; currentRound: string; championName: string | null; createdAt: string;
}>>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('Sign in to see your brackets.');

  const { data, error } = await supabase
    .from('deck_brackets')
    .select('*, deck_bracket_entries!bracket_id(*), deck_bracket_matches(*, deck_bracket_games(*))')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return fail(error.message);

  type Row = DeckBracketRow & {
    deck_bracket_entries: DeckBracketEntryRow[] | null;
    deck_bracket_matches: MatchWithGames[] | null;
  };
  try {
    const list = ((data ?? []) as Row[]).map(r => {
      const entries = (r.deck_bracket_entries ?? []).map(toEntry);
      const matchRows = r.deck_bracket_matches ?? [];
      const matches = matchRows.map(toMatch);
      const games = matchRows.flatMap(m => (m.deck_bracket_games ?? []).map(toGame));
      const bracket = toBracket(r);
      return {
        id: r.id,
        name: r.name,
        format: r.format,
        entryCount: entries.length,
        bestOf: r.best_of,
        status: r.status,
        currentRound: currentRoundName(bracket, matches, games),
        championName: entries.find(e => e.id === r.champion_entry_id)?.deckName ?? null,
        createdAt: r.created_at,
      };
    });
    return { ok: true, data: list };
  } catch (e) {
    return fail(message(e));
  }
}

export async function loadBracketAction(id: string): Promise<ActionResult<BracketPageData & { isOwner: boolean }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const loaded = await loadAll(supabase, id);
  if (loaded.ok === false) return loaded;
  const { row, bracket, entries, matches, games } = loaded.data;
  return {
    ok: true,
    data: {
      bracket, entries, matches, games,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      isOwner: !!user && user.id === row.owner_id,
    },
  };
}

export async function startBracketGameAction(matchId: string, mode: 'solo' | 'online'): Promise<ActionResult<{
  gameId: string; code: string; firstSeat: 0 | 1; gameNumber: number; bestOf: BestOf; bracketId: string;
  entryAId: string; entryBId: string; deckAId: string; deckBId: string;
  deckAName: string; deckBName: string; format: BracketFormat;
}>> {
  if (mode !== 'solo' && mode !== 'online') return fail('Unknown game mode.');
  const supabase = await createClient();
  const { data: matchRow, error: mErr } = await supabase
    .from('deck_bracket_matches').select('bracket_id').eq('id', matchId).maybeSingle();
  if (mErr) return fail(mErr.message);
  if (!matchRow) return fail('Match not found.');
  const bracketId = matchRow.bracket_id as string;

  const owner = await requireBracketOwner(supabase, bracketId);
  if (owner.ok === false) return owner;
  const loaded = await loadAll(supabase, bracketId);
  if (loaded.ok === false) return loaded;
  const { bracket, entries, matches, games } = loaded.data;

  const match = matches.find(m => m.id === matchId);
  if (!match) return fail('Match not found.');
  const entriesById = new Map(entries.map(e => [e.id, e]));
  const state = matchState(match, games, bracket.bestOf);
  if (state !== 'ready') {
    return fail(state === 'live' ? 'A game is already in progress for this match.' : 'This match is not ready to play.');
  }
  if (!canPlayMatch(match, entriesById, state)) {
    return fail('A deck in this match has been deleted, so the game cannot be played. Record the result instead.');
  }

  try {
    const entryA = entriesById.get(match.entryAId!)!;
    const entryB = entriesById.get(match.entryBId!)!;
    const series = seriesState(games, match, bracket.bestOf);
    const firstEntryId = firstEntryForGame(games, match, Math.random() < 0.5 ? 'a' : 'b');
    const code = generateGameCode();

    const { data: game, error: gErr } = await supabase
      .from('deck_bracket_games')
      .insert({
        match_id: matchId,
        game_number: series.nextGameNumber,
        mode,
        code,
        first_entry_id: firstEntryId,
      })
      .select('id')
      .single();
    if (gErr || !game) return fail(gErr?.message ?? 'Could not start the game.');

    return {
      ok: true,
      data: {
        gameId: game.id as string,
        code,
        firstSeat: firstEntryId === entryA.id ? 0 : 1,
        gameNumber: series.nextGameNumber,
        bestOf: bracket.bestOf,
        bracketId,
        entryAId: entryA.id,
        entryBId: entryB.id,
        deckAId: entryA.deckId!,
        deckBId: entryB.deckId!,
        deckAName: entryA.deckName,
        deckBName: entryB.deckName,
        format: bracket.format,
      },
    };
  } catch (e) {
    return fail(message(e));
  }
}

type RecordData = {
  series: SeriesState; matchId: string; decided: boolean;
  nextReadyMatch: { id: string; deckAName: string; deckBName: string } | null;
  nextRoundName: string | null; champion: boolean;
};

/** Summarise a match's state from freshly loaded rows. */
function summarise(loaded: Loaded, matchId: string): RecordData {
  const { bracket, entries, matches, games } = loaded;
  const match = matches.find(m => m.id === matchId)!;
  const series = seriesState(games, match, bracket.bestOf);
  const decided = !!match.winnerEntryId;
  const champion = decided && bracket.championEntryId !== null && match.round === roundNames(bracket.size).length;
  const nameOf = (id: string | null) => entries.find(e => e.id === id)?.deckName ?? '';
  const next = [...matches]
    .sort((a, b) => a.round - b.round || a.position - b.position)
    .find(m => m.id !== matchId && matchState(m, games, bracket.bestOf) === 'ready');
  return {
    series,
    matchId,
    decided,
    nextReadyMatch: next ? { id: next.id, deckAName: nameOf(next.entryAId), deckBName: nameOf(next.entryBId) } : null,
    nextRoundName: decided && !champion ? roundNames(bracket.size)[match.round] ?? null : null,
    champion,
  };
}

const ALREADY_RECORDED = 'already-recorded';

async function persistUpdates(
  supabase: Supabase, bracketId: string, updates: RowUpdate[], souls?: { a?: number; b?: number },
): Promise<string | null> {
  for (const u of updates) {
    let error: { message: string } | null = null;
    if (u.kind === 'game') {
      // Atomic claim: only an undecided game can take a winner, so a racing or
      // repeated call never overwrites an existing result.
      const res = await supabase.from('deck_bracket_games').update({
        winner_entry_id: u.winnerEntryId,
        souls_a: souls?.a ?? null,
        souls_b: souls?.b ?? null,
        finished_at: new Date().toISOString(),
      }).eq('id', u.gameId).is('winner_entry_id', null).select('id');
      error = res.error;
      if (!error && (res.data ?? []).length === 0) return ALREADY_RECORDED;
    } else if (u.kind === 'match-winner') {
      ({ error } = await supabase.from('deck_bracket_matches')
        .update({ winner_entry_id: u.winnerEntryId === '' ? null : u.winnerEntryId })
        .eq('id', u.matchId));
    } else if (u.kind === 'match-slot') {
      ({ error } = await supabase.from('deck_bracket_matches')
        .update(u.side === 'a' ? { entry_a_id: u.entryId } : { entry_b_id: u.entryId })
        .eq('id', u.matchId));
    } else {
      ({ error } = await supabase.from('deck_brackets').update(
        u.entryId
          ? { champion_entry_id: u.entryId, status: 'complete', completed_at: new Date().toISOString() }
          : { champion_entry_id: null, status: 'active', completed_at: null },
      ).eq('id', bracketId));
    }
    if (error) return error.message;
  }
  return null;
}

/** Heals any half-applied advancement, then returns the reloaded state. */
async function reconcileAndLoad(supabase: Supabase, bracketId: string): Promise<ActionResult<Loaded>> {
  let loaded = await loadAll(supabase, bracketId);
  if (loaded.ok === false) return loaded;
  let repairs: RowUpdate[];
  try {
    repairs = reconcileUpdates(loaded.data.bracket, loaded.data.matches, loaded.data.games);
  } catch (e) {
    return fail(message(e));
  }
  if (repairs.length === 0) return loaded;
  const err = await persistUpdates(supabase, bracketId, repairs);
  if (err) return fail(err);
  loaded = await loadAll(supabase, bracketId);
  return loaded;
}

async function applyAndPersist(
  supabase: Supabase, bracketId: string, gameId: string, winnerEntryId: string,
  souls?: { a?: number; b?: number },
): Promise<ActionResult<RecordData>> {
  const loaded = await loadAll(supabase, bracketId);
  if (loaded.ok === false) return loaded;
  const game = loaded.data.games.find(g => g.id === gameId);
  if (!game) return fail('Game not found.');

  // Idempotent: a result already recorded changes nothing, but any half-applied
  // advancement from an earlier failed call is repaired first.
  if (!game.winnerEntryId) {
    let updates: RowUpdate[];
    try {
      updates = applyGameResult({
        bracket: loaded.data.bracket, matches: loaded.data.matches, games: loaded.data.games,
        gameId, winnerEntryId,
      });
    } catch (e) {
      return fail(message(e));
    }
    const err = await persistUpdates(supabase, bracketId, updates, souls);
    if (err && err !== ALREADY_RECORDED) return fail(err);
  }

  const after = await reconcileAndLoad(supabase, bracketId);
  if (after.ok === false) return after;
  return { ok: true, data: summarise(after.data, game.matchId) };
}

export async function recordBracketGameResultAction(input: {
  gameId: string; winnerEntryId: string; soulsA?: number; soulsB?: number;
}): Promise<ActionResult<RecordData>> {
  const supabase = await createClient();
  const { data: g, error } = await supabase
    .from('deck_bracket_games')
    .select('id, deck_bracket_matches(bracket_id)')
    .eq('id', input.gameId)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!g) return fail('Game not found.');
  const rel = g.deck_bracket_matches as unknown as { bracket_id: string } | { bracket_id: string }[] | null;
  const bracketId = Array.isArray(rel) ? rel[0]?.bracket_id : rel?.bracket_id;
  if (!bracketId) return fail('Game not found.');

  const owner = await requireBracketOwner(supabase, bracketId);
  if (owner.ok === false) return owner;
  return applyAndPersist(supabase, bracketId, input.gameId, input.winnerEntryId, { a: input.soulsA, b: input.soulsB });
}

/**
 * Records a result by hand. With `gameId` it settles that in-progress game of the
 * match (keeping its mode and code); without one it inserts a `manual` game.
 */
export async function recordManualResultAction(input: {
  matchId: string; winnerEntryId: string; soulsA?: number; soulsB?: number; gameId?: string;
}): Promise<ActionResult<{ matchId: string; gameId: string }>> {
  const supabase = await createClient();
  const { data: matchRow, error: mErr } = await supabase
    .from('deck_bracket_matches').select('bracket_id').eq('id', input.matchId).maybeSingle();
  if (mErr) return fail(mErr.message);
  if (!matchRow) return fail('Match not found.');
  const bracketId = matchRow.bracket_id as string;

  const owner = await requireBracketOwner(supabase, bracketId);
  if (owner.ok === false) return owner;
  const loaded = await loadAll(supabase, bracketId);
  if (loaded.ok === false) return loaded;
  const { bracket, matches, games } = loaded.data;
  const match = matches.find(m => m.id === input.matchId);
  if (!match) return fail('Match not found.');
  const souls = { a: input.soulsA, b: input.soulsB };

  if (input.gameId) {
    const live = games.find(g => g.id === input.gameId);
    if (!live || live.matchId !== input.matchId) return fail('Game not found.');
    if (live.winnerEntryId) return fail('That game already has a result.');
    const result = await applyAndPersist(supabase, bracketId, live.id, input.winnerEntryId, souls);
    if (result.ok === false) return result;
    return { ok: true, data: { matchId: input.matchId, gameId: live.id } };
  }

  const state = matchState(match, games, bracket.bestOf);
  if (state !== 'ready') {
    return fail(state === 'live' ? 'Finish or abandon the game in progress first.' : 'This match is not ready for a result.');
  }

  const series = seriesState(games, match, bracket.bestOf);
  const { data: game, error: gErr } = await supabase
    .from('deck_bracket_games')
    .insert({ match_id: input.matchId, game_number: series.nextGameNumber, mode: 'manual' })
    .select('id')
    .single();
  if (gErr || !game) return fail(gErr?.message ?? 'Could not record the result.');
  const gameId = game.id as string;

  const result = await applyAndPersist(supabase, bracketId, gameId, input.winnerEntryId, souls);
  if (result.ok === false) {
    await supabase.from('deck_bracket_games').delete().eq('id', gameId).is('winner_entry_id', null);
    return result;
  }
  return { ok: true, data: { matchId: input.matchId, gameId } };
}

export async function abandonBracketGameAction(gameId: string): Promise<ActionResult<{ matchId: string }>> {
  const supabase = await createClient();
  const { data: g, error } = await supabase
    .from('deck_bracket_games')
    .select('id, match_id, winner_entry_id, deck_bracket_matches(bracket_id)')
    .eq('id', gameId)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!g) return fail('Game not found.');
  const rel = g.deck_bracket_matches as unknown as { bracket_id: string } | { bracket_id: string }[] | null;
  const bracketId = Array.isArray(rel) ? rel[0]?.bracket_id : rel?.bracket_id;
  if (!bracketId) return fail('Game not found.');

  const owner = await requireBracketOwner(supabase, bracketId);
  if (owner.ok === false) return owner;
  if (g.winner_entry_id) return fail('That game already has a result.');

  const { error: dErr } = await supabase
    .from('deck_bracket_games').delete().eq('id', gameId).is('winner_entry_id', null);
  if (dErr) return fail(dErr.message);
  return { ok: true, data: { matchId: g.match_id as string } };
}

export async function resetMatchAction(matchId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { data: matchRow, error: mErr } = await supabase
    .from('deck_bracket_matches').select('bracket_id').eq('id', matchId).maybeSingle();
  if (mErr) return fail(mErr.message);
  if (!matchRow) return fail('Match not found.');
  const bracketId = matchRow.bracket_id as string;

  const owner = await requireBracketOwner(supabase, bracketId);
  if (owner.ok === false) return owner;
  const loaded = await loadAll(supabase, bracketId);
  if (loaded.ok === false) return loaded;
  const { bracket, matches, games } = loaded.data;

  let updates: RowUpdate[];
  try {
    if (!resetMatchAllowed(matches, games, matchId)) {
      return fail('Reset is not possible while the next match has results.');
    }
    updates = resetMatchUpdates(matches, bracket, matchId);
  } catch (e) {
    return fail(message(e));
  }

  const { error: dErr } = await supabase.from('deck_bracket_games').delete().eq('match_id', matchId);
  if (dErr) return fail(dErr.message);
  // The champion update also flips status back to 'active' and clears completed_at.
  const err = await persistUpdates(supabase, bracketId, updates);
  if (err) return fail(err);
  return { ok: true, data: null };
}

export async function deleteBracketAction(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const owner = await requireBracketOwner(supabase, id);
  if (owner.ok === false) return owner;
  const { error } = await supabase.from('deck_brackets').delete().eq('id', id);
  if (error) return fail(error.message);
  return { ok: true, data: null };
}

/**
 * Loads the bracket's B-side deck for the friend invited to an online bracket
 * game. The deck may be private to the bracket owner, so after every gate is
 * checked with the caller's own client, the deck and its cards are read with
 * the service-role client (that read only).
 */
export async function loadBracketSeatDeckAction(gameId: string): Promise<ActionResult<{
  deck: { id: string; name: string; format: string; paragon: string | null };
  deckData: GameCardData[];
  code: string;
  bracket: BracketGameParams;
}>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('Sign in to join this game.');

  const { data: gRow, error: gErr } = await supabase
    .from('deck_bracket_games').select('*').eq('id', gameId).maybeSingle();
  if (gErr) return fail(gErr.message);
  if (!gRow) return fail('This game was cancelled.');
  const game = gRow as DeckBracketGameRow;
  if (game.mode !== 'online' || !game.code) return fail('This game is not open to join.');
  if (game.winner_entry_id) return fail('This game is already finished.');

  const { data: mRow, error: mErr } = await supabase
    .from('deck_bracket_matches').select('*').eq('id', game.match_id).maybeSingle();
  if (mErr) return fail(mErr.message);
  if (!mRow) return fail('Match not found.');
  const match = mRow as DeckBracketMatchRow;

  const { data: bRow, error: bErr } = await supabase
    .from('deck_brackets').select('*').eq('id', match.bracket_id).maybeSingle();
  if (bErr) return fail(bErr.message);
  if (!bRow) return fail('Bracket not found.');
  const bracketRow = bRow as DeckBracketRow;
  if (bracketRow.owner_id === user.id) return fail('This is your own bracket; open it to play.');

  if (!match.entry_a_id || !match.entry_b_id) return fail('This match is not ready to play.');
  const { data: eRows, error: eErr } = await supabase
    .from('deck_bracket_entries').select('*').in('id', [match.entry_a_id, match.entry_b_id]);
  if (eErr) return fail(eErr.message);
  const entries = (eRows ?? []) as DeckBracketEntryRow[];
  const entryA = entries.find(e => e.id === match.entry_a_id);
  const entryB = entries.find(e => e.id === match.entry_b_id);
  if (!entryA || !entryB) return fail('This match is not ready to play.');
  if (!entryB.deck_id) return fail('This deck has been deleted, so the game cannot be played.');

  let admin;
  try { admin = createAdminClient(); } catch (e) { return fail(message(e)); }
  const [d, c] = await Promise.all([
    admin.from('decks').select('id, name, format, paragon').eq('id', entryB.deck_id).maybeSingle(),
    // Maybeboard rows are excluded, matching loadDeckForGame.
    admin.from('deck_cards')
      .select('card_name, card_set, card_img_file, quantity, zone')
      .eq('deck_id', entryB.deck_id)
      .in('zone', ['main', 'reserve']),
  ]);
  if (d.error) return fail(d.error.message);
  if (!d.data) return fail('This deck has been deleted, so the game cannot be played.');
  if (c.error) return fail('Failed to load deck cards.');

  return {
    ok: true,
    data: {
      deck: {
        id: d.data.id as string,
        name: d.data.name as string,
        format: (d.data.format as string | null) ?? entryB.deck_format,
        paragon: (d.data.paragon as string | null) ?? null,
      },
      deckData: deckToGameData(c.data ?? []),
      code: game.code,
      bracket: {
        gameId: game.id,
        bracketId: bracketRow.id,
        matchId: match.id,
        gameNumber: game.game_number,
        bestOf: bracketRow.best_of,
        mode: 'online',
        entryAId: entryA.id,
        entryBId: entryB.id,
        deckAName: entryA.deck_name,
        deckBName: entryB.deck_name,
        returnTo: '/brackets/' + bracketRow.id,
      },
    },
  };
}
