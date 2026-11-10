import { impliedFamily } from '@/lib/scan/deck';

/** Where the generate page's decklist comes from. */
export type Source = 'photo' | 'paste' | 'decks';

/**
 * The deck-check parser keeps everything after a line's first tab as the card name, so the deck builder's
 * four-column export (`qty\tname\tset\timgFile`) names cards nobody has and the PDF comes out empty. Keep the
 * first two fields of every card line. Lines without a tab, and `Tokens:` with everything after it (which the
 * parser ignores), are left as they are.
 */
export function normalizeDecklist(text: string): string {
  let tokens = false;
  return text
    .split('\n')
    .map(raw => {
      if (tokens) return raw;
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.trim().startsWith('Tokens:')) {
        tokens = true;
        return line;
      }
      const fields = line.split('\t');
      return fields.length > 2 ? `${fields[0]}\t${fields[1]}` : line;
    })
    .join('\n');
}

/** The Deck Type a photo's main-deck total implies: the Type 2 range, else Type 1. Never Paragon. */
export const deckTypeFromMain = (mainTotal: number): 'type_1' | 'type_2' =>
  impliedFamily(mainTotal) === 'T2' ? 'type_2' : 'type_1';

/**
 * What the generators get. The photo source owns its own text and Deck Type and never a saved deck's id:
 * sending one would make the PDF of the saved deck, not of the photo. The typed and saved-deck sources keep
 * their own Deck Type, so a photo's read never changes the type a saved deck was loaded with.
 */
export function effectiveDeck(a: {
  source: Source;
  typed: string;
  photoText: string;
  loadedDeckId: string | null;
  typedType: string;
  photoType: string;
}): { decklist: string; deckId: string | null; deckType: string } {
  if (a.source === 'photo') return { decklist: a.photoText, deckId: null, deckType: a.photoType };
  return { decklist: normalizeDecklist(a.typed), deckId: a.loadedDeckId, deckType: a.typedType };
}

/** Identifies a tray's outcomes, so a second Generate from an unchanged tray does not write them again. */
export const outcomesSignature = (outcomes: Record<string, unknown[]>): string => JSON.stringify(outcomes);
