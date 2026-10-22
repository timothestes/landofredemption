import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BracketEntry } from '@/lib/bracket/types';
import type { MatchView } from '../../lib/view';
import { MatchBlock } from '../MatchBlock';

const entry = (id: string, deckName: string): BracketEntry => ({
  id, seed: 1, deckId: 'd-' + id, deckName, deckFormat: 'Limited',
  previewCard1: null, previewCard2: null, paragon: null, keyCards: [],
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

const readyView: MatchView = {
  ...doneView,
  match: { ...doneView.match, winnerEntryId: null },
  state: 'ready',
  series: { winsA: 0, winsB: 0, needed: 2, decided: false, winner: null, nextGameNumber: 1, inProgress: null },
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

  it('links a seated match to its matchup preview, for owner and viewer alike', () => {
    for (const isOwner of [true, false]) {
      const html = renderToStaticMarkup(createElement(MatchBlock, { view: readyView, isOwner, bracketId: 'b1' }));
      expect(html).toContain('href="/brackets/b1/matchup/m1"');
      expect(html).toContain('Preview matchup');
    }
  });

  it('has no preview row without a bracket id (the setup screen) or with an empty slot', () => {
    const setup = renderToStaticMarkup(createElement(MatchBlock, { view: readyView, isOwner: false, onRemoveEntry: () => {} }));
    expect(setup).not.toContain('Preview matchup');
    const waiting: MatchView = {
      ...readyView, state: 'waiting', b: null, placeholderB: 'Winner of QF2',
      match: { ...readyView.match, entryBId: null },
    };
    const html = renderToStaticMarkup(createElement(MatchBlock, { view: waiting, isOwner: true, bracketId: 'b1' }));
    expect(html).not.toContain('Preview matchup');
  });

  it('a done match with only the overflow menu has no footer row', () => {
    const html = renderToStaticMarkup(createElement(MatchBlock, { view: doneView, isOwner: true, canReset: true, onReset: () => {} }));
    expect(html).toContain('aria-label="More actions for QF1"');
    expect(html).not.toContain('px-3 py-2');
  });
});
