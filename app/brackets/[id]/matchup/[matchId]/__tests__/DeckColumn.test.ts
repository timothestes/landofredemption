import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EnrichedCard } from '@/app/decklist/[deckId]/enrichDeckCards';
import type { BracketEntry } from '@/lib/bracket/types';
import { DeckColumn, type MatchupSide } from '../DeckColumn';

const entry = (keyCards: string[] = []): BracketEntry => ({
  id: 'e1', seed: 1, deckId: 'd1', deckName: 'Daniel is Metal', deckFormat: 'Limited',
  previewCard1: null, previewCard2: null, paragon: null, keyCards,
});

const card = (name: string, type: string, extra: Partial<EnrichedCard> = {}): EnrichedCard => ({
  card_name: name, card_set: 'S', card_img_file: name.replace(/ /g, '_'), quantity: 1, zone: 'main',
  type, alignment: 'Good', brigade: '', fullCard: null, ...extra,
});

const okSide = (keyCards: string[] = []): MatchupSide => ({
  entry: entry(keyCards),
  status: 'ok',
  deck: { id: 'd1', name: 'Daniel is Metal', format: 'Limited', paragon: null, ownerName: 'baboony' },
  cards: [card('Daniel', 'Hero'), card('Son of God', 'Dominant'), card('Spare', 'GE', { zone: 'reserve' })],
});

const render = (side: MatchupSide, isOwner: boolean) =>
  renderToStaticMarkup(createElement(DeckColumn, {
    side, isOwner, onOpenCard: () => {}, onSaveKeyCards: async () => ({ ok: true }), onError: () => {},
  }));

describe('DeckColumn', () => {
  it('renders the header, the type buckets in order, and the reserve apart', () => {
    const html = render(okSide(), false);
    expect(html).toContain('href="/decklist/d1"');
    expect(html).toContain('by baboony');
    expect(html).toContain('2 main · 1 reserve');
    const order = ['Dominants', 'Heroes', 'Reserve'].map(l => html.indexOf(l));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every(i => i >= 0)).toBe(true);
  });

  it('hides the key-card strip from a viewer when there are none, but shows the owner the chooser', () => {
    expect(render(okSide(), false)).not.toContain('Key cards');
    const owner = render(okSide(), true);
    expect(owner).toContain('Key cards');
    expect(owner).toContain('Choose key cards');
    expect(owner).toContain('No key cards yet');
  });

  it('shows starred cards to everyone, in the strip and ringed in the list', () => {
    const html = render(okSide(['Son of God|S|Son_of_God']), false);
    expect(html).toContain('Key cards');
    expect(html).not.toContain('Choose key cards');
    expect(html.match(/aria-label="Key card"/g)).toHaveLength(2);
    expect(html).toContain('ring-primary');
  });

  it('explains a private or deleted deck instead of listing cards', () => {
    const base = okSide();
    const priv = render({ ...base, status: 'private', deck: null, cards: [] }, false);
    expect(priv).toContain('This deck is private');
    expect(priv).not.toContain('Key cards');
    const gone = render({ ...base, entry: { ...base.entry, deckId: null }, status: 'deleted', deck: null, cards: [] }, true);
    expect(gone).toContain('This deck was deleted');
    expect(gone).not.toContain('Choose key cards');
  });
});
