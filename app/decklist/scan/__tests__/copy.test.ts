import { describe, it, expect } from 'vitest';
import { DECK_COPY, deckDoneLine, SMALL_PHOTO_EDGE } from '../copy';

const SPEC: Record<string, string> = {
  pageTitle: 'Deck from photo',
  lead: 'Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder.',
  tips: 'Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row.',
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
