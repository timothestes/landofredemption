/**
 * Geometry for drawing a face-down pile as a stack of cards.
 *
 * The stack is drawn the way it looks from the viewer's seat: the top card
 * sits highest, and every card under it shows a little lower and a little to
 * the left. All sizes are fractions of the card height, so the stack scales
 * with the card.
 */

export interface StackPoint {
  x: number;
  y: number;
}

/** Most layers ever drawn under the top card. */
export const DECK_STACK_MAX_LAYERS = 8;

/** Cards that share one layer once the pile is too big to draw card by card. */
const CARDS_PER_LAYER = 7;

/** Largest pile whose cards each get their own layer. */
const EXACT_UP_TO = 4;

/** How far down the card under the top one shows, as a fraction of card height. */
const PEEK_RATIO = 0.02;

/** How far down each deeper layer shows, as a fraction of card height. */
const STEP_RATIO = 0.0105;

/** Leftward shift of a layer for each unit it drops. */
const LEAN = 0.6;

/** Height of the tallest stack, as a fraction of card height. */
export const DECK_STACK_RESERVE_RATIO = PEEK_RATIO + (DECK_STACK_MAX_LAYERS - 1) * STEP_RATIO;

/**
 * Layers a pile of `count` cards shows under its top card.
 *
 * Up to four cards, each card under the top one is its own layer, so a pile
 * of two looks like two cards. Past that, one layer stands for seven cards,
 * and the stack stops growing at 33.
 */
export function deckStackLayers(count: number): number {
  if (!(count > 1)) return 0;
  if (count <= EXACT_UP_TO) return Math.floor(count) - 1;
  const grouped = EXACT_UP_TO - 1 + Math.ceil((count - EXACT_UP_TO) / CARDS_PER_LAYER);
  return Math.min(DECK_STACK_MAX_LAYERS, grouped);
}

/** How far a stack of `layers` layers drops below its top card. */
function stackDrop(layers: number, cardHeight: number): number {
  if (layers <= 0) return 0;
  return (PEEK_RATIO + (layers - 1) * STEP_RATIO) * cardHeight;
}

/**
 * Tallest card, no taller than `maxCardHeight`, that still leaves room for
 * the tallest stack inside `availableHeight`.
 */
export function fitDeckStackCardHeight(maxCardHeight: number, availableHeight: number): number {
  return Math.min(maxCardHeight, Math.floor(availableHeight / (1 + DECK_STACK_RESERVE_RATIO)));
}

export interface DeckStackLayout {
  /** Size of the box that holds the card plus the tallest stack. */
  width: number;
  height: number;
  /** Top-left of the top card inside that box. */
  top: StackPoint;
  /** Top-left of each layer relative to the top card, nearest layer first. */
  layers: StackPoint[];
}

/**
 * Lay out a pile of `count` cards as a stack.
 *
 * The box is the same size whatever the count, and the bottom card always
 * sits in its bottom-left corner. The top card therefore moves down and left
 * as the pile empties, the way the top of a real stack does.
 */
export function layoutDeckStack(count: number, cardWidth: number, cardHeight: number): DeckStackLayout {
  const reserve = DECK_STACK_RESERVE_RATIO * cardHeight;
  const layerCount = deckStackLayers(count);
  const drop = stackDrop(layerCount, cardHeight);
  const layers: StackPoint[] = [];
  for (let i = 1; i <= layerCount; i++) {
    const y = stackDrop(i, cardHeight);
    layers.push({ x: -LEAN * y, y });
  }
  return {
    width: cardWidth + LEAN * reserve,
    height: cardHeight + reserve,
    top: { x: LEAN * drop, y: reserve - drop },
    layers,
  };
}
