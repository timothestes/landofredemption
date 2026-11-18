/**
 * Redemption CCG card data.
 * Auto-generated from scripts/data/carddata.txt.
 * Source: https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/carddata.txt
 *
 * To regenerate this file, run: make update-cards
 *
 * DO NOT EDIT BY HAND.
 *
 * The card data itself lives in ./cardData.json; this module only types it.
 * Keeping the array out of the .ts source avoids type-checking a giant literal.
 */

import cardData from './cardData.json';

export interface CardData {
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  /** Illustrator credit, '' when unknown (scripts/lib/applyCardArtists.js). */
  artist: string;
}

export const CARDS: readonly CardData[] = cardData as readonly CardData[];
