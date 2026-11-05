import { describe, it, expect } from 'vitest';
import {
  DECK_STACK_MAX_LAYERS,
  DECK_STACK_RESERVE_RATIO,
  deckShuffleCards,
  deckShuffleDuration,
  deckShufflePose,
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

describe('deck shuffle animation', () => {
  it('slides no cards for an empty pile or a single card', () => {
    expect(deckShuffleCards(0)).toBe(0);
    expect(deckShuffleCards(1)).toBe(0);
    expect(deckShuffleCards(NaN)).toBe(0);
    expect(deckShuffleDuration(0)).toBe(0);
  });

  it('slides every card under the top one of a small pile, and three of a big one', () => {
    expect(deckShuffleCards(2)).toBe(1);
    expect(deckShuffleCards(3)).toBe(2);
    expect(deckShuffleCards(4)).toBe(3);
    expect(deckShuffleCards(60)).toBe(3);
  });

  it('is short, and shorter with fewer cards', () => {
    expect(deckShuffleDuration(1)).toBeLessThan(deckShuffleDuration(3));
    expect(deckShuffleDuration(3)).toBeLessThanOrEqual(700);
  });

  it('starts and ends with every card back under the top card', () => {
    for (const cards of [1, 2, 3]) {
      for (let i = 0; i < cards; i++) {
        for (const elapsed of [0, deckShuffleDuration(cards), deckShuffleDuration(cards) + 500]) {
          const pose = deckShufflePose(i, elapsed, 67, 94);
          expect(pose.x).toBeCloseTo(0);
          expect(pose.y).toBeCloseTo(0);
          expect(pose.rotation).toBeCloseTo(0);
        }
      }
    }
  });

  /** Furthest each of `cards` sliding cards gets from rest, signed. */
  function reaches(cards: number, room?: { left: number; right: number }): number[] {
    const reach = new Array(cards).fill(0);
    for (let elapsed = 0; elapsed <= deckShuffleDuration(cards); elapsed += 4) {
      for (let i = 0; i < cards; i++) {
        const { x } = deckShufflePose(i, elapsed, 67, 94, room);
        if (Math.abs(x) > Math.abs(reach[i])) reach[i] = x;
      }
    }
    return reach;
  }

  it('moves each card out to one side and back, alternating sides', () => {
    const [first, second, third] = reaches(3);
    expect(first).toBeGreaterThan(67 * 0.3);
    expect(second).toBeLessThan(0);
    expect(third).toBeGreaterThan(0);
  });

  it('slides each card less far than the one before, so the pile settles', () => {
    const [first, second, third] = reaches(3).map(Math.abs);
    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
    expect(third).toBeGreaterThan(67 * 0.2);
  });

  it('leaves faster than it tucks back in', () => {
    const peak = reaches(1)[0];
    let peakAt = 0;
    for (let elapsed = 0; elapsed <= deckShuffleDuration(1); elapsed += 1) {
      if (deckShufflePose(0, elapsed, 67, 94).x >= peak - 1e-6) {
        peakAt = elapsed;
        break;
      }
    }
    expect(peakAt).toBeLessThan(deckShuffleDuration(1) / 2);
  });

  it('keeps a tilted sliding card inside the desktop sidebar cell', () => {
    // The cell is 138 wide and the pile is centred in it (see the pile loops
    // in MultiplayerCanvas). A tilted card's corners stick out by `overhang`.
    const cell = 138;
    const overhang = Math.sin((5 * Math.PI) / 180) * (94 / 2) + 0.5;
    for (const count of [2, 3, 4, 20, 60]) {
      const stack = layoutDeckStack(count, 67, 94);
      const cardLeft = (cell - stack.width) / 2 + stack.top.x;
      for (const x of reaches(deckShuffleCards(count))) {
        expect(cardLeft + x - overhang).toBeGreaterThanOrEqual(0);
        expect(cardLeft + 67 + x + overhang).toBeLessThanOrEqual(cell);
      }
    }
  });

  it('slides no further than the room it is given on each side', () => {
    const overhang = Math.sin((5 * Math.PI) / 180) * (94 / 2);
    const [right, left] = reaches(2, { left: 9, right: 14 });
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThanOrEqual(14 - overhang + 1e-9);
    expect(left).toBeLessThan(0);
    expect(-left).toBeLessThanOrEqual(9 - overhang + 1e-9);
  });

  it('only tilts when there is no room at all', () => {
    expect(reaches(3, { left: 0, right: 2 })).toEqual([0, 0, 0]);
    const mid = deckShufflePose(0, 120, 67, 94, { left: 0, right: 2 });
    expect(mid.x).toBe(0);
    expect(Math.abs(mid.rotation)).toBeGreaterThan(1);
  });

  it('is unchanged by room that is more than it needs', () => {
    expect(reaches(3, { left: 500, right: 500 })).toEqual(reaches(3));
  });

  it('starts the cards one after another', () => {
    const early = 60;
    expect(Math.abs(deckShufflePose(0, early, 67, 94).x)).toBeGreaterThan(0);
    expect(deckShufflePose(1, early, 67, 94).x).toBeCloseTo(0);
    expect(deckShufflePose(2, early, 67, 94).x).toBeCloseTo(0);
  });
});
