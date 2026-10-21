import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftDeck } from './draft';

/**
 * Loads decks for the setup screen in the given order: the viewer's own and
 * public decks only. Server pages use it for `?decks=` prefill and for editing
 * an existing bracket; a deck that is gone or private to someone else is
 * dropped and counted as missing.
 */
export async function loadDraftDecks(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<{ decks: DraftDeck[]; missing: number }> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 16);
  if (unique.length === 0) return { decks: [], missing: 0 };
  const { data } = await supabase
    .from('decks')
    .select('id, name, format, preview_card_1, preview_card_2, paragon, user_id, is_public')
    .in('id', unique);
  const usable = new Map(
    (data ?? [])
      .filter(d => d.user_id === userId || d.is_public)
      .map(d => [d.id as string, d]),
  );
  const decks = unique.flatMap(id => {
    const d = usable.get(id);
    return d
      ? [{ id: d.id, name: d.name, format: d.format, preview_card_1: d.preview_card_1, preview_card_2: d.preview_card_2, paragon: d.paragon }]
      : [];
  });
  return { decks, missing: unique.length - decks.length };
}
