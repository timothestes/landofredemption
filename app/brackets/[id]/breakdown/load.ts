import { createAdminClient } from '@/utils/supabase/admin';
import { buildBreakdown, type BreakdownDeckInput, type TournamentBreakdown } from '@/lib/tournament/breakdown';
import type { BracketEntry } from '@/lib/bracket/types';

export interface DeckListsData {
  /** Null when fewer than two lists are visible to this viewer, or the read failed. */
  breakdown: TournamentBreakdown | null;
  unavailable: boolean;
  /** Entries whose list this viewer may open, in bracket order. */
  visibleEntryIds: string[];
  /** Decks hidden from this viewer because they are private. */
  privateNames: string[];
  /** Decks that no longer exist. */
  deletedNames: string[];
  /** Entry ids whose deck was saved after the bracket was created. */
  editedEntryIds: string[];
}

type DeckRow = { id: string; user_id: string; is_public: boolean; updated_at: string };

const empty = (over: Partial<DeckListsData> = {}): DeckListsData => ({
  breakdown: null, unavailable: false, visibleEntryIds: [], privateNames: [], deletedNames: [], editedEntryIds: [], ...over,
});

/**
 * The bracket's current decklists, aggregated on the server.
 *
 * Lists are live, not snapshotted: a deck edited after the final shows its
 * list as it is today. The visibility rule matches the seat-deck read in
 * actions.ts — `entries.deck_id` is owner-writable, so the service-role read
 * trusts the deck row, not the entry: the owner sees their own decks and any
 * public one; everyone else sees public decks only.
 */
export async function loadDeckLists(args: {
  entries: BracketEntry[];
  ownerId: string;
  isOwner: boolean;
  createdAt: string;
  /** Finish rank for a decided deck, null while it is still in. */
  placeOf: (entryId: string) => number | null;
}): Promise<DeckListsData> {
  const { entries, ownerId, isOwner, createdAt, placeOf } = args;
  const deletedNames = entries.filter(e => !e.deckId).map(e => e.deckName);
  const withDeck = entries.filter((e): e is BracketEntry & { deckId: string } => !!e.deckId);
  if (withDeck.length === 0) return empty({ deletedNames });

  let admin;
  try { admin = createAdminClient(); } catch { return empty({ unavailable: true, deletedNames }); }

  const { data: deckRows, error } = await admin
    .from('decks')
    .select('id, user_id, is_public, updated_at')
    .in('id', withDeck.map(e => e.deckId));
  if (error) return empty({ unavailable: true, deletedNames });
  const rowsById = new Map<string, DeckRow>(((deckRows ?? []) as DeckRow[]).map(r => [r.id, r]));

  const visible: (BracketEntry & { deckId: string })[] = [];
  const privateNames: string[] = [];
  for (const entry of withDeck) {
    const row = rowsById.get(entry.deckId);
    if (!row) { deletedNames.push(entry.deckName); continue; }
    if (row.is_public || (isOwner && row.user_id === ownerId)) visible.push(entry);
    else privateNames.push(entry.deckName);
  }

  const visibleEntryIds = visible.map(e => e.id);
  const created = new Date(createdAt).getTime();
  const editedEntryIds = visible
    .filter(e => new Date(rowsById.get(e.deckId)!.updated_at).getTime() > created)
    .map(e => e.id);

  if (visible.length < 2) return empty({ visibleEntryIds, privateNames, deletedNames, editedEntryIds });

  // One query per deck keeps each read under PostgREST's 1000-row default.
  const cardReads = await Promise.all(visible.map(e =>
    admin
      .from('deck_cards')
      .select('card_name, card_set, card_img_file, quantity, zone')
      .eq('deck_id', e.deckId)
      .in('zone', ['main', 'reserve']),
  ));
  if (cardReads.some(r => r.error)) {
    return empty({ unavailable: true, visibleEntryIds, privateNames, deletedNames, editedEntryIds });
  }

  const inputs: BreakdownDeckInput[] = visible.map((entry, i) => ({
    deckId: entry.deckId,
    participantId: entry.id,
    playerName: entry.deckName,
    place: placeOf(entry.id),
    cards: (cardReads[i].data ?? []).map(c => ({
      name: c.card_name as string,
      set: (c.card_set as string | null) ?? null,
      imgFile: (c.card_img_file as string | null) ?? null,
      quantity: c.quantity as number,
      zone: c.zone as string,
    })),
  }));

  return { breakdown: buildBreakdown(inputs), unavailable: false, visibleEntryIds, privateNames, deletedNames, editedEntryIds };
}
