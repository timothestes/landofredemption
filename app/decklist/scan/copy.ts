import { COPY, fill, qualityLine } from '@/app/collection/scan/copy';

export { fill };

/** The spec's Copy table, verbatim. Errors, the signed-out gate and the not-open state reuse the scanner's COPY. */
export const DECK_COPY = {
  pageTitle: 'Deck from photo',
  lead: 'Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder.',
  tips: 'Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row.',
  // A phone held across the layout gives a turned photo, the slowest case (about 45 s more); flash gives glare.
  captureTip: 'Stand where you would read the cards, so the titles are the right way up in the photo. No flash; light from the side.',
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
  stripLabel: 'Tap to see it in the photo',
  chipOther: 'Other…',
  sourcePhoto: 'From a photo',
  pillNew: 'New',
  calloutHeading: 'Deck check PDF from a photo',
  calloutBody: 'Photograph your deck laid out on the table. We read the cards, you fix any misreads, and the PDF is one tap away.',
  calloutButton: 'Read a photo',
  signedOutTitle: 'Sign in to read a deck from a photo',
  generateConfirm: 'Generate with {n} cards?',
  pdfLinkLead: 'Need the tournament PDF instead?',
  pdfLink: 'Deck check PDF',
  pasteHint: 'Or read it from a photo',
  zoneMain: 'Main deck',
  zoneReserve: 'Reserve',
  lostSoulRow: 'Pick your {n} Lost Souls',
  lostSoulRowOne: 'Pick your Lost Soul',
  lostSoulRowWhy: 'Tap to say which ones.',
  lostSoulPartial: '{picked} of {n} Lost Souls picked',
  lostSoulMore: 'Pick {n} more',
  lostSoulDone: '{n} Lost Souls picked',
  lostSoulDoneOne: '1 Lost Soul picked',
  lostSoulNone: 'No Lost Souls picked',
  lostSoulPhotoShowed: 'Photo showed {n}',
  lostSoulElsewhere: '{n} more Lost Souls, picked with the rest above',
  lostSoulElsewhereOne: '1 more Lost Soul, picked with the rest above',
  pick: 'Pick',
  change: 'Change',
  sheetTitle: 'Pick your Lost Souls',
  sheetHint: 'Match the picture or verse on each card.',
  sheetSearch: 'Search name or verse',
  sheetOlder: 'All versions',
  sheetShowOlder: 'Show {n} more versions',
  sheetEmpty: 'No Lost Souls match.',
  sheetInDeck: 'Read from the photo',
  sheetCount: '{picked} of {target} picked',
  sheetOver: '{picked} picked · photo showed {target}',
  sheetSkip: 'Skip',
  sheetDone: 'Done',
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

/**
 * The deck's one Lost Soul row: how many the photo showed, how many are picked, and what is left to do.
 * `todo` marks the row amber: it is, for as long as the picks are short of the photo. `finished` is the player
 * saying they are done anyway, which stops the row asking for more but not flagging the difference.
 */
export function lostSoulRowLines(picked: number, counted: number, finished: boolean): { title: string; sub: string | null; todo: boolean } {
  const todo = picked < counted;
  if (picked === 0 && !finished) {
    return { title: counted === 1 ? DECK_COPY.lostSoulRowOne : fill(DECK_COPY.lostSoulRow, { n: counted }), sub: DECK_COPY.lostSoulRowWhy, todo };
  }
  if (todo && !finished) {
    return { title: fill(DECK_COPY.lostSoulPartial, { picked, n: counted }), sub: fill(DECK_COPY.lostSoulMore, { n: counted - picked }), todo };
  }
  const title = picked === 0 ? DECK_COPY.lostSoulNone : picked === 1 ? DECK_COPY.lostSoulDoneOne : fill(DECK_COPY.lostSoulDone, { n: picked });
  return { title, sub: picked === counted ? null : fill(DECK_COPY.lostSoulPhotoShowed, { n: counted }), todo };
}

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
