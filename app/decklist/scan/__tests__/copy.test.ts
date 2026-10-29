import { describe, it, expect } from 'vitest';
import { DECK_COPY } from '../copy';

const SPEC: Record<string, string> = {
  pageTitle: 'Deck from photo',
  lead: 'Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder.',
  tips: 'Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row.',
  reading: 'Reading…',
  readDone: 'Read {n} cards in {g} groups',
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
  stripHint: 'Tap to enlarge',
  zoneMain: 'Main deck',
  zoneReserve: 'Reserve',
  lostSoulRow: 'Lost Soul ×{n} · Pick which',
  lostSoulPicked: '{n} picked',
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
  deckName: 'Deck from photo · {Mon D}',
  crossLinkHere: 'Scanning single cards for your collection? Use the card scanner.',
  crossLinkScanner: 'Scanning a whole deck? Use Deck from photo.',
  privacy: 'Deck photos are handled the same way: sent to Anthropic to read the cards, not kept.',
};

describe('DECK_COPY', () => {
  it('has every spec key with the exact text and nothing extra', () => {
    expect({ ...DECK_COPY }).toEqual(SPEC);
  });
});
