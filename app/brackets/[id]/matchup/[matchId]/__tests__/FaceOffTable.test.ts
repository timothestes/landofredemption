import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deckBreakdown, type MatchupCard } from '../../../../lib/matchup';
import { FaceOffTable } from '../FaceOffTable';

const card = (name: string, type: string, extra: Partial<MatchupCard> = {}): MatchupCard => ({
  card_name: name, card_set: 'S', card_img_file: name, quantity: 1, zone: 'main',
  type, alignment: 'Good', brigade: '', ...extra,
});

const a = deckBreakdown([card('Abram', 'Hero', { brigade: 'Red', quantity: 3 }), card('Son of God', 'Dominant')]);
const b = deckBreakdown([card('Herod', 'Evil Character', { brigade: 'Orange', alignment: 'Evil' })]);

describe('FaceOffTable', () => {
  it('names both decks, lists the shared rows, and marks the smaller side as muted', () => {
    const html = renderToStaticMarkup(createElement(FaceOffTable, { a, b, nameA: 'Alpha', nameB: 'Beta' }));
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    for (const label of ['Main deck', 'Dominants', 'Heroes', 'Evil Characters']) expect(html).toContain(label);
    // Main deck 4 vs 1: the "1" recedes, the "4" does not.
    const cells = [...html.matchAll(/<span class="([^"]*tabular-nums[^"]*)">(\d+|—)<\/span>/g)]
      .map(m => ({ cls: m[1], text: m[2] }));
    const main = cells.slice(0, 2);
    expect(main[0].text).toBe('4');
    expect(main[0].cls).not.toContain('text-muted-foreground');
    expect(main[1].text).toBe('1');
    expect(main[1].cls).toContain('text-muted-foreground');
  });

  it('shows brigade chips with a swatch per side', () => {
    const html = renderToStaticMarkup(createElement(FaceOffTable, { a, b, nameA: 'Alpha', nameB: 'Beta' }));
    expect(html).toContain('Good brigades');
    expect(html).toContain('Evil brigades');
    expect(html).toContain('--sw-light:#c62828');
    expect(html).toContain('--sw-light:#d1590a');
  });

  it('shows a dash for an unavailable side and nothing when neither deck is readable', () => {
    const html = renderToStaticMarkup(createElement(FaceOffTable, { a, b: null, nameA: 'Alpha', nameB: 'Beta' }));
    expect(html).toContain('>—<');
    expect(renderToStaticMarkup(createElement(FaceOffTable, { a: null, b: null, nameA: 'A', nameB: 'B' }))).toBe('');
  });
});
