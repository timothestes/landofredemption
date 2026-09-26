'use server';

import { createClient } from '@/utils/supabase/server';
import { findCard } from '@/lib/cards/lookup';
import { requireForge } from '@/app/forge/lib/auth';
import { stdbHttpBase } from '@/app/forge/lib/stdbHttp';
import { deckFormatFilterFor } from '@/lib/api/cache';
import type { DeckOption } from './components/DeckPickerCard';
import { STARTER_DECKS, hasStarterDecks, orderStarterDecks, type StarterDeck } from '@/app/config/starterDecks';

export interface GameCardData {
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  cardType: string;
  brigade: string;
  strength: string;
  toughness: string;
  alignment: string;
  identifier: string;
  reference: string;
  specialAbility: string;
  isReserve: boolean;
}

export interface LoadDeckResult {
  deck: {
    id: string;
    name: string;
    format: string | null;
  };
  deckData: GameCardData[];
}

/**
 * Load a deck and its cards for use in a multiplayer game.
 * Cards with quantity > 1 are expanded into individual entries.
 */
export async function loadDeckForGame(deckId: string): Promise<LoadDeckResult> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('You must be logged in to load a deck.');
  }

  // Try loading as user's own deck first, then fall back to public deck
  const { data: ownDeck } = await supabase
    .from('decks')
    .select('id, name, format')
    .eq('id', deckId)
    .eq('user_id', user.id)
    .single();

  let deck = ownDeck;
  if (!deck) {
    const { data: publicDeck } = await supabase
      .from('decks')
      .select('id, name, format')
      .eq('id', deckId)
      .eq('is_public', true)
      .single();
    deck = publicDeck;
  }

  if (!deck) {
    throw new Error('Deck not found.');
  }

  // Maybeboard rows are excluded — game state only sees main + reserve.
  const { data: cards, error: cardsError } = await supabase
    .from('deck_cards')
    .select('card_name, card_set, card_img_file, quantity, zone')
    .eq('deck_id', deckId)
    .in('zone', ['main', 'reserve']);

  if (cardsError) {
    throw new Error('Failed to load deck cards.');
  }

  // Expand quantity > 1 rows into individual card entries
  const deckData: GameCardData[] = [];
  for (const card of cards || []) {
    const quantity = card.quantity || 1;
    const imgFile = (card.card_img_file || '').replace(/\.jpe?g$/i, '');
    const enriched = findCard(card.card_name || '', card.card_set || undefined, imgFile);

    for (let i = 0; i < quantity; i++) {
      deckData.push({
        cardName: card.card_name || '',
        cardSet: card.card_set || '',
        cardImgFile: card.card_img_file || '',
        cardType: enriched?.type || '',
        brigade: enriched?.brigade || '',
        strength: enriched?.strength || '',
        toughness: enriched?.toughness || '',
        alignment: enriched?.alignment || '',
        identifier: enriched?.identifier || '',
        reference: enriched?.reference || '',
        specialAbility: enriched?.specialAbility || '',
        isReserve: card.zone === 'reserve',
      });
    }
  }

  // Stamp last_played_at if this is the user's own deck
  if (ownDeck) {
    await supabase
      .from('decks')
      .update({ last_played_at: new Date().toISOString() })
      .eq('id', deckId);
  }

  return { deck, deckData };
}

export interface InviteGameInfo {
  /** The invite code's active game is a private Forge playtest game. */
  isForge: boolean;
  /** The viewer is a Forge member (only computed when isForge is true). */
  isForgeMember: boolean;
}

/**
 * Classify an invite code for the /play?join= lobby so it can hide the
 * Join/Spectate buttons on Forge playtest games (public join and non-member
 * spectate are both server-rejected — the buttons would only dead-end).
 * Forge-ness is read from the PUBLIC forge_game marker table via the STDB
 * HTTP SQL endpoint; membership via requireForge. Fails open to the normal
 * button UI — the reducers stay authoritative either way.
 */
