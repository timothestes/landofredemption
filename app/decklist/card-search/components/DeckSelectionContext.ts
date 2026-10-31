import React from "react";
import type { DeckZone } from "../types/deck";
import type { Card } from "../utils";

/** One id per deck entry: its draggable id, lasso hit target, and selection key. */
export function selectionKey(zone: DeckZone, card: Pick<Card, "name" | "set">): string {
  return `${zone}:${card.name}|${card.set}`;
}

export interface DeckSelection {
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  /** True while the selection is being dragged, so every selected card dims. */
  isDraggingSelection: boolean;
}

/** Provided by DeckBuilderPanel; read by each deck card row. */
export const DeckSelectionContext = React.createContext<DeckSelection | null>(null);
