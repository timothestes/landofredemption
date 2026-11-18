'use client';

import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { CardBackShape } from './GameCardNode';
import { DEAL_FLIGHT_MS } from '../hooks/dealAnimationCore';
import type { ActiveDeal } from '../hooks/useDealAnimation';

export interface DealSpriteSpec {
  deal: ActiveDeal;
  /** Card top-left at the deck pile, game-layer coords. */
  origin: { x: number; y: number; rotation?: number };
  /** Initial group scale so the back matches the pile card size. */
  originScale: number;
  /** Final hand-slot position/rotation (same values the real card renders with). */
  target: { x: number; y: number; rotation: number };
  cardWidth: number;
  cardHeight: number;
  image: HTMLImageElement | undefined;
}

/** Fraction of the flight elapsed when the back→face flip starts. */
const FLIP_START_FRACTION = 0.3;
const FLIP_SHRINK_S = 0.09;
const FLIP_GROW_S = 0.14;

function DealSprite({
  spec,
  onLanded,
}: {
  spec: DealSpriteSpec;
  onLanded: (instanceId: string) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const flipRef = useRef<Konva.Group | null>(null);
  const [showFace, setShowFace] = useState(false);

  // Mount-only animation: a sprite's spec is fixed for its lifetime — the
  // parent keys sprites by instanceId and unmounts them when the deal ends.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    let cancelled = false;
    const tweens: Konva.Tween[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const land = () => {
      if (!cancelled) onLanded(spec.deal.instanceId);
    };

    g.visible(false);
    const wait = Math.max(0, spec.deal.startAt - performance.now());
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        const node = groupRef.current;
        if (!node) return;
        node.visible(true);
        const flight = new KonvaLib.Tween({
          node,
          duration: DEAL_FLIGHT_MS / 1000,
          x: spec.target.x,
          y: spec.target.y,
          rotation: spec.target.rotation,
          scaleX: 1,
          scaleY: 1,
          easing: KonvaLib.Easings.EaseOut,
          onFinish: land,
        });
        tweens.push(flight);
        flight.play();

        // Mid-flight flip: shrink the inner group to a sliver, swap the back
        // for the face, grow it again. Without a face image the card simply
        // stays a card back for the whole flight.
        if (spec.image) {
          timers.push(
            setTimeout(() => {
              const f = flipRef.current;
              if (cancelled || !f) return;
              const shrink = new KonvaLib.Tween({
                node: f,
                duration: FLIP_SHRINK_S,
                scaleX: 0,
                onFinish: () => {
                  if (cancelled) return;
                  setShowFace(true);
                  const fl = flipRef.current;
                  if (!fl) return;
                  const grow = new KonvaLib.Tween({
                    node: fl,
                    duration: FLIP_GROW_S,
                    scaleX: 1,
                  });
                  tweens.push(grow);
                  grow.play();
                },
              });
              tweens.push(shrink);
              shrink.play();
            }, DEAL_FLIGHT_MS * FLIP_START_FRACTION),
          );
        }
      }, wait),
    );

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      for (const t of tweens) t.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Group
      ref={groupRef}
      x={spec.origin.x}
      y={spec.origin.y}
      rotation={spec.origin.rotation ?? 0}
      scaleX={spec.originScale}
      scaleY={spec.originScale}
      // Mounted hidden so the sprite can't paint at the deck pile before its
      // launch effect runs. The prop value never changes, so react-konva never
      // re-applies it — the imperative visible(true) at launch sticks.
      visible={false}
      listening={false}
    >
      {/* offsetX/x pair recenters the flip axis on the card's vertical midline */}
      <Group ref={flipRef} offsetX={spec.cardWidth / 2} x={spec.cardWidth / 2}>
        {showFace && spec.image ? (
          <KonvaImage
            image={spec.image}
            width={spec.cardWidth}
            height={spec.cardHeight}
            cornerRadius={4}
            perfectDrawEnabled={false}
          />
        ) : (
          <CardBackShape width={spec.cardWidth} height={spec.cardHeight} />
        )}
      </Group>
    </Group>
  );
}

/**
 * Overlay of in-flight "deal" sprites — card backs flying from the deck pile
 * to their hand slots, flipping face-up mid-flight. Rendered inside the main
 * scaled game Layer, after the hand, so sprites draw above everything.
 */
export function DealLayer({
  sprites,
  onLanded,
}: {
  sprites: DealSpriteSpec[];
  onLanded: (instanceId: string) => void;
}) {
  if (sprites.length === 0) return null;
  return (
    <Group listening={false}>
      {sprites.map(spec => (
        <DealSprite key={spec.deal.instanceId} spec={spec} onLanded={onLanded} />
      ))}
    </Group>
  );
}
