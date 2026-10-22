'use client';

import { useContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Search, Shuffle, Eye, Sparkles, Trash2, Archive, ChevronRight, Play, Undo2 } from 'lucide-react';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import {
  SubMenuActionRow,
  SubmenuLockContext,
  ActiveSubmenuContext,
  ITEM_STYLE,
  SEPARATOR_STYLE,
  STEPPER_BTN_STYLE,
  GO_BTN_STYLE,
  hoverEnter,
  hoverLeave,
} from './SubMenuActionRow';
import { anchorContextMenu } from './contextMenuPosition';

interface DeckContextMenuProps {
  x: number;
  y: number;
  deckSize: number;
  onClose: () => void;
  onSearchDeck: () => void;
  onShuffleDeck: () => void;
  onDrawTop: (count: number) => void;
  onRevealTop: (count: number) => void;
  onDiscardTop: (count: number) => void;
  onReserveTop: (count: number) => void;
  onDrawBottom: (count: number) => void;
  onRevealBottom: (count: number) => void;
  onDiscardBottom: (count: number) => void;
  onReserveBottom: (count: number) => void;
  onDrawRandom: (count: number) => void;
  onRevealRandom: (count: number) => void;
  onDiscardRandom: (count: number) => void;
  onReserveRandom: (count: number) => void;
  onLookAtTop?: (count: number) => void;
  onLookAtBottom?: (count: number) => void;
  onLookAtRandom?: (count: number) => void;
  /** Name of the face-up top deck card while it qualifies for a direct
   *  add-to-hand — The Foretelling Angel's "If it's a Daniel card, you may
   *  add it to hand", so callers pass it only while the top-deck reveal
   *  toggle is on AND the top card is a Daniel card. Renders an extra
   *  "Add <name> to hand" item above Search Deck that fires onDrawTop(1);
   *  omitted = no item. */
  revealedTopCardName?: string;
  /** Philip's Daughters: present while the local player's half can still be
   *  taken back. Renders an "Undo Philip's Daughters" item at the top — the
   *  responder never right-clicks the caster's card, so their own deck is
   *  where they'd look. Omitted = no item. */
  onUndoKeepOne?: () => void;
  /** When true, hides all draw-related actions (for opponent's deck) */
  hideDrawActions?: boolean;
  /** When true, hides the Discard row inside each Top/Bottom/Random submenu */
  hideDiscardActions?: boolean;
  /** When true, hides the Reserve row inside each Top/Bottom/Random submenu */
  hideReserveActions?: boolean;
}

const SUBMENU_STYLE: React.CSSProperties = {
  position: 'fixed',
  background: 'var(--gf-bg)',
  border: '1px solid var(--gf-border)',
  borderRadius: 6,
  padding: '4px 0',
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
  whiteSpace: 'nowrap',
  zIndex: 910,
  // Backstop for the case the clamp cannot solve: a submenu taller than the
  // screen (five rows with a stepper open, on a short phone) scrolls.
  maxHeight: 'calc(100dvh - 16px)',
  overflowY: 'auto',
};

