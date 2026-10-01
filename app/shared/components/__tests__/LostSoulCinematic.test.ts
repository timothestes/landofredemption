import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LostSoulCinematic } from '../LostSoulCinematic';
import { simplifyLostSoulName } from '@/lib/cards/cardAbilities';

// Characterization test for the overlay restored from PR #173's deletion: the
// `.lsc-*` CSS in globals.css keys off these generated class names.
const soul = (i: number) => ({
  instanceId: `s${i}`,
  cardName: `Lost Soul (Test ${i})`,
  imageUrl: `https://cdn.test/${i}.jpg`,
});
const render = (n: number) =>
  renderToStaticMarkup(
    createElement(LostSoulCinematic, { souls: Array.from({ length: n }, (_, i) => soul(i + 1)) }),
  );

describe('LostSoulCinematic', () => {
  it('renders nothing for an empty batch', () => {
    expect(render(0)).toBe('');
  });

  it('forges seven staggered chain links over each soul', () => {
    const html = render(1);
    expect(html.match(/class="lsc-link lsc-link-\d"/g)).toHaveLength(7);
    for (let i = 0; i < 7; i++) expect(html).toContain(`lsc-link lsc-link-${i}`);
    // Per-card gradient ids are keyed by instance so two cards never share one.
    expect(html).toContain('id="lsc-h-grad-s1"');
    expect(html).toContain('id="lsc-v-grad-s1"');
  });

  it('fans out at most three souls and counts the rest', () => {
    const html = render(5);
    expect(html.match(/class="lsc-slot"/g)).toHaveLength(3);
    expect(html.match(/class="lsc-link lsc-link-\d"/g)).toHaveLength(21);
    expect(html).toContain('+2 more');
  });

  it('captions each shown soul with its simplified name', () => {
    const html = render(2);
    expect(html).toContain(simplifyLostSoulName('Lost Soul (Test 1)'));
    expect(html).toContain(simplifyLostSoulName('Lost Soul (Test 2)'));
    expect(html).not.toContain('more');
  });

  it('does not opt into reduced motion when rendered without a window', () => {
    expect(render(1)).toContain('class="lsc-root"');
    expect(render(1)).not.toContain('lsc-reduced');
  });
});
