'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameCard } from '@/app/shared/types/gameCard';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

export interface ResurrectHeroesPage {
  ownerId: string;
  playerName: string;
  heroes: GameCard[];
  /** Drag-out handlers (same infra the zone-browse modals use). When provided,
   *  cards on this page can be dragged onto the canvas; a plain click still
   *  toggles selection. The didDragRef lets us tell a click from a drag. */
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
}

interface ResurrectHeroesModalProps {
  /** One page per player present, source card's owner first. */
  pages: ResurrectHeroesPage[];
  onConfirm: (selectedInstanceIds: string[]) => void;
  onCancel: () => void;
  /** True while a card from this modal is being dragged onto the canvas.
   *  Mirrors ZoneBrowseModal — the modal fades + goes pointer-through during
   *  the drag and (unless "Leave open") closes when it ends. */
  isDragActive?: boolean;
}

/**
 * Interactive picker for the `resurrect_heroes` ability. Shows one tab per
 * player; each tab lists that player's Heroes in their discard pile. Selection
 * is a single set spanning all tabs (switching tabs preserves picks). On
 * confirm the selected Heroes return to their own owner's Territory. Cards can
 * also be dragged out onto the canvas (when the page supplies drag handlers).
 */
export function ResurrectHeroesModal({ pages, onConfirm, onCancel, isDragActive }: ResurrectHeroesModalProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pointerDownCardRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Refs so the drag-end effect only re-runs on the isDragActive transition,
  // not when these callbacks/flags change identity between renders.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const leaveOpenRef = useRef(leaveOpen);
  leaveOpenRef.current = leaveOpen;

  // Close once a drag completes (isDragActive true → false), unless "Leave
  // open" is checked — matching the zone-browse modals. Also reset the shared
  // didDrag refs so a later outside-click isn't mistaken for a drag.
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      pages.forEach((p) => { if (p.didDragRef) p.didDragRef.current = false; });
      if (!leaveOpenRef.current) onCancelRef.current();
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive, pages]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Every Hero id currently present across all pages (drag-out can remove some).
  const allHeroIds = useMemo(
    () => pages.flatMap((p) => p.heroes.map((h) => h.instanceId)),
    [pages],
  );
  const allHeroIdSet = useMemo(() => new Set(allHeroIds), [allHeroIds]);

  // Only count/commit selections that still exist (a dragged-out card vanishes).
  const validSelected = useMemo(
    () => [...selected].filter((id) => allHeroIdSet.has(id)),
    [selected, allHeroIdSet],
  );
  const countsByTab = useMemo(
    () => pages.map((p) => p.heroes.filter((h) => selected.has(h.instanceId)).length),
    [pages, selected],
  );

  const page = pages[activeTab];
  const totalSelected = validSelected.length;

  const toggle = (instanceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });
  };

  const handlePointerDown = (hero: GameCard, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pointerDownCardRef.current = hero.instanceId;
    if (page?.didDragRef) page.didDragRef.current = false;

    // Multi-drag when the pressed card is part of a multi-selection on THIS page.
    const selectedOnPage = page?.heroes.filter((h) => selected.has(h.instanceId)) ?? [];
    if (selected.has(hero.instanceId) && selectedOnPage.length > 1 && page?.onStartMultiDrag) {
      page.onStartMultiDrag(
        selectedOnPage.map((c) => ({ card: c, imageUrl: getCardImageUrl(c.cardImgFile) })),
        e,
      );
    } else if (page?.onStartDrag) {
      page.onStartDrag(hero, getCardImageUrl(hero.cardImgFile), e);
    }
  };

  const handlePointerUp = (hero: GameCard) => {
    // Only a click (no drag) on the same card toggles selection.
    if (pointerDownCardRef.current !== hero.instanceId) return;
    pointerDownCardRef.current = null;
    if (page?.didDragRef?.current) {
      page.didDragRef.current = false;
      return;
    }
    toggle(hero.instanceId);
  };

  return (
    <div
      // Full-area backdrop. Catches outside clicks directly (robust against
      // canvas event handling). Goes pointer-through while dragging so the drop
      // reaches the board below.
      data-blocking-prompt
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: isDragActive ? 'none' : 'auto',
      }}
    >
      <div
        ref={contentRef}
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '18px 22px',
          width: 'min(680px, 90vw)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          // While dragging a card out, fade and go pointer-through so the board
          // (and the drop target) is visible — matches ZoneBrowseModal.
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            fontSize: 16,
            color: 'var(--gf-text-bright)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            marginBottom: 14,
          }}
        >
          Resurrect Heroes
        </div>

        {/* Player tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {pages.map((p, i) => {
            const isActive = i === activeTab;
            const count = countsByTab[i];
            return (
              <button
                key={p.ownerId}
                onClick={() => setActiveTab(i)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: isActive ? '1px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                  background: isActive ? 'var(--gf-hover)' : 'transparent',
                  color: 'var(--gf-text-bright)',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {p.playerName}
                {count > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      background: 'var(--gf-accent)',
                      color: 'var(--gf-bg-dark)',
                      borderRadius: 999,
                      padding: '1px 7px',
                      fontWeight: 600,
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Hero grid for the active tab */}
        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 16 }}>
          {!page || page.heroes.length === 0 ? (
            <div
              style={{
                padding: '32px 0',
                textAlign: 'center',
                color: 'var(--gf-text-dim)',
                fontSize: 13,
              }}
            >
              No Heroes in this discard pile.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 10,
              }}
            >
              {page.heroes.map((hero) => {
                const imageUrl = getCardImageUrl(hero.cardImgFile);
                const isSelected = selected.has(hero.instanceId);
                return (
                  <div
                    key={hero.instanceId}
                    onPointerDown={(e) => handlePointerDown(hero, e)}
                    onPointerUp={() => handlePointerUp(hero)}
                    title={hero.cardName}
                    style={{ position: 'relative', cursor: 'grab', touchAction: 'none' }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={hero.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
                          borderRadius: 4,
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: isSelected ? '0 0 8px rgba(var(--gf-accent-rgb), 0.5)' : 'none',
                          opacity: isSelected ? 1 : 0.85,
                          transition: 'border 0.1s ease, opacity 0.1s ease',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: 'var(--gf-bg-dark)',
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--gf-text-dim)',
                          fontSize: 10,
                          padding: 4,
                          textAlign: 'center',
                          pointerEvents: 'none',
                        }}
                      >
                        {hero.cardName}
                      </div>
                    )}
                    {isSelected && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          background: 'var(--gf-accent)',
                          color: 'var(--gf-bg-dark)',
                          fontSize: 13,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
                          pointerEvents: 'none',
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={() => onConfirm(allHeroIds)}
              disabled={allHeroIds.length === 0}
              title="Resurrect every Hero from all discard piles"
              style={btnStyle('secondary', allHeroIds.length === 0)}
              onMouseEnter={(e) => { if (allHeroIds.length > 0) e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Resurrect All{allHeroIds.length > 0 ? ` (${allHeroIds.length})` : ''}
            </button>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--gf-text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Keep this picker open after dragging a Hero out"
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: leaveOpen ? '1.5px solid var(--gf-accent)' : '1.5px solid var(--gf-border)',
                  background: leaveOpen ? 'var(--gf-hover-strong)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {leaveOpen && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.5 7.5L8 3" stroke="var(--gf-text-bright)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                checked={leaveOpen}
                onChange={(e) => setLeaveOpen(e.target.checked)}
                className="sr-only"
              />
              Leave open
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onCancel}
              style={btnStyle('ghost', false)}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(validSelected)}
              disabled={totalSelected === 0}
              style={btnStyle('primary', totalSelected === 0)}
              onMouseEnter={(e) => { if (totalSelected > 0) e.currentTarget.style.background = 'var(--gf-accent)'; }}
              onMouseLeave={(e) => { if (totalSelected > 0) e.currentTarget.style.background = 'var(--gf-accent)'; }}
            >
              Resurrect{totalSelected > 0 ? ` (${totalSelected})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Three button variants, all in the goldfish parchment palette. */
function btnStyle(variant: 'primary' | 'secondary' | 'ghost', disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'var(--font-cinzel), Georgia, serif',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.1s ease, border 0.1s ease',
  };
  if (variant === 'primary') {
    return {
      ...base,
      border: '1px solid var(--gf-accent)',
      background: disabled ? 'transparent' : 'var(--gf-accent)',
      color: disabled ? 'var(--gf-text-dim)' : 'var(--gf-bg-dark)',
      opacity: disabled ? 0.6 : 1,
    };
  }
  // secondary + ghost share the bordered-pill look; ghost is a touch quieter.
  return {
    ...base,
    border: '1px solid var(--gf-border)',
    background: 'transparent',
    color: variant === 'ghost' ? 'var(--gf-text-dim)' : 'var(--gf-text-bright)',
    opacity: disabled ? 0.5 : 1,
  };
}
