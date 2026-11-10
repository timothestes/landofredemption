import { describe, expect, it } from 'vitest';
import { FORMATS } from '@/lib/formats';
import { parseDecklistText } from '@/lib/decksheets/parse';
import { deckTypeFromMain, effectiveDeck, normalizeDecklist, outcomesSignature } from '../decklistText';

describe('normalizeDecklist', () => {
  it('cuts four columns to two', () => {
    expect(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg\nReserve:\n1\tDavid\tPr\tdavid.jpg'))
      .toBe('2\tSaul\nReserve:\n1\tDavid');
  });
  it('leaves two columns, blank lines and space-separated lines alone', () => {
    const t = '2\tSaul\n\nReserve:\n1 David';
    expect(normalizeDecklist(t)).toBe(t);
  });
  it('strips CRLF', () => {
    expect(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg\r\n1\tDavid\r\n')).toBe('2\tSaul\n1\tDavid\n');
  });
  it('does not touch Tokens: and what follows', () => {
    expect(normalizeDecklist('1\tA\tx\ty\nTokens:\n1\tT\tx\ty')).toBe('1\tA\nTokens:\n1\tT\tx\ty');
  });
  it('a normalized four-column export parses to the right names', () => {
    expect(parseDecklistText(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg')).main).toEqual([{ quantity: 2, name: 'Saul' }]);
  });
});

describe('deckTypeFromMain', () => {
  it('follows the Type 2 range', () => {
    expect(deckTypeFromMain(FORMATS.T2.main.min)).toBe('type_2');
    expect(deckTypeFromMain(FORMATS.T2.main.min - 1)).toBe('type_1');
    expect(deckTypeFromMain(FORMATS.T2.main.max + 1)).toBe('type_1');
  });
});

describe('effectiveDeck', () => {
  it('photo source sends the photo text and no deck id', () => {
    expect(effectiveDeck({ source: 'photo', typed: '1\tOld', photoText: '2\tSaul', loadedDeckId: 'd1', typedType: 'paragon', photoType: 'type_2' }))
      .toEqual({ decklist: '2\tSaul', deckId: null, deckType: 'type_2' });
  });
  it('paste source normalizes and keeps the loaded deck id', () => {
    expect(effectiveDeck({ source: 'paste', typed: '2\tSaul\tR\ts.jpg', photoText: 'x', loadedDeckId: 'd1', typedType: 'paragon', photoType: 'type_2' }))
      .toEqual({ decklist: '2\tSaul', deckId: 'd1', deckType: 'paragon' });
  });
  it('a saved deck keeps its own type after a photo was read', () => {
    expect(effectiveDeck({ source: 'decks', typed: '1\tA', photoText: 'x', loadedDeckId: 'd1', typedType: 'paragon', photoType: 'type_1' }).deckType)
      .toBe('paragon');
  });
});

describe('outcomesSignature', () => {
  it('is equal for an unchanged tray and differs after a change', () => {
    const a = { s1: [{ id: 's1:0', finalKey: 'A|x|y' }] };
    expect(outcomesSignature(a)).toBe(outcomesSignature(JSON.parse(JSON.stringify(a))));
    expect(outcomesSignature(a)).not.toBe(outcomesSignature({ s1: [{ id: 's1:0', finalKey: 'B|x|y' }] }));
  });
});
