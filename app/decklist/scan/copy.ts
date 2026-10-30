import { COPY, fill, qualityLine } from '@/app/collection/scan/copy';

export { fill };

/** The spec's Copy table, verbatim. Errors, the signed-out gate and the not-open state reuse the scanner's COPY. */
export const DECK_COPY = {
  pageTitle: 'Deck from photo',
  lead: 'Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder.',
  tips: 'Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row.',
  reading: 'Reading…',
  readDone: 'Read {n} cards in {g} groups',
  readDoneOneCard: 'Read 1 card in {g} groups',
  readDoneOneGroup: 'Read {n} cards in 1 group',
  readDoneOne: 'Read 1 card in 1 group',
  readingCrop: 'Reading {n} sideways group{s}…',
  smallPhoto: 'Small photo: the full-size original reads better',
  tooManyCards: 'Too many cards for one photo. Photograph the deck in two halves and add both.',
  groupHeader: 'Group {i} · Read {n}',
  groupHeaderEstimate: 'Group {i} · Read {n} of about {m}',
  addCard: 'Add a card…',
  suggestions: 'Suggestions',
  toCheck: '{n} to check',
  menuPrinting: 'Change printing',
  menuToReserve: 'Move to reserve',
  menuToMain: 'Move to main deck',
  menuRemove: 'Remove',
  removed: 'Removed {name} · Undo',
  removedUnread: 'Removed {n} unreadable cards · Undo',
  removedUnreadOne: 'Removed 1 unreadable card · Undo',
  removedNotFound: 'Removed "{title}" · Undo',
  stripHint: 'Tap to enlarge',
  zoneMain: 'Main deck',
  zoneReserve: 'Reserve',
  lostSoulRow: 'Lost Soul ×{n} · Pick which',
  lostSoulPicked: '{n} picked',
  pickWhich: 'Pick which',
  sheetTitle: 'Pick your Lost Souls · {picked} of {target}',
  unread: "Couldn't read this card",
  notFound: 'Not found: "{title}"',
  readAs: 'Read as "{title}"',
  whichCard: 'Which card?',
  totals: 'Main {m} · Reserve {r} · {ls} Lost Souls to pick · {u} unread',
  leftOut: '{n} cards left out',
  openConfirm: 'Open with {n} cards?',
  open: 'Open in deck builder',
  copy: 'Copy as text',
  copied: 'Copied',
  copyFailed: "Couldn't copy. Select and copy the text instead.",
  // The spec's placeholder is {Mon D}, which fill()'s \w+ token cannot match: handoff.deckName substitutes it.
  deckName: 'Deck from photo · {Mon D}',
  crossLinkHere: 'Scanning single cards for your collection? Use the card scanner.',
  crossLinkScanner: 'Scanning a whole deck? Use Deck from photo.',
  privacy: 'Deck photos are handled the same way: sent to Anthropic to read the cards, not kept.',
} as const;

/** Under this long edge (px) titles mostly go unread: in the eval, 3% of cards on sideways photos and 34% upright, against 71-85% at 1500 and up. */
export const SMALL_PHOTO_EDGE = 1500;

/** The deck photo's done line: singular per noun, plus a note for a small photo, else the scanner's quality note for a poor one. */
export function deckDoneLine(n: number, g: number, quality?: string, longEdge?: number): string {
  const base = n === 1 && g === 1 ? DECK_COPY.readDoneOne
    : n === 1 ? DECK_COPY.readDoneOneCard
    : g === 1 ? DECK_COPY.readDoneOneGroup
    : DECK_COPY.readDone;
  const line = fill(base, { n, g });
  if (longEdge !== undefined && longEdge < SMALL_PHOTO_EDGE) return `${line} · ${DECK_COPY.smallPhoto}`;
  const q = quality === 'dark' || quality === 'blurry' || quality === 'glare' ? qualityLine(quality) : null;
  return q ? `${line} · ${fill(COPY.qualityCheckNames, { q })}` : line;
}
