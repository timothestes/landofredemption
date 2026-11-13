import { describe, it, expect } from 'vitest';
import { DECK_COPY, deckDoneLine, lostSoulRowLines, SMALL_PHOTO_EDGE } from '../copy';

const SPEC: Record<string, string> = {
  pageTitle: 'Deck from photo',
  lead: 'Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder.',
  tips: 'Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row.',
  captureTip: 'Stand where you would read the cards, so the titles are the right way up in the photo. No flash; light from the side.',
  reading: 'Reading…',
  readDone: 'Read {n} cards in {g} groups',
  readDoneOneCard: 'Read 1 card in {g} groups',
  readDoneOneGroup: 'Read {n} cards in 1 group',
  readDoneOne: 'Read 1 card in 1 group',
  readingCrop: 'Reading {n} sideways group{s}…',
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
  deckName: 'Deck from photo · {Mon D}',
  crossLinkHere: 'Scanning single cards for your collection? Use the card scanner.',
  crossLinkScanner: 'Scanning a whole deck? Use Deck from photo.',
  privacy: 'Deck photos are handled the same way: sent to Anthropic to read the cards, not kept.',
  smallPhoto: 'Small photo: the full-size original reads better',
};

describe('DECK_COPY', () => {
  it('has every spec key with the exact text and nothing extra', () => {
    expect({ ...DECK_COPY }).toEqual(SPEC);
  });
});

describe('lostSoulRowLines', () => {
  it('asks for the whole deck in one number', () => {
    expect(lostSoulRowLines(0, 7, false)).toEqual({ title: 'Pick your 7 Lost Souls', sub: 'Tap to say which ones.', todo: true });
    expect(lostSoulRowLines(0, 1, false).title).toBe('Pick your Lost Soul');
  });
  it('says what is left while short', () => {
    expect(lostSoulRowLines(6, 7, false)).toEqual({ title: '6 of 7 Lost Souls picked', sub: 'Pick 1 more', todo: true });
  });
  it('is settled once every one is picked', () => {
    expect(lostSoulRowLines(7, 7, false)).toEqual({ title: '7 Lost Souls picked', sub: null, todo: false });
    expect(lostSoulRowLines(8, 7, false)).toEqual({ title: '8 Lost Souls picked', sub: 'Photo showed 7', todo: false });
  });
  it('stops asking once the player says that is all, and still flags the difference', () => {
    expect(lostSoulRowLines(6, 7, true)).toEqual({ title: '6 Lost Souls picked', sub: 'Photo showed 7', todo: true });
    expect(lostSoulRowLines(0, 7, true)).toEqual({ title: 'No Lost Souls picked', sub: 'Photo showed 7', todo: true });
  });
});

describe('deckDoneLine', () => {
  it('uses the singular per noun', () => {
    expect(deckDoneLine(1, 1)).toBe('Read 1 card in 1 group');
    expect(deckDoneLine(1, 3)).toBe('Read 1 card in 3 groups');
    expect(deckDoneLine(5, 1)).toBe('Read 5 cards in 1 group');
    expect(deckDoneLine(5, 2)).toBe('Read 5 cards in 2 groups');
  });
  it('keeps the quality note for dark, blurry and glare only', () => {
    expect(deckDoneLine(5, 2, 'dark')).toBe('Read 5 cards in 2 groups · Too dark: check the names below');
    expect(deckDoneLine(5, 2, 'glare')).toContain('Glare: check the names below');
    expect(deckDoneLine(5, 2, 'ok')).toBe('Read 5 cards in 2 groups');
  });
  it('says so for a small photo, in place of the quality note', () => {
    expect(deckDoneLine(5, 2, 'blurry', 1024)).toBe('Read 5 cards in 2 groups · Small photo: the full-size original reads better');
    expect(deckDoneLine(5, 2, 'ok', SMALL_PHOTO_EDGE)).toBe('Read 5 cards in 2 groups');
    expect(deckDoneLine(5, 2, 'ok', undefined)).toBe('Read 5 cards in 2 groups');
  });
});
