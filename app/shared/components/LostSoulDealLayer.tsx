'use client';

import { useEffect, useRef } from 'react';
import { Group, Image as KonvaImage, Rect } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { FLIGHT_DURATION_MS, type DealFlight } from '../utils/lostSoulDeal';

export interface SoulDeal {
  id: string;
  image: HTMLImageElement | undefined;
  cardWidth: number;
  cardHeight: number;
  /** 0 for the local seat's LOB, 180 for the opponent's (matches settled node). */
  rotation: number;
  flight: DealFlight;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Transient overlay that "deals" newly-arrived Lost Souls from the deck into
 * their LOB slot. Each flyer runs one imperative Konva tween (center-anchored
 * so rotation/scale pivot on the card center) and calls `onLand(id)` when it
 * finishes. Lives on the game layer, above the settled cards, unclipped and
 * non-interactive so it can cross the zone boundary mid-flight.
 */
export function LostSoulDealLayer({
  deals,
  onLand,
  durationMs = FLIGHT_DURATION_MS,
}: {
  deals: SoulDeal[];
  onLand: (id: string) => void;
  durationMs?: number;
}) {
  return (
    <Group listening={false}>
      {deals.map((deal) => (
        <DealFlyer key={deal.id} deal={deal} durationMs={durationMs} onLand={onLand} />
      ))}
    </Group>
  );
}

function DealFlyer({
  deal,
  durationMs,
  onLand,
}: {
  deal: SoulDeal;
  durationMs: number;
  onLand: (id: string) => void;
}) {
  const groupRef = useRef<Konva.Group | null>(null);
  const { flight, id, image } = deal;

  useEffect(() => {
    const node = groupRef.current;
    // No node, no image, or reduced motion → skip the flight and hand off
    // immediately so the settled node + glow take over without delay.
    if (!node || !image || prefersReducedMotion()) {
      onLand(id);
      return;
    }

    node.position({ x: flight.from.x, y: flight.from.y });
    node.scale({ x: flight.startScale, y: flight.startScale });

    let tween: Konva.Tween | null = null;
    const timer = setTimeout(() => {
      tween = new KonvaLib.Tween({
        node,
        duration: durationMs / 1000,
        x: flight.to.x,
        y: flight.to.y,
        scaleX: flight.endScale,
        scaleY: flight.endScale,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: () => onLand(id),
      });
      tween.play();
    }, flight.delayMs);

    return () => {
      clearTimeout(timer);
      tween?.destroy();
    };
    // Start once per flyer; a live layout reflow does not restart the tween.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Group
      ref={groupRef as any}
      x={flight.from.x}
      y={flight.from.y}
      offsetX={deal.cardWidth / 2}
      offsetY={deal.cardHeight / 2}
      rotation={deal.rotation}
      scaleX={flight.startScale}
      scaleY={flight.startScale}
      listening={false}
    >
      {image ? (
        <KonvaImage
          image={image}
          width={deal.cardWidth}
          height={deal.cardHeight}
          cornerRadius={4}
          perfectDrawEnabled={false}
        />
      ) : (
        <Rect
          width={deal.cardWidth}
          height={deal.cardHeight}
          fill="#2a1f12"
          stroke="#6b4e27"
          strokeWidth={1}
          cornerRadius={4}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
}