export async function getInviteGameInfo(code: string): Promise<InviteGameInfo> {
  const notForge: InviteGameInfo = { isForge: false, isForgeMember: false };
  const clean = (code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(clean)) return notForge;

  const token = process.env.SPACETIMEDB_SERVER_TOKEN;
  const host = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST;
  const db = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || 'redemption-multiplayer';
  if (!token || !host) return notForge;

  const sql = async (query: string): Promise<any[][]> => {
    const res = await fetch(`${stdbHttpBase(host)}/v1/database/${db}/sql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: query,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`stdb sql ${res.status}`);
    const results = await res.json();
    return results?.[0]?.rows ?? [];
  };

  try {
    const games = await sql(`SELECT id, status FROM game WHERE code = '${clean}'`);
    if (games.length === 0) return notForge;
    // Prefer the active game; codes can be reused after a game finishes.
    const active = games.find((r) => r[1] !== 'finished') ?? games[games.length - 1];
    const marker = await sql(`SELECT game_id FROM forge_game WHERE game_id = ${active[0]}`);
    if (marker.length === 0) return notForge;
    return { isForge: true, isForgeMember: (await requireForge()) !== null };
  } catch (e) {
    console.error('[play] getInviteGameInfo failed', e);
    return notForge;
  }
}

/**
 * Search public community decks by name.
 * Returns up to 20 results ordered by view count.
 */
export async function searchCommunityDecks(query: string): Promise<{
  id: string;
  name: string;
  format: string | null;
  card_count: number | null;
  username: string | null;
}[]> {
  if (!query || query.length < 2) return [];

  const supabase = await createClient();

  const { data: decks, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, user_id')
    .eq('is_public', true)
    .ilike('name', `%${query}%`)
    .order('view_count', { ascending: false })
    .limit(20);

  if (error || !decks) return [];

  // Fetch usernames for the results
  const userIds = [...new Set(decks.map(d => d.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', userIds);

  const usernameMap = new Map(profiles?.map(p => [p.id, p.username]) ?? []);

  return decks.map(d => ({
    id: d.id,
    name: d.name,
    format: d.format,
    card_count: d.card_count,
    username: usernameMap.get(d.user_id) ?? null,
  }));
}

export interface LoadUserDecksPagedParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: 'all' | 'latest' | 'last_played' | 'name';
  format?: string;
}

export interface LoadUserDecksPagedResult {
  decks: DeckOption[];
  totalCount: number;
}

/**
 * Paginated + searchable loader for the deck picker "My Decks" tab.
 * Mirrors loadPublicDecksAction's shape for consistency.
 */
export async function loadUserDecksPaged(
  params: LoadUserDecksPagedParams = {},
): Promise<LoadUserDecksPagedResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { decks: [], totalCount: 0 };

  const { page = 1, pageSize = 12, search, sort = 'all', format } = params;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('decks')
    .select(
      'id, name, format, card_count, preview_card_1, preview_card_2, paragon, last_played_at',
      { count: 'exact' },
    )
    .eq('user_id', user.id);

  if (search && search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`);
  }

  if (format) {
    // Shared with lib/api/cache.ts's v1 API and the community filter in
    // app/decklist/actions.ts so every `decks.format` query site applies the
    // exact same PostgREST filter shape (normalizes legacy + canonical ids).
    const filter = deckFormatFilterFor(format);
    if (filter.kind === 'or') query = query.or(filter.clause);
    else if (filter.kind === 'in') query = query.in('format', filter.values);
    else query = query.eq('format', filter.value);
  }

  switch (sort) {
    case 'name':
      query = query.order('name', { ascending: true });
      break;
    case 'latest':
      query = query.order('updated_at', { ascending: false });
      break;
    case 'last_played':
      query = query
        .order('last_played_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false });
      break;
    case 'all':
    default:
      query = query.order('last_active_at', { ascending: false, nullsFirst: false });
      break;
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, count } = await query;
  return { decks: data ?? [], totalCount: count ?? 0 };
}

// ─── Starter decks ──────────────────────────────────────────────────

// Warn once per server process about configured ids that did not load, so a
// stale config surfaces in the logs without spamming every picker open.
let warnedMissingStarterDecks = false;

/**
 * The owner-curated starter decks (app/config/starterDecks.ts), loaded in config
 * order in the shape the picker's Community tab renders. Public-only: ids that
 * are missing or no longer public are skipped. Works signed out — the same RLS
 * path the community list and /goldfish/[deckId] already rely on.
 */
export async function loadStarterDecksAction(): Promise<StarterDeck[]> {
  if (!hasStarterDecks()) return [];
  const supabase = await createClient();
  const ids = STARTER_DECKS.map((d) => d.deckId);

  const { data: decks, error } = await supabase
    .from('decks')
    .select('id, name, format, card_count, preview_card_1, preview_card_2, paragon, user_id')
    .in('id', ids)
    .eq('visibility', 'public');
  if (error) {
    console.error('Error loading starter decks:', error);
    return [];
  }

  const userIds = [...new Set((decks ?? []).map((d) => d.user_id).filter(Boolean))];
  let usernameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    usernameMap = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  }

  const ordered = orderStarterDecks(
    (decks ?? []).map(({ user_id, ...d }) => ({
      ...d,
      username: usernameMap.get(user_id) ?? null,
    })),
  );

  if (ordered.length < ids.length && !warnedMissingStarterDecks) {
    warnedMissingStarterDecks = true;
    const loaded = new Set(ordered.map((d) => d.id));
    console.warn(
      'Starter decks missing or not public (check app/config/starterDecks.ts):',
      ids.filter((id) => !loaded.has(id)),
    );
  }

  return ordered;
}
