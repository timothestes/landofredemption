'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type Konva from 'konva';
import { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import type { ZoneRect } from '@/app/goldfish/layout/zoneLayout';
import { screenToVirtual } from '@/app/shared/layout/virtualCanvas';

export interface ModalDragState {
  isDragging: boolean;
  card: GameCard | null;
  imageUrl: string;
  // Additional cards being dragged (multi-card). Empty for single-card drag.
  additionalCards: { card: GameCard; imageUrl: string }[];
  // Initial cursor position so ghost can be positioned on first render
  initialX: number;
  initialY: number;
}

interface UseModalCardDragOptions {
  stageRef: React.RefObject<Konva.Stage | null>;
  zoneLayout: Partial<Record<ZoneId, ZoneRect>>;
  findZoneAtPosition: (x: number, y: number) => ZoneId | null;
  moveCard: (instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) => void;
  moveCardsBatch: (cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => void;
  onDeckDrop?: (cardInstanceId: string, screenX: number, screenY: number) => void;
  onBatchDeckDrop?: (cardInstanceIds: string[]) => void;
  cardWidth: number;
  cardHeight: number;
  // Virtual canvas scaling — converts container-relative pixels to virtual coords
  scale: number;
  offsetX: number;
  offsetY: number;
}

const INITIAL_STATE: ModalDragState = {
  isDragging: false,
  card: null,
  imageUrl: '',
  additionalCards: [],
  initialX: 0,
  initialY: 0,
};

export function useModalCardDrag({
  stageRef,
  zoneLayout,
  findZoneAtPosition,
  moveCard,
  moveCardsBatch,
  onDeckDrop,
  onBatchDeckDrop,
  cardWidth,
  cardHeight,
  scale,
  offsetX,
  offsetY,
}: UseModalCardDragOptions) {
  const [dragState, setDragState] = useState<ModalDragState>(INITIAL_STATE);
  const [hoveredZone, setHoveredZone] = useState<ZoneId | null>(null);

  const ghostRef = useRef<HTMLElement>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  // Tracks whether a drag was committed (threshold met) so callers can distinguish click vs drag
  const didDragRef = useRef(false);

  // Tracks whether the last drag ended with a valid drop on a recognized zone
  const validDropRef = useRef(false);

  const pendingDrag = useRef<{
    card: GameCard;
    imageUrl: string;
    startX: number;
    startY: number;
    additionalCards: { card: GameCard; imageUrl: string }[];
  } | null>(null);

  const startDrag = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    validDropRef.current = false;
    pendingDrag.current = {
      card,
      imageUrl,
      startX: e.clientX,
      startY: e.clientY,
      additionalCards: [],
    };
  }, []);

  const startMultiDrag = useCallback((cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => {
    if (e.button !== 0 || cards.length === 0) return;
    e.preventDefault();
    const [primary, ...rest] = cards;
    pendingDrag.current = {
      card: primary.card,
      imageUrl: primary.imageUrl,
      startX: e.clientX,
      startY: e.clientY,
      additionalCards: rest,
    };
  }, []);

  // Position ghost on mount via callback ref effect
  useEffect(() => {
    if (dragState.isDragging && ghostRef.current) {
      ghostRef.current.style.left = `${dragState.initialX - 40}px`;
      ghostRef.current.style.top = `${dragState.initialY - 56}px`;
    }
  }, [dragState.isDragging, dragState.initialX, dragState.initialY]);

  // Attach global listeners
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Check pending drag threshold
      if (pendingDrag.current && !dragRef.current.isDragging) {
        const dx = e.clientX - pendingDrag.current.startX;
        const dy = e.clientY - pendingDrag.current.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) {
          didDragRef.current = true;
          // Commit to drag — store initial position for ghost placement
          setDragState({
            isDragging: true,
            card: pendingDrag.current.card,
            imageUrl: pendingDrag.current.imageUrl,
            additionalCards: pendingDrag.current.additionalCards,
            initialX: e.clientX,
            initialY: e.clientY,
          });
        }
        return;
      }

      // Active drag — update ghost position via DOM ref (no re-render)
      if (dragRef.current.isDragging) {
        if (ghostRef.current) {
          ghostRef.current.style.left = `${e.clientX - 40}px`;
          ghostRef.current.style.top = `${e.clientY - 56}px`;
        }

        // Update hovered zone
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          const stageX = e.clientX - rect.left;
          const stageY = e.clientY - rect.top;
          const virt = screenToVirtual(stageX, stageY, scale, offsetX, offsetY);
          const zone = findZoneAtPosition(virt.x, virt.y);
          setHoveredZone(zone);
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      // If pending but threshold not met, just clear (click will handle it)
      if (pendingDrag.current && !dragRef.current.isDragging) {
        pendingDrag.current = null;
        return;
      }

      // Active drag — check drop target
      if (dragRef.current.isDragging && dragRef.current.card) {
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          const stageX = e.clientX - rect.left;
          const stageY = e.clientY - rect.top;
          const virt = screenToVirtual(stageX, stageY, scale, offsetX, offsetY);
          const targetZone = findZoneAtPosition(virt.x, virt.y);

          if (targetZone) {
            const primary = dragRef.current.card;
            const additional = dragRef.current.additionalCards;
            const isMulti = additional.length > 0;
            const allIds = isMulti
              ? [primary.instanceId, ...additional.map(c => c.card.instanceId)]
              : [primary.instanceId];

            if (targetZone === 'deck') {
              // Intentionally do NOT set validDropRef.current = true here.
              // `validDropRef` is consumed by DeckExchangeModal, which cannot
              // accept "deck" as a valid exchange destination for a card that
              // was just dragged out of the deck. Letting deck drops pass as
              // valid would cause the exchange to complete with no net move.
              if (isMulti && onBatchDeckDrop) {
                onBatchDeckDrop(allIds);
              }
              if (onDeckDrop) {
                // Keep screen coords for HTML popup positioning
                onDeckDrop(primary.instanceId, e.clientX, e.clientY);
              }
            } else if (targetZone === 'reserve' && primary.zone === 'reserve') {
              // Back on its own pile: no move, and — like the deck above — not a
              // valid exchange drop (Exchange with Reserve would otherwise send
              // the source card in with nothing taken out).
            } else if (targetZone === 'territory' || targetZone === 'land-of-bondage') {
              validDropRef.current = true;
              if (isMulti) {
                const baseX = virt.x - cardWidth / 2;
                const baseY = virt.y - cardHeight / 2;
                const FAN_OFFSET = 20;
                const positions: Record<string, { posX: number; posY: number }> = {};
                allIds.forEach((id, i) => {
                  positions[id] = { posX: baseX + i * FAN_OFFSET, posY: baseY };
                });
                moveCardsBatch(allIds, targetZone, positions);
              } else {
                moveCard(primary.instanceId, targetZone, undefined, virt.x - cardWidth / 2, virt.y - cardHeight / 2);
              }
            } else {
              validDropRef.current = true;
              // Pass virtual drop coords so multiplayer callbacks can re-lookup
              // the destination zone's owner (needed for "take from opponent's
              // pile into MY hand/reserve/banish" — the reducer rejects ""
              // newOwnerId and leaves the card on the opponent).
              const dropX = virt.x - cardWidth / 2;
              const dropY = virt.y - cardHeight / 2;
              if (isMulti) {
                const positions: Record<string, { posX: number; posY: number }> = {};
                allIds.forEach((id) => {
                  positions[id] = { posX: dropX, posY: dropY };
                });
                moveCardsBatch(allIds, targetZone, positions);
              } else {
                moveCard(primary.instanceId, targetZone, undefined, dropX, dropY);
              }
            }
          }
        }
      }

      // Reset
      pendingDrag.current = null;
      setDragState(INITIAL_STATE);
      setHoveredZone(null);
    };

    // Touch scrolling fires pointercancel once the browser claims the gesture.
    // Without this reset a scroll that started on a card left an armed (or
    // committed) drag behind, and the NEXT tap anywhere ran onUp's drop logic —
    // committing a phantom card move to wherever that tap landed.
    const onCancel = () => {
      pendingDrag.current = null;
      if (dragRef.current.isDragging) {
        setDragState(INITIAL_STATE);
        setHoveredZone(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [stageRef, findZoneAtPosition, moveCard, moveCardsBatch, onDeckDrop, onBatchDeckDrop, cardWidth, cardHeight, scale, offsetX, offsetY]);

  return { dragState, startDrag, startMultiDrag, hoveredZone, ghostRef, didDragRef, validDropRef };
}
