'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import {
  Play,
  Undo2,
  RotateCcw,
  PanelBottomOpen,
  Dices,
  SkipForward,
  Hand,
  BookOpen,
  Skull,
  ThumbsUp,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import type { GameActions } from '../types/gameActions';
import { SeatSwapPill } from '@/app/play/components/SeatSwapPill';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GameToolbarProps {
  /** Game action dispatcher (shared interface). */
  actions: GameActions;
  /** Which mode the toolbar is rendering in. */
  mode: 'goldfish' | 'multiplayer';
  /** Whether it's the local player's turn (multiplayer only). */
  isMyTurn?: boolean;
  /** Whether the hand is in "spread" / "unfanned" layout. */
  isSpreadHand: boolean;
  /** Toggle spread hand layout. */
  onToggleSpreadHand: () => void;
  /** Cards remaining in deck. */
  deckCount: number;
  /** Cards currently in hand. */
  handCount: number;
  /** Called to trigger a dice roll animation. */
  onRollDice: () => void;
  /** Called to show a toast message (e.g. "Deck is empty"). */
  onShowToast?: (message: string) => void;
  /** Called for undo. */
  onUndo?: () => void;
  /** Number of available undo entries (multiplayer only — shows count badge). */
  undoCount?: number;
  /** Called for new game (goldfish only). */
  onNewGame?: () => void;
  /** Called for end turn (multiplayer only). */
  onEndTurn?: () => void;
  /** Called to request action priority (multiplayer, non-active player only). */
  onRequestPriority?: () => void;
  /** Whether a priority request is currently pending. */
  hasPendingPriority?: boolean;
  /** Called to request battle initiative for self (multiplayer, any player). */
  onRequestInitiative?: () => void;
  /** Whether an initiative request is currently pending. */
  hasPendingInitiative?: boolean;
  /** Called to pass battle initiative to the opponent (multiplayer, any player). Instant — no approval handshake. */
  onPassInitiative?: () => void;
  /** Called to send a player emote (multiplayer only). Fire-and-forget. */
  onSendEmote?: (kind: string) => void;
  /** Game is finished — keep toolbar active for review but disable end turn. */
  isFinished?: boolean;
  /** Phase Stops: a hold is freezing turn progression (multiplayer only).
   *  Disables End Turn for the active player and hides Priority for the
   *  holder — requesting a window you already hold is noise. */
  isTurnHeld?: boolean;
  /** Solo game only (one human holds both seats): adds the seat-swap pill
   *  (shortcut W, handled by the page) and drops the initiative/priority
   *  buttons, which ask the other human. Goldfish and two-human games omit it. */
  soloSeat?: { deckName: string; onSwap: () => void };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameToolbar({
  actions,
  mode,
  isMyTurn,
  isSpreadHand,
  onToggleSpreadHand,
  deckCount,
  handCount,
  onRollDice,
  onShowToast,
  onUndo,
  undoCount,
  onNewGame,
  onEndTurn,
  onRequestPriority,
  hasPendingPriority,
  onRequestInitiative,
  hasPendingInitiative,
  onPassInitiative,
  onSendEmote,
  isFinished,
  isTurnHeld,
  soloSeat,
}: GameToolbarProps) {
  const isMultiplayer = mode === 'multiplayer';
  const disabled = isMultiplayer && !isMyTurn && !isFinished;

  const [emoteCoolingDown, setEmoteCoolingDown] = useState(false);
  const handleSendEmote = useCallback(() => {
    if (emoteCoolingDown) return;
    onSendEmote?.('thumbs_up');
    setEmoteCoolingDown(true);
    setTimeout(() => setEmoteCoolingDown(false), 2000);
  }, [emoteCoolingDown, onSendEmote]);

  const handleDraw = useCallback(() => {
    if (handCount >= 16) {
      onShowToast?.('Hand is full (max 16 cards)');
      return;
    }
    if (deckCount === 0) {
      onShowToast?.('Deck is empty');
      return;
    }
    actions.drawCard();
  }, [actions, handCount, deckCount, onShowToast]);

  const handleRollDice = useCallback(() => {
    onRollDice();
  }, [onRollDice]);

  // Build button list — filter based on mode
  interface ToolbarButton {
    icon: typeof Play;
    key: string;
    label: string;
    onClick: () => void;
    shortcut: string;
    disabled?: boolean;
    hidden?: boolean;
    pushRight?: boolean;
  }

  const buttons: ToolbarButton[] = [
    {
      icon: Play,
      key: 'draw',
      label: 'Draw',
      onClick: handleDraw,
      shortcut: 'D',
    },
    {
      icon: Dices,
      key: 'roll',
      label: 'Roll',
      onClick: handleRollDice,
      shortcut: 'R',
    },
    // Undo — available in both modes
    {
      icon: Undo2,
      key: 'undo',
      label: 'Undo',
      onClick: onUndo ?? (() => {}),
      shortcut: '\u2318Z',
      disabled: isMultiplayer ? !undoCount || undoCount === 0 : false,
    },
    {
      icon: PanelBottomOpen,
      key: 'fan',
      label: isSpreadHand ? 'Fan' : 'Unfan',
      onClick: onToggleSpreadHand,
      shortcut: 'H',
    },
    // New Game — goldfish only
    {
      icon: RotateCcw,
      key: 'newgame',
      label: 'New Game',
      onClick: onNewGame ?? (() => {}),
      shortcut: '',
      hidden: isMultiplayer,
    },
    // Your initiative (give to opponent) — instant, no handshake. Icon
    // shows the opponent's current role: skull on my turn (they're defending),
    // book on their turn (they're attacking).
    ...(isMultiplayer && !isFinished && !soloSeat ? [{
      icon: isMyTurn ? Skull : BookOpen,
      key: 'your-initiative',
      label: 'Your init',
      onClick: onPassInitiative ?? (() => {}),
      shortcut: '',
    }] : []),
    // My initiative (request from opponent) — request/approve handshake.
    // Icon shows my current role: book on my turn (I'm attacking), skull
    // on their turn (I'm defending).
    ...(isMultiplayer && !isFinished && !soloSeat ? [{
      icon: isMyTurn ? BookOpen : Skull,
      key: 'my-initiative',
      label: hasPendingInitiative ? 'Pending...' : 'My init',
      onClick: onRequestInitiative ?? (() => {}),
      shortcut: '',
      disabled: !!hasPendingInitiative,
    }] : []),
    // OK / thumbs-up emote — multiplayer only, 2s client-side cooldown
    ...(isMultiplayer && !isFinished && onSendEmote ? [{
      icon: ThumbsUp,
      key: 'emote-thumbs-up',
      label: 'OK',
      onClick: handleSendEmote,
      shortcut: '',
      disabled: emoteCoolingDown,
    }] : []),
    // End Turn (active player) or Priority (non-active player) — multiplayer only,
    // anchored to the far right of the toolbar
    ...(isMultiplayer && isMyTurn && !isFinished ? [{
      icon: SkipForward,
      key: 'endturn',
      label: 'End Turn',
      onClick: onEndTurn ?? (() => {}),
      shortcut: '',
      disabled: !!isTurnHeld,
      pushRight: true,
    }] : isMultiplayer && !isMyTurn && !isFinished && !isTurnHeld && !soloSeat ? [{
      icon: Hand,
      key: 'priority',
      label: 'Priority',
      onClick: onRequestPriority ?? (() => {}),
      shortcut: '',
      disabled: !!hasPendingPriority,
      pushRight: true,
    }] : []),
  ];

  const visibleButtons = buttons.filter(b => !b.hidden);

  // ---- Touch: collapse to a single button ----
  // The bar is anchored in the hand band, where it covered 89-97% of the
  // player's cards on a phone. The hand is tapped every turn and its cards
  // cannot be moved out from under an overlay, so on touch the bar collapses
  // to one 44px control and expands upward into the (free-form, movable)
  // territory only while the player is actually using it.
  const inputMode = useInputMode();
  const isTouch = inputMode === 'touch';
  const [expanded, setExpanded] = useState(false);
  const collapsed = isTouch && !expanded;

  // Touch: a tap anywhere OFF the expanded bar collapses it — the same
  // outside-tap dismissal the context menus use. Raw document listeners so
  // canvas touches count; isPrimaryPointer keeps parity with the menus'
  // pointer handling (TouchEvent has no `button`).
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isTouch || !expanded) return;
    const handle = (evt: MouseEvent | TouchEvent) => {
      if (!isPrimaryPointer(evt as { button?: number })) return;
      if (barRef.current && !barRef.current.contains(evt.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('touchstart', handle);
    document.addEventListener('mousedown', handle);
    return () => {
      document.removeEventListener('touchstart', handle);
      document.removeEventListener('mousedown', handle);
    };
  }, [isTouch, expanded]);

  if (collapsed) {
    return (
      <div
        data-game-toolbar
        data-toolbar-collapsed
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'absolute',
          bottom: 'calc(8px + env(safe-area-inset-bottom))',
          // The settings gear keeps the far-left corner it has on pointer;
          // this docks beside it.
          left: 'calc(60px + env(safe-area-inset-left))',
          zIndex: 200,
          ...(soloSeat ? { display: 'flex', alignItems: 'center', gap: 8 } : {}),
        }}
      >
        <button
          type="button"
          aria-label="Game actions"
          data-testid="toolbar-expand"
          onClick={() => setExpanded(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44,
            background: 'rgba(30,22,16,0.92)',
            border: '1px solid var(--gf-border)',
            borderRadius: 8,
            color: 'var(--gf-text)',
            cursor: 'pointer',
          }}
        >
          <ChevronUp size={22} />
        </button>
        {/* Solo seat swap, touch: docked beside the collapsed toolbar trigger
            in the bottom-left control cluster (gear, toolbar, swap). That is
            the hand band's outer corner, which the centered fan leaves empty
            at normal hand sizes, and well below the battle band. The right
            side is taken by the 36px panel rail, the pile rail above the
            hand and (Paragon) the drawer handle. */}
        {soloSeat && <SeatSwapPill deckName={soloSeat.deckName} onSwap={soloSeat.onSwap} />}
      </div>
    );
  }

  return (
    <div
      ref={barRef}
      data-game-toolbar
      data-toolbar-expanded={isTouch ? 'true' : undefined}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        bottom: isTouch ? 'calc(8px + env(safe-area-inset-bottom))' : 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        padding: '3px 6px',
        background: 'rgba(30,22,16,0.92)',
        border: '1px solid var(--gf-border)',
        borderRadius: 8,
        zIndex: 200,
      }}
    >
      {isTouch && (
        <button
          type="button"
          aria-label="Hide game actions"
          data-testid="toolbar-collapse"
          onClick={() => setExpanded(false)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 44, minHeight: 44,
            background: 'transparent', border: 'none',
            color: 'var(--gf-text)', cursor: 'pointer',
          }}
        >
          <ChevronDown size={22} />
        </button>
      )}
      {visibleButtons.map(({ icon: Icon, key, label, onClick, shortcut, disabled: btnDisabled, pushRight }) => (
        <button
          key={key}
          onClick={onClick}
          disabled={btnDisabled}
          title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            minWidth: 50,
            padding: '4px 6px',
            background: 'transparent',
            border: 'none',
            cursor: btnDisabled ? 'not-allowed' : 'pointer',
            color: btnDisabled ? 'var(--gf-border-dim)' : 'var(--gf-text)',
            borderRadius: 4,
            transition: 'background 0.15s, color 0.15s',
            opacity: btnDisabled ? 0.5 : 1,
            marginLeft: pushRight ? 6 : undefined,
            borderLeft: pushRight ? '1px solid var(--gf-border)' : undefined,
            paddingLeft: pushRight ? 10 : 6,
          }}
          onMouseEnter={(e) => {
            if (!btnDisabled) {
              e.currentTarget.style.background = 'var(--gf-hover)';
              e.currentTarget.style.color = 'var(--gf-text-bright)';
            }
          }}
          onMouseLeave={(e) => {
            if (!btnDisabled) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--gf-text)';
            }
          }}
        >
          <Icon size={18} />
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </span>
        </button>
      ))}
      {/* Solo seat swap, pointer (and expanded touch): the last item of the
          toolbar row, at the bottom of the hand band and below the battle
          band. */}
      {soloSeat && (
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 6, paddingLeft: 6, borderLeft: '1px solid var(--gf-border)' }}>
          <SeatSwapPill deckName={soloSeat.deckName} onSwap={soloSeat.onSwap} />
        </div>
      )}
    </div>
  );
}
