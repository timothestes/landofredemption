'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Group, Rect } from 'react-konva';
import Konva from 'konva';
import {
  deckShuffleCards,
  deckShuffleDuration,
  deckShufflePose,
  deckStackShade,
  type ShuffleRoom,
  type StackPoint,
} from '../layout/deckStack';

// How dark the cards that slide out during a shuffle are drawn, so they read
// as lying under the top card.
const SLIDING_CARD_SHADE = 0.35;
// How much smaller than the top card they are drawn, in px across.
const SLIDING_CARD_INSET = 3;
// A shuffle older than this when its turn to play comes is skipped. It means
// the tab was in the background, and the moment has passed.
const SHUFFLE_STALE_MS = 1000;

/**
 * The cards under the top card of a face-down pile, drawn as a stack.
 *
 * Place it at the top card's top-left corner and draw the top card after it.
 * `layers` comes from `layoutDeckStack`. `back` is one card back, drawn from
 * its own top-left corner. Every layer is that back, and all but the first
 * are darkened, so the stack reads as more of the same cards in shadow.
 */
export function DeckStackUnderlay({
  layers,
  cardWidth,
  cardHeight,
  back,
}: {
  layers: StackPoint[];
  cardWidth: number;
  cardHeight: number;
  back: ReactNode;
}) {
  if (layers.length === 0) return null;
  const bottom = layers[layers.length - 1];
  const shadow = cardHeight * 0.015;
  const cards: ReactNode[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const shade = deckStackShade(i);
    cards.push(
      <Group key={i} x={layers[i].x} y={layers[i].y}>
        {back}
        {shade > 0 && (
          <Rect
            width={cardWidth}
            height={cardHeight}
            fill="#000000"
            opacity={shade}
            cornerRadius={4}
            perfectDrawEnabled={false}
          />
        )}
      </Group>,
    );
  }
  return (
    <Group>
      {/* Shadow where the stack meets the table. */}
      <Rect
        x={bottom.x - shadow}
        y={bottom.y + shadow}
        width={cardWidth}
        height={cardHeight}
        fill="#000000"
        opacity={0.45}
        cornerRadius={4}
        listening={false}
        perfectDrawEnabled={false}
      />
      {cards}
    </Group>
  );
}

/**
 * Plays a short shuffle on a pile each time `tick` changes: a few cards slide
 * out from under the top card and tuck back in. Hidden in between.
 *
 * Place it at the top card's top-left corner, after the underlay and before
 * the top card. `back` is one card back, drawn from its own top-left corner.
 * Give it a `key` that names the deck: when the pile starts showing another
 * deck, that deck's `tick` is a different number without any shuffle.
 */
export function DeckShuffleEffect({
  tick,
  count,
  cardWidth,
  cardHeight,
  back,
  room,
}: {
  tick: number;
  /** Cards in the pile. */
  count: number;
  cardWidth: number;
  cardHeight: number;
  back: ReactNode;
  /** Free space beside the top card, for a pile with close neighbours. */
  room?: ShuffleRoom;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const animationRef = useRef<Konva.Animation | null>(null);
  const seenTick = useRef(tick);
  // When a shuffle landed while one was playing. It plays right after that
  // one: restarting instead would snap the sliding cards back to rest.
  const queuedAt = useRef<number | null>(null);
  // Read by the running animation, so a resize does not restart it.
  const size = useRef({ cardWidth, cardHeight, room });
  size.current = { cardWidth, cardHeight, room };

  // The animation places the sliding cards itself, every frame. They take no
  // position from props, so a re-render mid-shuffle cannot move them.
  useEffect(() => {
    if (tick === seenTick.current) return;
    seenTick.current = tick;
    const group = groupRef.current;
    const reduceMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!group || reduceMotion) return;
    if (animationRef.current) {
      queuedAt.current = performance.now();
      return;
    }
    const requestedAt = performance.now();
    let startedAt = -1;
    // Cards sliding in this run. One added mid-run waits at rest for the next.
    let cards = 0;
    const animation = new Konva.Animation((frame) => {
      const now = performance.now();
      if (startedAt < 0) {
        // The clock starts on the first frame, so a slow start does not eat
        // into the slide.
        startedAt = frame.time;
        cards = now - requestedAt < SHUFFLE_STALE_MS ? group.getChildren().length : 0;
      }
      let elapsed = frame.time - startedAt;
      if (elapsed >= deckShuffleDuration(cards) && queuedAt.current !== null) {
        const fresh = now - queuedAt.current < SHUFFLE_STALE_MS;
        queuedAt.current = null;
        if (fresh) {
          startedAt = frame.time;
          cards = group.getChildren().length;
          elapsed = 0;
        }
      }
      const done = elapsed >= deckShuffleDuration(cards);
      const { cardWidth: width, cardHeight: height, room: space } = size.current;
      group.getChildren().forEach((node, i) => {
        const pose = deckShufflePose(i, i < cards ? elapsed : 0, width, height, space);
        node.setAttrs({
          x: width / 2 + pose.x,
          y: height / 2 + pose.y,
          rotation: pose.rotation,
          visible: true,
        });
      });
      group.visible(!done);
      if (done) {
        animation.stop();
        animationRef.current = null;
      }
    }, group.getLayer());
    animationRef.current = animation;
    animation.start();
  }, [tick]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      animationRef.current = null;
      queuedAt.current = null;
    },
    [],
  );

  return (
    <Group ref={groupRef} visible={false} listening={false}>
      {Array.from({ length: deckShuffleCards(count) }, (_, i) => (
        <Group
          key={i}
          // Shown by the animation once it has placed the card, so one that
          // mounts mid-shuffle is never drawn out of place.
          visible={false}
          offsetX={cardWidth / 2}
          offsetY={cardHeight / 2}
          // A hair smaller than the top card, so a card at rest under it does
          // not show through its soft edge.
          scaleX={1 - SLIDING_CARD_INSET / cardWidth}
          scaleY={1 - SLIDING_CARD_INSET / cardHeight}
        >
          {back}
          <Rect
            width={cardWidth}
            height={cardHeight}
            cornerRadius={4}
            fill="#000000"
            opacity={SLIDING_CARD_SHADE}
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  );
}
