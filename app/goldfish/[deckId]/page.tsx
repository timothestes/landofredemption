import { notFound } from 'next/navigation';
import { loadPublicDeckAction } from '../../decklist/actions';
import { findCard } from '@/lib/cards/lookup';
import { createClient } from '@/utils/supabase/server';
import { loadForgeDeckGoldfish } from '@/app/forge/lib/playDecks';
import GoldfishClient from './client';
import type { DeckDataForGoldfish } from '../types';

export const metadata = {
  title: 'Practice Mode',
  description: 'Practice your Redemption deck in goldfish mode',
};

export default async function GoldfishPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;

  const result = await loadPublicDeckAction(deckId);

  // Logged-in user's profile username — only used to gate the per-user
  // cycling-token easter egg. Null when signed out.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let username: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    username = profile?.username ?? null;
  }

  let deckData: DeckDataForGoldfish | null = null;
  if (result.success && result.deck) {
    const deck = result.deck;

    // Enrich DB card rows with type data from the card database
    deckData = {
      id: deck.id,
      name: deck.name,
      format: deck.format || 'Type 1',
      paragon: deck.paragon || null,
      isOwner: result.isOwner ?? false,
      // Maybeboard rows are filtered out — goldfish never sees the scratchpad.
      cards: (deck.cards || []).filter((c: any) => c.zone !== 'maybeboard').map((c: any) => {
        const imgFile = (c.card_img_file || '').replace(/\.jpe?g$/i, '');
        const enriched = findCard(c.card_name, c.card_set || undefined, imgFile);

        return {
          card_name: c.card_name,
          card_set: c.card_set || '',
          card_img_file: c.card_img_file || '',
          card_type: enriched?.type || '',
          card_brigade: enriched?.brigade || '',
          card_strength: enriched?.strength || '',
          card_toughness: enriched?.toughness || '',
          card_special_ability: enriched?.specialAbility || '',
          card_identifier: enriched?.identifier || '',
          card_reference: enriched?.reference || '',
          card_alignment: enriched?.alignment || '',
          quantity: c.quantity || 1,
          is_reserve: c.zone === 'reserve',
        };
      }),
    };
  } else {
    // Forge fallback: members' own forge decks (requireForge + owner-scoped RLS
    // inside the loader; non-members/non-owners fall through to 404).
    deckData = await loadForgeDeckGoldfish(deckId);
    if (!deckData) notFound();
  }

  return <GoldfishClient deck={deckData} username={username} />;
}
