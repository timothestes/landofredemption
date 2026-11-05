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

/** How dark the first layer in shadow is drawn, from 0 (as it is) to 1 (black). */
const SHADE_FIRST = 0.45;

/** How much darker a layer is than the one two above it. */
const SHADE_STEP = 0.03;

/** Extra darkness on every second layer, so neighbours read as separate cards. */
const SHADE_ALTERNATE = 0.15;

/**
 * How dark to draw layer `layer` of a stack, from 0 (as it is) to 1 (black).
 * Layer 0 is the card straight under the top one.
 *
 * That card is not darkened, because dragging the top card away shows it in
 * full. Every layer below it lies in shadow, darker toward the bottom.
 */
export function deckStackShade(layer: number): number {
  if (!(layer > 0)) return 0;
  return SHADE_FIRST + (layer - 1) * SHADE_STEP + (layer % 2 === 0 ? SHADE_ALTERNATE : 0);
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

// ---------------------------------------------------------------------------
// Shuffle animation: a few cards slide out from under the top card, one after
// another to alternate sides, and tuck back in. Each slides less far than the
// one before, so the pile settles.
// ---------------------------------------------------------------------------

/** Most cards that slide out of a pile when it is shuffled. */
const SHUFFLE_CARDS = 3;
/** How long one card takes to slide out and back, in ms. */
const SHUFFLE_CARD_MS = 360;
/** Delay between one card starting and the next, in ms. */
const SHUFFLE_STAGGER_MS = 120;
/** How far the first card slides out, as a share of the card's width. */
const SHUFFLE_TRAVEL = 0.35;
/** Each card slides this share of the distance of the one before it. */
const SHUFFLE_DECAY = 0.82;
/** How far a card rises at the end of its slide, as a share of its height. */
const SHUFFLE_LIFT = 0.03;
/** How far a card tilts at the end of its slide, in degrees. */
const SHUFFLE_TILT = 5;
/** Above 1, a card leaves quickly and tucks back in more slowly. */
const SHUFFLE_WARP = 1.35;

/**
 * How many cards slide out of a pile of `count` when it is shuffled. The top
 * card stays put, so a single card has nothing to shuffle.
 */
export function deckShuffleCards(count: number): number {
  if (!(count > 1)) return 0;
  return Math.min(SHUFFLE_CARDS, Math.floor(count) - 1);
}

/** How long the shuffle of `cards` sliding cards takes, in ms. */
export function deckShuffleDuration(cards: number): number {
  return cards > 0 ? SHUFFLE_CARD_MS + (cards - 1) * SHUFFLE_STAGGER_MS : 0;
}

/** Free space beside the top card, in the same units as the card's size. */
export interface ShuffleRoom {
  left: number;
  right: number;
}

export interface ShufflePose {
  x: number;
  y: number;
  /** Degrees, clockwise, about the card's centre. */
  rotation: number;
}

/**
 * Where sliding card `index` is `elapsedMs` into the shuffle, relative to its
 * place under the top card. It rests there before its turn and after it.
 *
 * Give `room` for a pile with close neighbours: the card then slides no
 * further than the free space on its side, down to a tilt in place.
 */
export function deckShufflePose(
  index: number,
  elapsedMs: number,
  cardWidth: number,
  cardHeight: number,
  room?: ShuffleRoom,
): ShufflePose {
  const progress = Math.min(1, Math.max(0, (elapsedMs - index * SHUFFLE_STAGGER_MS) / SHUFFLE_CARD_MS));
  const warped = 1 - Math.pow(1 - progress, SHUFFLE_WARP);
  // 0 → peak → 0, at rest at both ends and at the turn.
  const out = (Math.pow(SHUFFLE_DECAY, index) * (1 - Math.cos(2 * Math.PI * warped))) / 2;
  const side = index % 2 === 0 ? 1 : -1;
  let reach = SHUFFLE_TRAVEL * cardWidth;
  if (room) {
    // A tilted card's corners stick out sideways by this much.
    const overhang = Math.sin((SHUFFLE_TILT * Math.PI) / 180) * (cardHeight / 2);
    reach = Math.max(0, Math.min(reach, (side > 0 ? room.right : room.left) - overhang));
  }
  return {
    x: side * reach * out,
    y: -SHUFFLE_LIFT * cardHeight * out,
    rotation: side * SHUFFLE_TILT * out,
  };
}
