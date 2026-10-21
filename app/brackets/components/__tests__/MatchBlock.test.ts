import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BracketEntry } from '@/lib/bracket/types';
import type { MatchView } from '../../lib/view';
import { MatchBlock } from '../MatchBlock';

const entry = (id: string, deckName: string): BracketEntry => ({
  id, seed: 1, deckId: 'd-' + id, deckName, deckFormat: 'Limited',
  previewCard1: null, previewCard2: null, paragon: null,
});

const doneView: MatchView = {
  match: { id: 'm1', round: 1, position: 0, entryAId: 'a', entryBId: 'b', winnerEntryId: 'a', isBye: false },
  label: 'QF1',
  state: 'done',
  series: { winsA: 2, winsB: 0, needed: 2, decided: true, winner: 'a', nextGameNumber: 3, inProgress: null },
  a: entry('a', 'Alpha'),
  b: entry('b', 'Beta'),
  placeholderA: '',
  placeholderB: '',
  firstToPlayName: null,
  canPlay: true,
};

const rows = (html: string) => [...html.matchAll(/<div class="(flex min-h-11 items-center[^"]*)"/g)].map(m => m[1]);

describe('MatchBlock', () => {
  it('server render of a just-decided match is the pre-written look, transition classes already on', () => {
    const html = renderToStaticMarkup(createElement(MatchBlock, { view: doneView, isOwner: true, highlight: 'write-in' }));
    expect(html).toContain('data-written="false"');
    const [a] = rows(html);
    expect(a).not.toContain('border-l-primary');
    expect(a).toContain('transition-[color,opacity,border-color]');
  });

  it('winner row gets the accent; every row edge is transparent, not a divide colour', () => {
    const html = renderToStaticMarkup(createElement(MatchBlock, { view: doneView, isOwner: true }));
    const [a, b] = rows(html);
    expect(a).toContain('border-l-primary');
    expect(b).toContain('border-l-transparent');
    expect(b).not.toContain('border-l-primary');
    expect(html).not.toContain('divide-');
  });

  it('a done match with only the overflow menu has no footer row', () => {
    const html = renderToStaticMarkup(createElement(MatchBlock, { view: doneView, isOwner: true, canReset: true, onReset: () => {} }));
    expect(html).toContain('aria-label="More actions for QF1"');
    expect(html).not.toContain('px-3 py-2');
  });
});
