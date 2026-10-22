import type { SupabaseClient } from '@supabase/supabase-js';
import type { BracketEntry } from '@/lib/bracket/types';

export interface MatchupDeckRow {
  card_name: string;
  card_set: string;
  card_img_file: string;
  quantity: number;
  zone: 'main' | 'reserve';
}

export type MatchupDeck =
  | {
      status: 'ok';
      id: string;
      name: string;
      format: string | null;
      paragon: string | null;
      ownerName: string | null;
      cards: MatchupDeckRow[];
    }
  | { status: 'deleted' }
  | { status: 'private' };

type DeckRow = { id: string; name: string; format: string | null; paragon: string | null; user_id: string };

const PAGE = 1000;

/**
 * The two decks of a matchup, read with the viewer's own client so RLS
 * decides what they may see: a deck that comes back missing is `private`
 * (or `deleted` when the entry no longer points at a deck). No service-role
 * read here — a viewer learns only what the bracket's snapshot already says.
 */
export async function loadMatchupDecks(supabase: SupabaseClient, entries: BracketEntry[]): Promise<MatchupDeck[]> {
  const ids = Array.from(new Set(entries.flatMap(e => (e.deckId ? [e.deckId] : []))));
  const decks = new Map<string, DeckRow>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from('decks').select('id, name, format, paragon, user_id').in('id', ids);
    if (error) console.error('loadMatchupDecks: decks', error);
    for (const d of (data ?? []) as DeckRow[]) decks.set(d.id, d);
  }

  const cardsByDeck = new Map<string, (MatchupDeckRow & { deck_id: string })[]>();
  const names = new Map<string, string>();
  const found = Array.from(decks.keys());
  if (found.length > 0) {
    const owners = Array.from(new Set(Array.from(decks.values()).map(d => d.user_id)));
    const [cards, profiles] = await Promise.all([
      loadCards(supabase, found),
      supabase.from('profiles').select('id, username').in('id', owners),
    ]);
    for (const row of cards) {
      const list = cardsByDeck.get(row.deck_id);
      if (list) list.push(row);
      else cardsByDeck.set(row.deck_id, [row]);
    }
    for (const p of (profiles.data ?? []) as { id: string; username: string | null }[]) {
      if (p.username) names.set(p.id, p.username);
    }
  }

  return entries.map((entry): MatchupDeck => {
    if (!entry.deckId) return { status: 'deleted' };
    const deck = decks.get(entry.deckId);
    if (!deck) return { status: 'private' };
    return {
      status: 'ok',
      id: deck.id,
      name: deck.name,
      format: deck.format,
      paragon: deck.paragon,
      ownerName: names.get(deck.user_id) ?? null,
      cards: (cardsByDeck.get(deck.id) ?? []).map(({ deck_id: _omit, ...card }) => card),
    };
  });
}

// Pages past PostgREST's 1000-row default; a cube-sized deck has more rows than that.
async function loadCards(supabase: SupabaseClient, deckIds: string[]): Promise<(MatchupDeckRow & { deck_id: string })[]> {
  const rows: (MatchupDeckRow & { deck_id: string })[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('deck_cards')
      .select('deck_id, card_name, card_set, card_img_file, quantity, zone')
      .in('deck_id', deckIds)
      .in('zone', ['main', 'reserve'])
      .order('card_name')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('loadMatchupDecks: deck_cards', error); break; }
    const batch = (data ?? []) as (MatchupDeckRow & { deck_id: string })[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}
