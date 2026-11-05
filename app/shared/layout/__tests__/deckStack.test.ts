import { describe, it, expect } from 'vitest';
import {
  DECK_STACK_MAX_LAYERS,
  DECK_STACK_RESERVE_RATIO,
  deckStackLayers,
  fitDeckStackCardHeight,
  layoutDeckStack,
} from '../deckStack';

describe('deckStackLayers', () => {
  it('draws nothing under an empty pile or a single card', () => {
    expect(deckStackLayers(0)).toBe(0);
    expect(deckStackLayers(1)).toBe(0);
  });

  it('draws every card of a small pile', () => {
    expect(deckStackLayers(2)).toBe(1);
    expect(deckStackLayers(3)).toBe(2);
    expect(deckStackLayers(4)).toBe(3);
  });

  it('never shrinks as cards are added and stops at the maximum', () => {
    let previous = 0;
    for (let count = 0; count <= 260; count++) {
      const layers = deckStackLayers(count);
      expect(layers).toBeGreaterThanOrEqual(previous);
      expect(layers).toBeLessThanOrEqual(DECK_STACK_MAX_LAYERS);
      previous = layers;
    }
    expect(deckStackLayers(33)).toBe(DECK_STACK_MAX_LAYERS);
    expect(deckStackLayers(252)).toBe(DECK_STACK_MAX_LAYERS);
  });

  it('gets visibly thinner well before the pile runs out', () => {
    expect(deckStackLayers(20)).toBeLessThan(deckStackLayers(42));
    expect(deckStackLayers(8)).toBeLessThan(deckStackLayers(20));
  });

  it('treats bad counts as an empty pile', () => {
    expect(deckStackLayers(-3)).toBe(0);
    expect(deckStackLayers(NaN)).toBe(0);
  });
});

describe('layoutDeckStack', () => {
  it('has one position per layer, each lower and further left than the last', () => {
    const { layers } = layoutDeckStack(50, 70, 100);
    expect(layers).toHaveLength(DECK_STACK_MAX_LAYERS);
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].y).toBeGreaterThan(layers[i - 1].y);
      expect(layers[i].x).toBeLessThan(layers[i - 1].x);
    }
  });

  it('shows the second card of a two-card pile by a visible amount', () => {
    const { layers } = layoutDeckStack(2, 70, 100);
    expect(layers).toHaveLength(1);
    expect(layers[0].y).toBeCloseTo(2);
    expect(layers[0].x).toBeLessThan(-1);
  });

  it('has no layers for a single card, which sits in the bottom-left corner', () => {
    const layout = layoutDeckStack(1, 70, 100);
    expect(layout.layers).toEqual([]);
    expect(layout.top.x).toBeCloseTo(0);
    expect(layout.top.y + 100).toBeCloseTo(layout.height);
  });

  it('puts the top card of a full stack in the top-right corner', () => {
    const layout = layoutDeckStack(60, 70, 100);
    expect(layout.top.y).toBeCloseTo(0);
    expect(layout.top.x + 70).toBeCloseTo(layout.width);
  });

  it('keeps the box and the bottom card in one place whatever the count', () => {
    const full = layoutDeckStack(80, 67, 94);
    for (const count of [2, 3, 4, 10, 20, 33, 80]) {
      const layout = layoutDeckStack(count, 67, 94);
      expect(layout.width).toBeCloseTo(full.width);
      expect(layout.height).toBeCloseTo(full.height);
      const bottom = layout.layers[layout.layers.length - 1];
      expect(layout.top.x + bottom.x).toBeCloseTo(0);
      expect(layout.top.y + bottom.y + 94).toBeCloseTo(layout.height);
    }
  });

  it('never draws outside its box', () => {
    for (const count of [0, 1, 2, 5, 17, 33, 252]) {
      const layout = layoutDeckStack(count, 67, 94);
      const corners = [{ x: 0, y: 0 }, ...layout.layers].map((p) => ({
        x: layout.top.x + p.x,
        y: layout.top.y + p.y,
      }));
      for (const corner of corners) {
        expect(corner.x).toBeGreaterThanOrEqual(-1e-9);
        expect(corner.y).toBeGreaterThanOrEqual(-1e-9);
        expect(corner.x + 67).toBeLessThanOrEqual(layout.width + 1e-9);
        expect(corner.y + 94).toBeLessThanOrEqual(layout.height + 1e-9);
      }
    }
  });

  it('scales with the card', () => {
    const small = layoutDeckStack(50, 35, 50);
    const large = layoutDeckStack(50, 70, 100);
    large.layers.forEach((layer, i) => {
      expect(layer.x).toBeCloseTo(small.layers[i].x * 2);
      expect(layer.y).toBeCloseTo(small.layers[i].y * 2);
    });
  });
});

describe('fitDeckStackCardHeight', () => {
  it('keeps the card at full size when the stack already fits', () => {
    expect(fitDeckStackCardHeight(80, 103)).toBe(80);
  });

  it('shrinks the card so card plus full stack fit the space', () => {
    const cardHeight = fitDeckStackCardHeight(103, 103);
    expect(cardHeight).toBeLessThan(103);
    expect(cardHeight * (1 + DECK_STACK_RESERVE_RATIO)).toBeLessThanOrEqual(103);
    expect(layoutDeckStack(60, Math.round(cardHeight / 1.4), cardHeight).height).toBeLessThanOrEqual(103);
  });
});
