// SERVER-ONLY. Imports lib/cards/lookup (the full card catalog); never import
// this from a client component, or the catalog lands in the client bundle.
import { findCard } from '@/lib/cards/lookup';
import type { GameCardData } from '../actions';

export interface DeckCardRow {
  card_name: string | null;
  card_set: string | null;
  card_img_file: string | null;
  quantity: number | null;
  zone: string | null;
}

/** Expands quantity > 1 rows into individual entries enriched from the card catalog. */
export function deckToGameData(cards: DeckCardRow[]): GameCardData[] {
  const deckData: GameCardData[] = [];
  for (const card of cards) {
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
  return deckData;
}
