'use client';

import type { ReactNode } from 'react';
import { Group, Rect } from 'react-konva';
import type { StackPoint } from '../layout/deckStack';

// Card edges seen from the side. Two tones alternate so neighbouring layers
// read as separate cards.
const EDGE_LIGHT = '#ddd3b8';
const EDGE_DARK = '#8f8468';

/**
 * The cards under the top card of a face-down pile, drawn as a stack.
 *
 * Place it at the top card's top-left corner and draw the top card after it.
 * `layers` comes from `layoutDeckStack`. `nextCard` is the back of the card
 * directly under the top one, which shows in full when the top card is
 * dragged away.
 */
export function DeckStackUnderlay({
  layers,
  cardWidth,
  cardHeight,
  nextCard,
}: {
  layers: StackPoint[];
  cardWidth: number;
  cardHeight: number;
  nextCard: ReactNode;
}) {
  if (layers.length === 0) return null;
  const bottom = layers[layers.length - 1];
  const shadow = cardHeight * 0.015;
  const edges: ReactNode[] = [];
  for (let i = layers.length - 1; i >= 1; i--) {
    edges.push(
      <Rect
        key={i}
        x={layers[i].x}
        y={layers[i].y}
        width={cardWidth}
        height={cardHeight}
        fill={i % 2 === 1 ? EDGE_LIGHT : EDGE_DARK}
        cornerRadius={4}
        perfectDrawEnabled={false}
      />,
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
      {edges}
      <Group x={layers[0].x} y={layers[0].y}>{nextCard}</Group>
    </Group>
  );
}