function SubmenuTrigger({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(ActiveSubmenuContext);
  const isOpen = ctx?.active === label;
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number } | null>(null);

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const sub = submenuRef.current;
    if (!trigger || !sub) return;
    const tRect = trigger.getBoundingClientRect();
    const sRect = sub.getBoundingClientRect();
    const MARGIN = 8;
    let left = tRect.left - sRect.width - 2;
    if (left < MARGIN) left = tRect.right + 2;
    // Clamp on-screen: in the touch bottom sheet the trigger row is
    // full-width, so "beside the trigger" is past the viewport edge — the
    // submenu floats over the sheet's right side instead.
    left = Math.min(left, window.innerWidth - sRect.width - MARGIN);
    if (left < MARGIN) left = MARGIN;
    let top = tRect.top - 4;
    const maxTop = window.innerHeight - sRect.height - MARGIN;
    if (top > maxTop) top = maxTop;
    if (top < MARGIN) top = MARGIN;
    setFixedPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setFixedPos(null);
      return;
    }
    position();
    // The submenu grows when a row's X expander opens its stepper. Positioning
    // only on open left the new rows hanging below the screen edge with no
    // scroll container to reach them, so re-clamp whenever it resizes.
    const sub = submenuRef.current;
    if (!sub || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => position());
    ro.observe(sub);
    return () => ro.disconnect();
  }, [isOpen, position]);

  const lock = useCallback(() => { lockedRef.current = true; }, []);
  const unlock = useCallback(() => { lockedRef.current = false; }, []);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    };
  }, []);

  // Touch: hover never means anything real — after a tap Chrome clears its
  // synthetic hover state, firing a mouseleave that closed the submenu the tap
  // had just opened. On touch only the tap toggle (and closing the whole menu)
  // dismisses a submenu.
  const isTouch = useInputMode() === 'touch';

  const showSub = () => {
    if (ctx?.closeTimerRef.current) { clearTimeout(ctx.closeTimerRef.current); ctx.closeTimerRef.current = null; }
    if (isOpen) return;
    // Touch: the browser's synthesized mouseenter would start this timer and
    // race the tap toggle below — whichever lost, the submenu ended up shut.
    // Hover is meaningless here, so the tap is the only opener.
    if (isTouch) return;
    if (!openTimerRef.current) {
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        ctx?.setActive(label);
      }, ctx?.active ? 300 : 180);
    }
  };

  const hideSub = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    if (lockedRef.current || isTouch) return;
    if (ctx) {
      ctx.closeTimerRef.current = setTimeout(() => ctx.setActive(null), 400);
    }
  };

  return (
    <div
      ref={triggerRef}
      onMouseEnter={showSub}
      onMouseLeave={hideSub}
    >
      <div
        style={ITEM_STYLE}
        onMouseEnter={(e) => { hoverEnter(e); showSub(); }}
        onMouseLeave={(e) => { hoverLeave(e); }}
        // Tap toggle: hover never fires on touch, so without this the
        // submenus were unreachable even once the deck sheet opened.
        onClick={() => {
          if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
          ctx?.setActive(isOpen ? null : label);
        }}
      >
        <ChevronRight size={12} style={{ opacity: 0.6, transform: 'rotate(180deg)' }} />
        <span>{label}</span>
      </div>
      {isOpen && (
        <div
          ref={submenuRef}
          style={{
            ...SUBMENU_STYLE,
            top: fixedPos?.top ?? -9999,
            left: fixedPos?.left ?? -9999,
            visibility: fixedPos ? 'visible' : 'hidden',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseEnter={showSub}
          onMouseLeave={hideSub}
        >
          <SubmenuLockContext.Provider value={{ lock, unlock }}>
            {children}
          </SubmenuLockContext.Provider>
        </div>
      )}
    </div>
  );
}

export function DeckContextMenu({
  x, y, deckSize, onClose,
  onSearchDeck, onShuffleDeck,
  onDrawTop, onRevealTop, onDiscardTop, onReserveTop,
  onDrawBottom, onRevealBottom, onDiscardBottom, onReserveBottom,
  onDrawRandom, onRevealRandom, onDiscardRandom, onReserveRandom,
  onLookAtTop,
  onLookAtBottom,
  onLookAtRandom,
  revealedTopCardName,
  onUndoKeepOne,
  hideDrawActions,
  hideDiscardActions,
  hideReserveActions,
}: DeckContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDrawX, setShowDrawX] = useState(false);
  const [drawXCount, setDrawXCount] = useState(3);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure the rendered menu, then anchor it on the cursor. Measuring matters:
  // the menu's height changes with the Draw X expander and the opponent-deck
  // variant, and a guessed height is what used to pin the menu to a fixed line.
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const { left, top } = anchorContextMenu(x, y, { width, height }, { width: window.innerWidth, height: window.innerHeight });
    setPos({ left, top, ready: true });
    // Re-measure when Draw X expands: the taller menu keeps the same anchor if
    // it still fits, and only lifts if the expander pushed it off the bottom.
  }, [x, y, showDrawX]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef} data-context-menu
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
        visibility: pos.ready ? 'visible' : 'hidden',
      }}
    >
      {onUndoKeepOne && (
        <>
          <button style={ITEM_STYLE} onClick={onUndoKeepOne} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <Undo2 size={14} />
            Undo Philip’s Daughters
          </button>
          <div style={SEPARATOR_STYLE} />
        </>
      )}
      {revealedTopCardName && !hideDrawActions && (
        <>
          <button style={ITEM_STYLE} onClick={() => onDrawTop(1)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <Play size={14} />
            Add {revealedTopCardName} to hand
          </button>
          <div style={SEPARATOR_STYLE} />
        </>
      )}
      <button style={ITEM_STYLE} onClick={onSearchDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Search size={14} />
        Search Deck
      </button>
      {!hideDrawActions && (
        <>
          <button style={ITEM_STYLE} onClick={() => onDrawTop(1)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <Play size={14} />
            Draw 1
          </button>
          <button style={ITEM_STYLE} onClick={() => setShowDrawX(!showDrawX)} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
            <Play size={14} />
            Draw X...
          </button>
          {showDrawX && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 14px 6px' }}>
              <button
                style={{ ...STEPPER_BTN_STYLE, opacity: drawXCount <= 1 ? 0.3 : 1 }}
                onClick={() => setDrawXCount(Math.max(1, drawXCount - 1))}
              >
                &minus;
              </button>
              <span style={{ width: 24, textAlign: 'center', color: 'var(--gf-text-bright)', fontSize: 13, fontWeight: 'bold', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
                {drawXCount}
              </span>
              <button
                style={{ ...STEPPER_BTN_STYLE, opacity: drawXCount >= deckSize ? 0.3 : 1 }}
                onClick={() => setDrawXCount(Math.min(deckSize, drawXCount + 1))}
              >
                +
              </button>
              <button style={GO_BTN_STYLE} onClick={() => onDrawTop(drawXCount)}>Go</button>
            </div>
          )}
        </>
      )}

      <div style={SEPARATOR_STYLE} />
      <ActiveSubmenuContext.Provider value={{ active: activeSubmenu, setActive: setActiveSubmenu, closeTimerRef: submenuCloseTimerRef }}>
        <SubmenuTrigger label="Top Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawTop} />}
          {onLookAtTop && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtTop} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealTop} />
          {!hideDiscardActions && <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardTop} />}
          {!hideReserveActions && <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveTop} />}
        </SubmenuTrigger>
        <SubmenuTrigger label="Bottom Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawBottom} />}
          {onLookAtBottom && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtBottom} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealBottom} />
          {!hideDiscardActions && <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardBottom} />}
          {!hideReserveActions && <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveBottom} />}
        </SubmenuTrigger>
        <SubmenuTrigger label="Random Card">
          {!hideDrawActions && <SubMenuActionRow icon={<Play size={14} />} label="Draw" max={deckSize} onAction={onDrawRandom} />}
          {onLookAtRandom && <SubMenuActionRow icon={<Eye size={14} />} label="Look" max={deckSize} onAction={onLookAtRandom} />}
          <SubMenuActionRow icon={<Sparkles size={14} />} label="Reveal" max={deckSize} onAction={onRevealRandom} />
          {!hideDiscardActions && <SubMenuActionRow icon={<Trash2 size={14} />} label="Discard" max={deckSize} onAction={onDiscardRandom} />}
          {!hideReserveActions && <SubMenuActionRow icon={<Archive size={14} />} label="Reserve" max={deckSize} onAction={onReserveRandom} />}
        </SubmenuTrigger>
      </ActiveSubmenuContext.Provider>

      <div style={SEPARATOR_STYLE} />
      <button style={ITEM_STYLE} onClick={onShuffleDeck} onMouseEnter={hoverEnter} onMouseLeave={hoverLeave}>
        <Shuffle size={14} />
        Shuffle Deck
      </button>
    </div>
  );
}
