'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Group, Rect } from 'react-konva';
import Konva from 'konva';
import {
  DECK_SHUFFLE_STALE_MS,
  deckShuffleCards,
  deckShuffleDuration,
  deckShufflePose,
  deckShuffleStart,
  deckStackShade,
  type ShuffleRoom,
  type StackPoint,
} from '../layout/deckStack';

// How dark the cards that slide out during a shuffle are drawn, so they read
// as lying under the top card.
const SLIDING_CARD_SHADE = 0.35;
// How much smaller than the top card they are drawn, in px across.
const SLIDING_CARD_INSET = 3;

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
 * Plays a short shuffle on a pile each time `tick` goes up: a few cards slide
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
  dealing = false,
}: {
  tick: number;
  /** Cards in the pile. */
  count: number;
  cardWidth: number;
  cardHeight: number;
  back: ReactNode;
  /** Free space beside the top card, for a pile with close neighbours. */
  room?: ShuffleRoom;
  /** Cards are flying out of this pile right now. A shuffle waits for them
   *  to land before it plays. */
  dealing?: boolean;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const animationRef = useRef<Konva.Animation | null>(null);
  const seenTick = useRef(tick);
  // A shuffle landed while one was waiting or playing. It plays right after
  // that one: restarting instead would snap the sliding cards back to rest.
  const queued = useRef(false);
  // True while a shuffle is waiting for a deal to land and has not started.
  const waiting = useRef(false);
  // Read by the running animation every frame, so a resize does not restart
  // it and it sees a deal that began in the same update as the shuffle.
  const live = useRef({ cardWidth, cardHeight, room, dealing });
  live.current = { cardWidth, cardHeight, room, dealing };

  // The animation places the sliding cards itself, every frame. They take no
  // position from props, so a re-render mid-shuffle cannot move them.
  useEffect(() => {
    const previous = seenTick.current;
    seenTick.current = tick;
    if (tick < previous) {
      // Shuffles were undone, newest first. The queued one goes first, then
      // one still waiting to start. One already playing finishes.
      let undone = previous - tick;
      if (queued.current) {
        queued.current = false;
        undone--;
      }
      if (undone > 0 && waiting.current) {
        animationRef.current?.stop();
        animationRef.current = null;
        waiting.current = false;
      }
      return;
    }
    if (tick === previous) return;
    const group = groupRef.current;
    const reduceMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!group || reduceMotion) return;
    if (animationRef.current) {
      queued.current = true;
      return;
    }
    let requestedAt = performance.now();
    let lastFrameAt = requestedAt;
    let startedAt = -1;
    // Cards sliding in this run. One added mid-run waits at rest for the next.
    let cards = 0;
    const animation = new Konva.Animation((frame) => {
      const now = performance.now();
      // A long gap since the last frame means the tab was in the background.
      const sinceLastFrame = now - lastFrameAt;
      lastFrameAt = now;
      if (startedAt >= 0 && frame.time - startedAt >= deckShuffleDuration(cards) && queued.current) {
        // This run is over and another shuffle is queued behind it. That one
        // waits for a deal like any other, and is dropped if the tab was in
        // the background.
        queued.current = false;
        if (sinceLastFrame < DECK_SHUFFLE_STALE_MS) {
          startedAt = -1;
          requestedAt = now;
          waiting.current = true;
        }
      }
      if (startedAt < 0) {
        const start = deckShuffleStart(live.current.dealing, now - requestedAt, sinceLastFrame);
        if (start === 'wait') {
          // The cards are at rest under the top card; hide them while it waits.
          if (!group.visible()) return false;
          group.visible(false);
          return;
        }
        waiting.current = false;
        // The clock starts on the frame it plays from, so neither a slow
        // start nor a wait eats into the slide.
        startedAt = frame.time;
        cards = start === 'play' ? group.getChildren().length : 0;
      }
      const elapsed = frame.time - startedAt;
      const done = elapsed >= deckShuffleDuration(cards);
      const { cardWidth: width, cardHeight: height, room: space } = live.current;
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
    waiting.current = true;
    animation.start();
  }, [tick]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      animationRef.current = null;
      queued.current = false;
      waiting.current = false;
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
