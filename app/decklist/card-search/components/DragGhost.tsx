"use client";

import React from "react";
import { Card } from "../utils";
import { CardThumb } from "./CardThumb";

interface DragGhostProps {
  card: Card;
  /** True while the pointer is in the "drag to remove" zone (left of the deck panel). */
  willRemove?: boolean;
  /** Copies being dragged when it's a multi-card selection; shows a stack and a count. */
  count?: number;
}

/**
 * Visual rendered inside @dnd-kit's <DragOverlay> while a card is being
 * dragged. Just the card image at reduced opacity — no controls. A selection
 * drag adds two offset cards behind it and a copy count.
 * Flips to a red ✕ overlay while in the remove zone (over the search/filter
 * column) to telegraph that releasing there will discard one copy (or the
 * whole selection).
 */
export default function DragGhost({ card, willRemove = false, count }: DragGhostProps) {
  const ghost = (
    <div
      className={`relative rounded-md overflow-hidden shadow-2xl pointer-events-none ring-2 transition-colors ${
        willRemove ? "ring-red-500" : "ring-primary/60"
      }`}
      style={{ width: 96, opacity: count ? 0.85 : 0.6 }}
    >
      <CardThumb
        card={card}
        alt={card.name}
        className="block w-full h-auto"
        crossOrigin="anonymous"
        draggable={false}
      />
      {willRemove && (
        <div className="absolute inset-0 bg-red-600/55 flex items-center justify-center">
          <span className="text-white text-3xl font-bold leading-none drop-shadow">
            ✕
          </span>
        </div>
      )}
    </div>
  );
  if (!count) return ghost;
  return (
    <div className="relative pointer-events-none" style={{ width: 96 }}>
      <div className="absolute inset-0 translate-x-2 translate-y-2 rounded-md bg-muted border border-border shadow-lg" />
      <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-md bg-muted border border-border shadow-lg" />
      {ghost}
      <span className="absolute -top-2 -right-3 min-w-6 h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center shadow">
        {count}
      </span>
    </div>
  );
}
