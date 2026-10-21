'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PHASE_ORDER } from '@/app/goldfish/types';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import type { GamePhase } from '@/app/shared/types/gameCard';
import { showGameToast } from '@/app/shared/components/GameToast';

// ---------------------------------------------------------------------------
// NameHint — abbreviated label with an instant custom hover tooltip.
// Replaces the browser-native `title` attribute (which has a ~500ms delay
// and renders in OS chrome) with a styled in-canvas popover that matches
// the rest of the multiplayer UI.
// ---------------------------------------------------------------------------

function NameHint({
  label,
  full,
  color,
  accent,
  trailing,
}: {
  label: string;
  /** Full name to reveal on hover. `null` disables the hint. */
  full: string | null;
  /** Color for the label caption. */
  color: string;
  /** Accent border color for the hover bubble. */
  accent: string;
  /** Optional trailing node (e.g. connection dot) rendered alongside the label. */
  trailing?: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const showHint = hovered && full !== null && full !== label;
  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        color,
        fontSize: FZ.caption,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
        marginTop: 2,
        cursor: full ? 'help' : undefined,
      }}
    >
      {label}
      {trailing}
      {showHint && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '3px 8px',
            background: 'rgba(10, 8, 5, 0.95)',
            border: `1px solid ${accent}`,
            borderRadius: 4,
            color: '#e8d5a3',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: FZ.caption,
            letterSpacing: '0.04em',
            textTransform: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)',
            pointerEvents: 'none',
            zIndex: 60,
          }}
        >
          {full}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Phase display labels
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  draw: 'Draw',
  upkeep: 'Upkeep',
  preparation: 'Preparation',
  battle: 'Battle',
  discard: 'Discard',
  end: 'End of Turn', // the 'end' gate — the boundary after discard, before the flip
};

// Touch: the overlaid bar shares one row with END TURN / CONCEDE on a phone
// viewport, so the longer phase names abbreviate. Full names stay in the
// button titles and in every toast (which read from PHASE_LABELS).
const TOUCH_PHASE_LABELS: Record<string, string> = {
  draw: 'Draw',
  upkeep: 'Upk',
  preparation: 'Prep',
  battle: 'Battle',
  discard: 'Disc',
  end: 'End of Turn',
};

// REG Pre-Game Phase sub-steps. Kept separate from PHASE_ORDER/PHASE_LABELS so
// the normal turn phases are untouched.
const PREGAME_STEPS = ['stars', 'souls'] as const;
const PREGAME_LABELS: Record<string, string> = {
  stars: 'Stars',
  souls: 'Lost Souls',
};
// Vertical room the chips (and the pill behind them) give up to the PRE-GAME
// PHASE caption above them. Both must use it or the pill's top border cuts
// through the caption. Caption + chips total ~36px inside the fixed 48px bar.
const PREGAME_CAPTION_GAP = 10;

// Fluid type scale — keeps the bar legible on Retina laptops (small logical
// viewport, high DPI) without growing chunky on large monitors. Each clamp()
// floors near the original design size and grows ~1.2-1.3x at typical widths.
const FZ = {
  caption: 'clamp(9px, 0.4vw + 6px, 11px)',     // formerly 8 ("you", "opp")
  label: 'clamp(10px, 0.4vw + 7px, 12px)',      // formerly 9 ("X's turn")
  ui: 'clamp(11px, 0.45vw + 7px, 13px)',        // formerly 10 (Cinzel UI labels, phase buttons, End Turn, Concede)
  body: 'clamp(12px, 0.5vw + 8px, 14px)',       // formerly 12 (winner label, timer, modal buttons)
  bodyLg: 'clamp(13px, 0.5vw + 9px, 15px)',     // formerly 13 (turn number, modal body)
  headline: 'clamp(18px, 0.6vw + 12px, 22px)',  // formerly 18 (arrows, modal headlines)
  score: 'clamp(20px, 0.8vw + 14px, 26px)',     // formerly 20 (score numbers)
} as const;

// ---------------------------------------------------------------------------
// PhaseGate — a between-phase gate marker (Phase Stops). A stop is a one-shot
// gate on a turn boundary, so these render as slim hit targets in the gaps of
// the phase row — before Upkeep/Preparation/Battle/Discard, plus the 'end'
// gate after Discard (before the turn flip). There is no gate before Draw
// (the flip auto-draws). A wide invisible hit target keeps the gap tappable
// on mobile; the slim bar inside it carries the actual visual state.
// ---------------------------------------------------------------------------

function PhaseGate({
  phase,
  hasStop,
  isHeldPhase,
  canToggle,
  opponentName,
  onToggle,
}: {
  phase: string;
  /** The viewer has an armed (not-yet-fired) stop on this phase. */
  hasStop: boolean;
  /** The turn is currently held at the gate before this phase. */
  isHeldPhase: boolean;
  /** Old canToggleStops conditions — opponent's turn, not read-only/pregame/finished. */
  canToggle: boolean;
  opponentName: string;
  onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const label = PHASE_LABELS[phase] ?? phase;
  // Touch: the 16px-wide gate is under half the 44px target (height is
  // already 44+ via the global [data-phase-bar] button rule + stretch).
  // Widen the tappable box to 32px with -8px margins so the row's layout
  // metrics are unchanged (net contribution stays 16px and the 852x393 fit
  // is undisturbed) — the extra 8px per side overlaps the neighbouring
  // phase buttons' padding. Interactive gates float above those (then
  // disabled) buttons; non-interactive gates go hit-transparent so they
  // never swallow taps meant for the phase buttons on your own turn.
  const isTouch = useInputMode() === 'touch';

  // Precedence: an engaged hold outranks an armed stop, which outranks the
  // faint "you could toggle here" affordance. Nothing renders otherwise —
  // "unarmed otherwise = invisible" per spec.
  let barColor = 'transparent';
  let barGlow: string | undefined;
  let barAnimation: string | undefined;
  if (isHeldPhase) {
    barColor = '#fbbf24';
    barGlow = '0 0 8px rgba(245, 158, 11, 0.85)';
    barAnimation = 'stopHoldPulse 1s ease-in-out infinite';
  } else if (hasStop) {
    barColor = '#c4955a';
    barGlow = '0 0 6px rgba(196, 149, 90, 0.6)';
  } else if (canToggle) {
    // Discoverability affordance: faintly visible whenever toggling is
    // possible, even with no stop armed yet. Quiet — no animation, just a
    // small hover brighten (matches the rest of the bar's hover language).
    barColor = hovered ? 'rgba(196, 149, 90, 0.55)' : 'rgba(196, 149, 90, 0.28)';
  }
  const isVisible = isHeldPhase || hasStop || canToggle;
  const isInteractive = canToggle;

  return (
    <button
      type="button"
      data-testid={`phase-gate-${phase}`}
      onClick={isInteractive ? onToggle : undefined}
      disabled={!isInteractive}
      title={
        isInteractive
          ? (hasStop ? `Remove stop before ${label}` : `Stop before ${label} on ${opponentName}'s turn`)
          : undefined
      }
      aria-label={
        isInteractive
          ? (hasStop ? `Remove stop before ${label}` : `Stop before ${label} on ${opponentName}'s turn`)
          : undefined
      }
      onMouseEnter={isInteractive ? () => setHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setHovered(false) : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: isTouch ? 32 : 16,
        minWidth: isTouch ? 32 : 16,
        alignSelf: 'stretch',
        flexShrink: 0,
        padding: 0,
        margin: isTouch ? '0 -8px' : 0,
        background: 'transparent',
        border: 'none',
        cursor: isInteractive ? 'pointer' : 'default',
        pointerEvents: isTouch && !isInteractive ? 'none' : undefined,
        zIndex: isTouch && isInteractive ? 2 : 1,
      }}
    >
      {isVisible && (
        <span
          aria-hidden
          style={{
            width: 3,
            height: '60%',
            borderRadius: 2,
            background: barColor,
            boxShadow: barGlow,
            animation: barAnimation,
            transition: 'background 0.15s, box-shadow 0.15s',
          }}
        />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TurnIndicatorProps {
  game: any;
  myPlayer: any;
  opponentPlayer: any;
  isMyTurn: boolean;
  onSetPhase: (phase: string) => void;
  onEndTurn: () => void;
  onConcede?: () => void;
  onRequestPriority?: () => void;
  hasPendingPriority?: boolean;
  isFinished?: boolean;
  winnerName?: string;
  onPlayAgain?: () => void;
  onBackToLobby?: () => void;
  /** Destination for the exit/leave-to-lobby navigations. Defaults to the
   *  public play lobby; Forge games pass the Forge play lobby instead. */
  lobbyPath?: string;
  myScore?: number;
  opponentScore?: number;
  opponentConnectionStatus?: 'connected' | 'reconnecting' | 'disconnected';
  disconnectTimeoutFired?: boolean;
  onClaimVictory?: () => void;
  /** Formatted timer string (e.g. "12:34" or "1:23:45"). */
  timerDisplay?: string;
  /** Whether the timer is currently paused (deck search open). */
  timerPaused?: boolean;
  /** Whether to show the timer at all (controlled by gear menu toggle). */
  timerVisible?: boolean;
  /** Whether a rematch request has been sent and we're waiting for the opponent. */
  rematchPending?: boolean;
  /** Retract a locally-initiated pending rematch request. */
  onCancelRematch?: () => void;
  /** Send a pause request to the opponent. */
  onRequestPause?: () => void;
  /** Send a resume request to the opponent. */
  onRequestResume?: () => void;
  /** Cancel the locally-initiated pending pause/resume request. */
  onCancelPauseRequest?: () => void;
  /** When true, hide interactive buttons (END TURN, CONCEDE, pause) and disable phase tab clicks. */
  readOnly?: boolean;
  /** Spectator-only: request the players reveal their hands (replaces CONCEDE slot). */
  onRequestHandReveal?: () => void;
  /** When set, the phase row is replaced by the REG Pre-Game Phase treatment.
   *  'stars' = star reveals, 'souls' = Lost Soul activation. Undefined during
   *  normal play. */
  pregameStep?: 'stars' | 'souls';
  /** Phase Stops: gates of the opponent's turn the VIEWER has armed. */
  myStops?: string[];
  /** Phase Stops: gate currently holding the turn ('' = no hold). */
  holdPhase?: string;
  /** Phase Stops: server deadline (micros since epoch) when the hold auto-releases. */
  holdDeadlineMicros?: bigint | null;
  /** Phase Stops: toggle the viewer's gate for a boundary (non-active player only). */
  onToggleStop?: (phase: string, enabled: boolean) => void;
  /** Solo game (one human holds both seats): hides the two-human chrome —
   *  stops, hold banner, pause, rematch, claim victory, connection dot. */
  isSolo?: boolean;
  /** Solo: the deck name of the seat in hand (concede confirm copy). */
  seatInHandName?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TurnIndicator({
  game,
  myPlayer,
  opponentPlayer,
  isMyTurn,
  onSetPhase,
  onEndTurn,
  onConcede,
  onRequestPriority,
  hasPendingPriority,
  isFinished,
  winnerName,
  onPlayAgain,
  onBackToLobby,
  lobbyPath = '/play',
  myScore = 0,
  opponentScore = 0,
  opponentConnectionStatus = 'connected',
  disconnectTimeoutFired = false,
  onClaimVictory,
  timerDisplay,
  timerPaused = false,
  timerVisible = true,
  rematchPending = false,
  onCancelRematch,
  onRequestPause,
  onRequestResume,
  onCancelPauseRequest,
  readOnly = false,
  onRequestHandReveal,
  pregameStep,
  myStops = [],
  holdPhase = '',
  holdDeadlineMicros = null,
  onToggleStop,
  isSolo = false,
  seatInHandName,
}: TurnIndicatorProps) {
  const [showConcedeConfirm, setShowConcedeConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [handRevealCooldownUntil, setHandRevealCooldownUntil] = useState(0);
  const handRevealOnCooldown = Date.now() < handRevealCooldownUntil;
  const { isLoupeVisible } = useCardPreview();
  // Touch: the bar overlays the canvas (client.tsx), so it goes fully opaque
  // (canvas labels ghosted through the 0.96 alpha), abbreviates the longer
  // phase names, and carries a compact T{n} turn chip — the canvas's own
  // turn badge is suppressed there. Pointer rendering is bit-identical.
  const isTouchBar = useInputMode() === 'touch';
  const phaseLabelFor = (phase: string): string =>
    (isTouchBar ? TOUCH_PHASE_LABELS[phase] : PHASE_LABELS[phase]) ?? phase;
  const currentPhase: string = game?.currentPhase ?? 'draw';
  const turnNumber: number = game?.turnNumber ? Number(game.turnNumber) : 1;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  // The sliding pill measures whichever row is rendered. During the pre-game
  // that's the two-chip row, otherwise the five-phase row.
  const activeKey: string = pregameStep ?? currentPhase;
  const isFirstPhase = currentIdx <= 0;
  const isLastPhase = currentIdx >= PHASE_ORDER.length - 1;

  // ---- Phase Stops ----
  const isHeld = !isSolo && holdPhase !== '';
  // While held, the active player answers via the center-board priority
  // prompt (MultiplayerCanvas) — the bar only disables movement affordances.
  const heldAgainstMe = isHeld && isMyTurn && !readOnly;
  const canToggleStops = !isSolo && !isMyTurn && !readOnly && !pregameStep && !isFinished && !!onToggleStop;

  // Countdown — recomputed from the server deadline each tick (reconnect-safe;
  // ScheduleAt timestamps are objects, micros → ms via Number(x / 1000n)).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isHeld) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isHeld]);
  const holdSecondsLeft =
    isHeld && holdDeadlineMicros != null
      ? Math.max(0, Math.ceil((Number(holdDeadlineMicros / 1000n) - nowMs) / 1000))
      : null;

  const handleToggleStop = (phase: string) => {
    if (!canToggleStops || !onToggleStop) return;
    const enabling = !myStops.includes(phase);
    onToggleStop(phase, enabling);
    showGameToast(
      enabling
        ? `Stop set: before ${PHASE_LABELS[phase]}. ${opponentName} will be prompted there — it fires once.`
        : `Stop removed: before ${PHASE_LABELS[phase]}.`,
    );
  };

  // ---- Mutually-agreed pause state (server-authoritative) ----
  const mySeatStr: string = myPlayer?.seat?.toString() ?? '';
  const pauseRequestedBy: string = game?.pauseRequestedBy ?? '';
  const pauseRequestType: string = game?.pauseRequestType ?? '';
  const isServerPaused: boolean = (game?.pauseStartedAtMicros ?? 0n) > 0n;
  const isMyRequest = pauseRequestedBy !== '' && pauseRequestedBy === mySeatStr;
  const isOpponentRequest = pauseRequestedBy !== '' && pauseRequestedBy !== mySeatStr;
  // Button mode: pause | play | cancel | hidden
  // - pause:  no request pending, not currently paused → offer to start a pause
  // - play:   no request pending, currently paused → offer to start a resume
  // - cancel: I have a pending request → offer to cancel it
  // - hidden: opponent has a pending request → toast handles their consent UI
  const pauseButtonMode: 'pause' | 'play' | 'cancel' | 'hidden' =
    isSolo || isOpponentRequest ? 'hidden' :
    isMyRequest ? 'cancel' :
    isServerPaused ? 'play' : 'pause';

  // Each client animates independently from its own currentPhase observation —
  // the SpacetimeDB subscription drives the re-render, CSS transitions do the slide.
  const phaseRowRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const centerScrollRef = useRef<HTMLDivElement | null>(null);

  // Touch: the phase strip scrolls (portrait can't fit all five chips) but it
  // never followed the game on its own — the active chip could sit outside
  // the visible window for a whole turn, so a phone watcher lost the one
  // "what's happening" signal the bar carries. Keep the current chip in view.
  useEffect(() => {
    if (!isTouchBar) return;
    const scroller = centerScrollRef.current;
    const el = buttonRefs.current[pregameStep ?? currentPhase];
    if (!scroller || !el) return;
    if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
    const eb = el.getBoundingClientRect();
    const sb = scroller.getBoundingClientRect();
    if (eb.left < sb.left + 8) {
      scroller.scrollBy({ left: eb.left - sb.left - 24, behavior: 'smooth' });
    } else if (eb.right > sb.right - 8) {
      scroller.scrollBy({ left: eb.right - sb.right + 24, behavior: 'smooth' });
    }
  }, [isTouchBar, currentPhase, pregameStep]);
  const [activeBounds, setActiveBounds] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
  const hasMeasuredRef = useRef(false);

  // Portrait touch: the phase strip scrolls inside a narrow sliver — keep the
  // CURRENT phase in view instead of wherever the strip was last scrolled.
  useEffect(() => {
    if (!isTouchBar) return;
    const btn = buttonRefs.current[activeKey];
    btn?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [isTouchBar, activeKey]);

  // Measure the bar's own width so we can hide non-essential bits (the timer)
  // when the playfield container is narrow — e.g. on a 14" laptop or when the
  // loupe sidebar is open. Width-based, not viewport-based, since the bar
  // shrinks when the right-side panel opens.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [isBarNarrow, setIsBarNarrow] = useState(false);
  // Portrait-phone widths: even the trimmed touch bar overflows ~30px at
  // 393px, clipping the exit button and Concede at the edges — drop the
  // score cluster there (the least load-bearing block; LoR counts live on
  // the board) so every control stays on-screen.
  const [isBarUltraNarrow, setIsBarUltraNarrow] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      setIsBarNarrow(el.clientWidth < 1100);
      setIsBarUltraNarrow(el.clientWidth < 520);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const btn = buttonRefs.current[activeKey];
    if (!btn) return;
    setActiveBounds({ left: btn.offsetLeft, width: btn.offsetWidth });
    hasMeasuredRef.current = true;
  }, [activeKey]);

  // Remeasure on viewport changes and font load (Cinzel can shift widths).
  useEffect(() => {
    const remeasure = () => {
      const btn = buttonRefs.current[activeKey];
      if (!btn) return;
      setActiveBounds({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    window.addEventListener('resize', remeasure);
    let observer: ResizeObserver | undefined;
    if (phaseRowRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(remeasure);
      observer.observe(phaseRowRef.current);
    }
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(remeasure).catch(() => {});
    }
    return () => {
      window.removeEventListener('resize', remeasure);
      observer?.disconnect();
    };
  }, [activeKey]);

  const myName: string = myPlayer?.displayName ?? 'You';
  const opponentName: string = opponentPlayer?.displayName ?? 'Opponent';

  const handlePrevPhase = () => {
    if (!isMyTurn || isFirstPhase || heldAgainstMe) return;
    const prevPhase = PHASE_ORDER[currentIdx - 1];
    onSetPhase(prevPhase);
  };

  const handleNextPhase = () => {
    if (!isMyTurn || heldAgainstMe) return;
    if (isLastPhase) {
      onEndTurn();
    } else {
      const nextPhase = PHASE_ORDER[currentIdx + 1];
      onSetPhase(nextPhase);
    }
  };

  // Touch renders End Turn in the FIXED right cluster next to Concede — in
  // the scrollable center it scrolled out of view on portrait widths,
  // leaving no visible way to end the turn.
  const endTurnButton = !readOnly && !pregameStep ? (
    <button
      onClick={onEndTurn}
      disabled={!isMyTurn || heldAgainstMe}
      title={
        heldAgainstMe
          ? 'Answer the priority request first'
          : isMyTurn ? 'End your turn' : "Wait for opponent's turn to end"
      }
      style={{
        marginLeft: isTouchBar ? 0 : 10,
        padding: isTouchBar ? '5px 8px' : '5px 12px',
        background: isMyTurn && !heldAgainstMe ? 'rgba(196, 149, 90, 0.15)' : 'transparent',
        border: `1px solid ${isMyTurn && !heldAgainstMe ? 'rgba(196, 149, 90, 0.45)' : 'rgba(107, 78, 39, 0.25)'}`,
        borderRadius: 4,
        cursor: isMyTurn && !heldAgainstMe ? 'pointer' : 'default',
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: FZ.ui,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: isMyTurn && !heldAgainstMe ? '#e8d5a3' : 'rgba(196, 149, 90, 0.3)',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        if (!isMyTurn || heldAgainstMe) return;
        e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
        e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
      }}
      onMouseLeave={(e) => {
        if (!isMyTurn || heldAgainstMe) return;
        e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
        e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
      }}
    >
      End Turn
    </button>
  ) : null;

  return (
    <div
      data-phase-bar
      ref={barRef}
      style={{
        position: 'relative',
        width: '100%',
        // Touch: fixed 48px with symmetric breathing room — sized by content,
        // the 44px buttons sat flush against the screen's top edge (clipped
        // pill/borders) with all the slack pooled at the bottom.
        // Ultra-narrow (portrait phones) wraps to TWO rows — clusters on top,
        // full-width phase strip below. In one row the strip's scroll window
        // collapsed to ~87px and End Turn/Concede sat exactly where the
        // clipped Upkeep/Prep chips were laid out, so a tap aimed at a phase
        // chip ended the turn or opened Concede (measured via
        // elementFromPoint at 393px).
        height: isTouchBar ? (isBarUltraNarrow ? 94 : 48) : '100%',
        boxSizing: 'border-box',
        paddingTop: isTouchBar ? 2 : 0,
        paddingBottom: isTouchBar ? 1 : 0,
        // Touch overlays the bar on the canvas — fully opaque so canvas
        // labels can't ghost through. Pointer keeps the original alpha.
        background: isTouchBar ? '#0a0805' : 'rgba(10, 8, 5, 0.96)',
        borderBottom: '1px solid rgba(107, 78, 39, 0.5)',
        // Three columns: left cluster | center cluster | right cluster.
        // `1fr auto 1fr` keeps the center anchored to the bar's geometric
        // midpoint while the side `1fr` tracks share the remaining space.
        // This works here because the left cluster (exit + score + timer)
        // and right cluster (Concede) are now both small enough to fit in
        // their 1fr share — TURN N / NAME's-turn moved to a canvas overlay
        // over the opponent's hand zone, freeing ~140px from the left.
        // Touch uses FLEX instead: on sub-700px portrait widths the grid's
        // intrinsic middle track maximizes BEFORE the fr side tracks get
        // leftover space, collapsing them to 0px (measured live: cols
        // "0px 353px 0px") — the side clusters then overflow their empty
        // tracks underneath the phase buttons. Flex sides are shrink-0 and
        // the center is flex:1 with its own horizontal scroll, so the row
        // shrinks and scrolls instead of overprinting Concede.
        display: isTouchBar ? 'flex' : 'grid',
        gridTemplateColumns: isTouchBar ? undefined : '1fr auto 1fr',
        // Two-row wrap on ultra-narrow: the center strip takes flex-basis
        // 100% + order 3 (below), so row 1 is [left cluster … right cluster]
        // and row 2 is the phase strip at full bar width.
        flexWrap: isTouchBar && isBarUltraNarrow ? 'wrap' : undefined,
        alignItems: 'center',
        gap: 8,
        rowGap: 0,
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <style>{`@keyframes stopHoldPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>

      {/* ================================================================
          LEFT — Exit + turn counter + whose turn + score + timer
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
          flexShrink: isTouchBar ? 0 : undefined,
        }}
      >
      {/* Exit to lobby */}
      <button
        onClick={() => isFinished ? window.location.href = lobbyPath : setShowLeaveConfirm(true)}
        title="Back to lobby"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 4,
          flexShrink: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'rgba(232, 213, 163, 0.35)',
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#e8d5a3';
          e.currentTarget.style.background = 'rgba(196, 149, 90, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'rgba(232, 213, 163, 0.35)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 21H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H15" />
          <polyline points="8 17 3 12 8 7" />
          <line x1="3" y1="12" x2="15" y2="12" />
        </svg>
      </button>

      {/* Touch-only compact turn chip. On pointer the TURN N / NAME's-turn
          block is a canvas overlay, but on touch that overlay sits under
          this very bar — so the turn number lives here instead. Color says
          whose turn it is (amber = mine, blue = theirs). */}
      {isTouchBar && (
        <span
          data-testid="turn-chip"
          title={isMyTurn ? `Turn ${turnNumber} — your turn` : `Turn ${turnNumber} — ${opponentName}'s turn`}
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.06em',
            lineHeight: 1,
            color: isMyTurn ? '#c4955a' : '#4a7ab5',
            flexShrink: 0,
          }}
        >
          T{turnNumber}
          {/* Ultra-narrow bars hide the score cluster — and with it the only
              opponent-connection dot in the app, exactly on the portrait
              phones where the opponent silently dropping matters most. Show
              the dot beside the turn number there instead. */}
          {isBarUltraNarrow && !readOnly && !isSolo && (
            <span
              title={`Opponent ${opponentConnectionStatus === 'connected' ? 'connected' : opponentConnectionStatus === 'reconnecting' ? 'reconnecting' : 'disconnected'}`}
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                marginLeft: 5,
                borderRadius: '50%',
                verticalAlign: 'middle',
                background: opponentConnectionStatus === 'connected' ? '#22c55e' : opponentConnectionStatus === 'reconnecting' ? '#eab308' : '#ef4444',
                boxShadow: `0 0 5px ${opponentConnectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.6)' : opponentConnectionStatus === 'reconnecting' ? 'rgba(234, 179, 8, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
              }}
            />
          )}
        </span>
      )}

      {/* Score + timer wrapper. The TURN N / NAME's turn block lives over
          the opponent's hand zone in the canvas instead — keeps the bar
          narrow enough that the centered phase row never collides. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
      {/* Score — dropped on ultra-narrow (portrait-phone) touch bars so the
          exit button and Concede stop clipping at the screen edges. */}
      <div
        style={{
          display: isTouchBar && isBarUltraNarrow ? 'none' : 'flex',
          alignItems: 'center',
          gap: 10,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        {(() => {
          // Spectators see both seats by name; players see "you" vs "opp".
          // Names are abbreviated to the caption slot's footprint with a
          // custom hover hint surfacing the full name with no native-title
          // delay.
          const abbrev = (name?: string, max = 6) =>
            !name ? '' : name.length <= max ? name : `${name.slice(0, max)}…`;
          const seat0Name: string | undefined = myPlayer?.displayName;
          const seat1Name: string | undefined = opponentPlayer?.displayName;
          const leftLabel = readOnly ? abbrev(seat0Name) || 'P1' : 'you';
          const rightLabel = readOnly ? abbrev(seat1Name) || 'P2' : 'opp';
          const leftFull = readOnly ? (seat0Name ?? 'Player 1') : null;
          const rightFull = readOnly ? (seat1Name ?? 'Player 2') : null;
          return (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ color: isTouchBar ? '#e0b070' : '#c4955a', fontSize: FZ.score, fontWeight: 700, lineHeight: 1 }}>{myScore}</span>
                <NameHint
                  label={leftLabel}
                  full={leftFull}
                  color={isTouchBar ? 'rgba(196, 149, 90, 0.8)' : 'rgba(196, 149, 90, 0.45)'}
                  accent="#c4955a"
                />
              </div>
              <span style={{ color: 'rgba(232, 213, 163, 0.2)', fontSize: FZ.ui, fontWeight: 400 }}>vs</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ color: isTouchBar ? '#7aa5d8' : '#4a7ab5', fontSize: FZ.score, fontWeight: 700, lineHeight: 1 }}>{opponentScore}</span>
                <NameHint
                  label={rightLabel}
                  full={rightFull}
                  color={isTouchBar ? 'rgba(122, 165, 216, 0.85)' : 'rgba(74, 122, 181, 0.45)'}
                  accent="#4a7ab5"
                  trailing={isSolo ? undefined : (
                    <span
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: opponentConnectionStatus === 'connected' ? '#22c55e' : opponentConnectionStatus === 'reconnecting' ? '#eab308' : '#ef4444',
                        boxShadow: `0 0 5px ${opponentConnectionStatus === 'connected' ? 'rgba(34, 197, 94, 0.6)' : opponentConnectionStatus === 'reconnecting' ? 'rgba(234, 179, 8, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
                        flexShrink: 0,
                      }}
                    />
                  )}
                />
              </div>
            </>
          );
        })()}
      </div>

      {/* Game timer — hidden on narrow bars to avoid colliding with the
          centered phase indicator. */}
      {timerVisible && timerDisplay && !isBarNarrow && (
        <span
          title={
            isServerPaused ? 'Game is paused' :
            isMyRequest && pauseRequestType === 'pause' ? 'Waiting for opponent to accept pause' :
            isMyRequest && pauseRequestType === 'resume' ? 'Waiting for opponent to accept resume' :
            timerPaused ? 'Timer paused (searching)' : 'Elapsed game time'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: FZ.body,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em',
            color: (isServerPaused || timerPaused) ? 'rgba(232, 213, 163, 0.25)' : 'rgba(232, 213, 163, 0.45)',
            fontStyle: isServerPaused ? 'italic' : 'normal',
            flexShrink: 0,
            transition: 'color 0.3s',
          }}
        >
          {/* Fixed-width slot so proportional digits in Cinzel don't shift the
              pause button as the timer ticks (e.g. "00:51" vs "00:54"). 4.5em
              fits "MM:SS"; once the game crosses an hour it grows to fit
              "H:MM:SS" — a one-time shift, not a per-second jitter. */}
          <span
            style={{
              display: 'inline-block',
              minWidth: timerDisplay && timerDisplay.length > 5 ? '6em' : '4.5em',
              textAlign: 'right',
            }}
          >
            {timerDisplay}
          </span>
          {isServerPaused && (
            <span
              style={{
                fontSize: FZ.caption,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(234, 179, 8, 0.7)',
                fontStyle: 'normal',
              }}
            >
              paused
            </span>
          )}
          {pauseButtonMode !== 'hidden' && !readOnly && (
            <button
              type="button"
              onClick={() => {
                if (pauseButtonMode === 'pause') onRequestPause?.();
                else if (pauseButtonMode === 'play') onRequestResume?.();
                else if (pauseButtonMode === 'cancel') onCancelPauseRequest?.();
              }}
              title={
                pauseButtonMode === 'pause' ? 'Pause game (asks opponent)' :
                pauseButtonMode === 'play' ? 'Resume game (asks opponent)' :
                'Cancel pending request'
              }
              aria-label={
                pauseButtonMode === 'pause' ? 'Pause game' :
                pauseButtonMode === 'play' ? 'Resume game' :
                'Cancel pause request'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 22,
                height: 22,
                padding: 0,
                background: 'transparent',
                border: '1px solid rgba(232, 213, 163, 0.25)',
                borderRadius: 4,
                color: pauseButtonMode === 'cancel'
                  ? 'rgba(234, 179, 8, 0.85)'
                  : 'rgba(232, 213, 163, 0.65)',
                cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(232, 213, 163, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(232, 213, 163, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(232, 213, 163, 0.25)';
              }}
            >
              {pauseButtonMode === 'pause' && (
                <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
                  <rect x="1" y="1" width="2.5" height="9" rx="0.5" />
                  <rect x="6.5" y="1" width="2.5" height="9" rx="0.5" />
                </svg>
              )}
              {pauseButtonMode === 'play' && (
                <svg width="10" height="11" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
                  <path d="M2 1.5 L2 9.5 L9 5.5 Z" />
                </svg>
              )}
              {pauseButtonMode === 'cancel' && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2 L8 8 M8 2 L2 8" />
                </svg>
              )}
            </button>
          )}
        </span>
      )}
      {/* Narrow bars hide the timer block above, and pause/resume lived only
          inside it — so no phone had any way to pause at all. A standalone
          44px control keeps the feature reachable on touch. */}
      {isTouchBar && isBarNarrow && !readOnly && pauseButtonMode !== 'hidden' && (
        <button
          type="button"
          onClick={() => {
            if (pauseButtonMode === 'pause') onRequestPause?.();
            else if (pauseButtonMode === 'play') onRequestResume?.();
            else if (pauseButtonMode === 'cancel') onCancelPauseRequest?.();
          }}
          title={
            pauseButtonMode === 'pause' ? 'Pause game (asks opponent)' :
            pauseButtonMode === 'play' ? 'Resume game (asks opponent)' :
            'Cancel pending request'
          }
          aria-label={
            pauseButtonMode === 'pause' ? 'Pause game' :
            pauseButtonMode === 'play' ? 'Resume game' :
            'Cancel pause request'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 44,
            minHeight: 44,
            padding: 0,
            background: 'transparent',
            border: '1px solid rgba(232, 213, 163, 0.25)',
            borderRadius: 4,
            color: pauseButtonMode === 'cancel'
              ? 'rgba(234, 179, 8, 0.85)'
              : 'rgba(232, 213, 163, 0.65)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {pauseButtonMode === 'pause' && (
            <svg width="14" height="15" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
              <rect x="1" y="1" width="2.5" height="9" rx="0.5" />
              <rect x="6.5" y="1" width="2.5" height="9" rx="0.5" />
            </svg>
          )}
          {pauseButtonMode === 'play' && (
            <svg width="14" height="15" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
              <path d="M2 1.5 L2 9.5 L9 5.5 Z" />
            </svg>
          )}
          {pauseButtonMode === 'cancel' && (
            <svg width="14" height="14" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2 L8 8 M8 2 L2 8" />
            </svg>
          )}
        </button>
      )}
      </div>
      </div>

      {/* ================================================================
          CENTER — ‹ Arrow | Phase buttons | › Arrow | End Turn
          Sits in the middle grid column. With `1fr auto 1fr` columns the
          center is anchored to the bar's geometric midpoint while the
          left/right `1fr` tracks absorb spare space — and shifts gracefully
          rather than overlapping when one side outgrows its track.
          ================================================================ */}
      <div
        ref={centerScrollRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          // 'safe center' keeps the row centered when it fits but start-aligns
          // it when it overflows, so the scrollable strip's left end is
          // reachable. Touch only — with plain 'center', overflow clips both
          // ends unreachably.
          justifyContent: isTouchBar ? 'safe center' : 'center',
          gap: 2,
          // Touch keeps a sliver of the phase strip alive on portrait widths
          // — flex-basis 0 let the side clusters squeeze it to nothing, and
          // the current phase vanished from the bar entirely.
          minWidth: isTouchBar ? 64 : 0,
          // Touch: the center takes exactly the space between the fixed side
          // clusters and scrolls its own content on narrow (portrait) widths
          // instead of overprinting the right cluster. Ultra-narrow: wrap to
          // a second, full-width row (order 3 puts it after the right
          // cluster) so every chip and phase-stop gate is actually hittable.
          flex: isTouchBar ? (isBarUltraNarrow ? '1 1 100%' : '1 1 0') : undefined,
          order: isTouchBar && isBarUltraNarrow ? 3 : undefined,
          overflowX: isTouchBar ? 'auto' : undefined,
          // Scroll affordance: iOS shows no scrollbar at rest, so a strip
          // that overflows looked complete. Fade the clipped edges instead —
          // when the row fits, the edges are empty space and the fade is
          // invisible, so this costs nothing on wider bars.
          maskImage: isTouchBar
            ? 'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)'
            : undefined,
          WebkitMaskImage: isTouchBar
            ? 'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)'
            : undefined,
        }}
      >
        {/* Previous phase arrow — hidden during the pre-game alongside the next
            arrow and END TURN. set_phase is server-gated while pregamePhase is
            set, so it is a false affordance, and hiding only one of the pair
            leaves the pre-game chips visually off-centre. */}
        {!pregameStep && <button
          onClick={readOnly ? undefined : handlePrevPhase}
          disabled={readOnly || !isMyTurn || isFirstPhase || heldAgainstMe}
          title="Previous phase"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: readOnly || !isMyTurn || isFirstPhase || heldAgainstMe ? 'default' : 'pointer',
            color: !isMyTurn || isFirstPhase || heldAgainstMe ? 'rgba(107, 78, 39, 0.3)' : 'rgba(232, 213, 163, 0.45)',
            fontSize: FZ.headline,
            fontFamily: 'serif',
            padding: '2px 6px',
            transition: 'color 0.2s',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (isMyTurn && !isFirstPhase && !heldAgainstMe) e.currentTarget.style.color = '#e8d5a3'; }}
          onMouseLeave={(e) => { if (isMyTurn && !isFirstPhase && !heldAgainstMe) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)'; }}
        >
          &#x276E;
        </button>}

        <div
          ref={phaseRowRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'stretch',
            gap: 2,
          }}
        >
          {/* Sliding pill (behind the buttons). */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              // The pre-game chips sit lower to clear the PRE-GAME PHASE
              // caption; the pill drops with them so its top edge doesn't cut
              // through that caption. The 48px touch bar has no headroom for
              // the caption (it clipped above the screen edge), so there the
              // caption is dropped and the chips center like normal phases.
              top: pregameStep && !isTouchBar ? PREGAME_CAPTION_GAP : 0,
              bottom: 0,
              left: 0,
              width: activeBounds.width,
              transform: `translateX(${activeBounds.left}px)`,
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 20,
              boxSizing: 'border-box',
              opacity: hasMeasuredRef.current && activeBounds.width > 12 ? 1 : 0,
              transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), width 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
              pointerEvents: 'none',
              willChange: 'transform, width',
            }}
          />

          {/* Sliding underline (rides along under the pill). */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              bottom: 2,
              left: 0,
              height: 2,
              width: activeBounds.width * 0.7,
              transform: `translateX(${activeBounds.left + activeBounds.width * 0.15}px)`,
              background: '#c4955a',
              borderRadius: 1,
              boxShadow: '0 0 6px rgba(196, 149, 90, 0.5)',
              opacity: hasMeasuredRef.current && activeBounds.width > 12 ? 1 : 0,
              transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1), width 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s',
              pointerEvents: 'none',
              willChange: 'transform, width',
              zIndex: 1,
            }}
          />

          {/* REG Pre-Game Phase treatment — a caption plus two static chips in
              place of the five turn phases, so the star/soul steps are never
              mistaken for the Upkeep Phase. The chips are not buttons: the
              server drives the step. */}
          {pregameStep && (
            <>
              {!isTouchBar && <span
                style={{
                  position: 'absolute',
                  // lineHeight 1 pins the caption's box to its font size, so the
                  // clearance below it doesn't drift with Cinzel's leading as
                  // the fluid type scale grows.
                  top: -3,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.caption,
                  lineHeight: 1,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'rgba(232, 213, 163, 0.55)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                Pre-Game Phase
              </span>}
              {PREGAME_STEPS.map((step) => {
                const isActive = step === pregameStep;
                return (
                  <span
                    key={step}
                    ref={(el) => { buttonRefs.current[step] = el as any; }}
                    style={{
                      position: 'relative',
                      padding: '4px 10px',
                      marginTop: isTouchBar ? 0 : PREGAME_CAPTION_GAP,
                      fontFamily: 'var(--font-cinzel), Georgia, serif',
                      fontSize: FZ.ui,
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: isActive ? '#e8d5a3' : 'rgba(232, 213, 163, 0.35)',
                      transition: 'color 0.24s ease-out',
                      whiteSpace: 'nowrap',
                      zIndex: 1,
                    }}
                  >
                    {PREGAME_LABELS[step]}
                  </span>
                );
              })}
            </>
          )}

          {!pregameStep && PHASE_ORDER.map((phase) => {
            const isActive = phase === currentPhase;
            const canClick = isMyTurn && !isActive && !heldAgainstMe;
            const isHeldPhase = isHeld && phase === holdPhase;
            const hasMyStop = myStops.includes(phase);

            return (
              <Fragment key={phase}>
                {/* Gate marker — sits BEFORE this phase's button (the gate is
                    on the boundary INTO the phase). No gate before Draw: the
                    turn flip auto-draws, so there is no boundary to stop on. */}
                {phase !== 'draw' && (
                  <PhaseGate
                    phase={phase}
                    hasStop={hasMyStop}
                    isHeldPhase={isHeldPhase}
                    canToggle={canToggleStops}
                    opponentName={opponentName}
                    onToggle={() => handleToggleStop(phase)}
                  />
                )}
                <button
                  ref={(el) => { buttonRefs.current[phase] = el; }}
                  onClick={() => {
                    if (readOnly) return;
                    if (canClick) onSetPhase(phase);
                  }}
                  disabled={readOnly || !isMyTurn || heldAgainstMe}
                  title={PHASE_LABELS[phase]}
                  style={{
                    position: 'relative',
                    padding: '4px 10px',
                    background: 'transparent',
                    border: isHeldPhase ? '1px solid rgba(245, 158, 11, 0.7)' : '1px solid transparent',
                    borderRadius: 20,
                    cursor: canClick ? 'pointer' : 'default',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: FZ.ui,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    // Touch floors: 0.45/0.35 alphas were near-invisible at
                    // arm's length on a phone under glare.
                    color: isHeldPhase
                      ? '#fbbf24'
                      : isActive
                      ? '#e8d5a3'
                      : isMyTurn
                      ? (isTouchBar ? 'rgba(232, 213, 163, 0.62)' : 'rgba(232, 213, 163, 0.45)')
                      : (isTouchBar ? 'rgba(196, 186, 168, 0.55)' : 'rgba(150, 150, 160, 0.35)'),
                    transition: 'color 0.24s ease-out',
                    whiteSpace: 'nowrap',
                    zIndex: 1,
                  }}
                  onMouseEnter={(e) => {
                    if (canClick) e.currentTarget.style.color = '#e8d5a3';
                  }}
                  onMouseLeave={(e) => {
                    if (canClick) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)';
                  }}
                >
                  {phaseLabelFor(phase)}
                </button>
              </Fragment>
            );
          })}

          {/* The 'end' gate — the boundary AFTER Discard, before the turn
              flip. Stops End Turn for one last window. */}
          {!pregameStep && (
            <PhaseGate
              phase="end"
              hasStop={myStops.includes('end')}
              isHeldPhase={isHeld && holdPhase === 'end'}
              canToggle={canToggleStops}
              opponentName={opponentName}
              onToggle={() => handleToggleStop('end')}
            />
          )}
        </div>

        {/* Next phase / End Turn arrow. Hidden during the pre-game: the turn
            machinery is server-gated there, so it would be a false affordance. */}
        {!pregameStep && <button
          onClick={readOnly ? undefined : handleNextPhase}
          disabled={readOnly || !isMyTurn || heldAgainstMe}
          title={isLastPhase ? 'End turn' : 'Next phase'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: readOnly || !isMyTurn || heldAgainstMe ? 'default' : 'pointer',
            color: !isMyTurn || heldAgainstMe ? 'rgba(107, 78, 39, 0.3)' : 'rgba(232, 213, 163, 0.45)',
            fontSize: FZ.headline,
            fontFamily: 'serif',
            padding: '2px 6px',
            transition: 'color 0.2s',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (isMyTurn && !heldAgainstMe) e.currentTarget.style.color = '#e8d5a3'; }}
          onMouseLeave={(e) => { if (isMyTurn && !heldAgainstMe) e.currentTarget.style.color = 'rgba(232, 213, 163, 0.45)'; }}
        >
          &#x276F;
        </button>}

        {/* End Turn. While the turn is held the center-board priority prompt
            is the surface — this button just disables (the server refuses
            movement until the prompt is answered). On touch it renders in the
            fixed right cluster instead (see endTurnButton above). */}
        {!isTouchBar && endTurnButton}

        {/* Spectators can never act, so this is a non-interactive status span —
            not a button — but still surfaces the hold + countdown (spec §8.4). */}
        {readOnly && isHeld && !pregameStep && (
          <span
            style={{
              marginLeft: 10,
              padding: '5px 12px',
              background: 'rgba(245, 158, 11, 0.10)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              borderRadius: 4,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#fbbf24',
              whiteSpace: 'nowrap',
            }}
          >
            {`Held${holdSecondsLeft != null ? ` · ${holdSecondsLeft}s` : ''}`}
          </span>
        )}
      </div>

      {/* ================================================================
          RIGHT — Concede (playing) or Play Again (finished)
          ================================================================ */}
      <div
        style={{
          justifySelf: 'end',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
          minWidth: 0,
          marginLeft: isTouchBar ? 'auto' : undefined,
        }}
      >
        {isTouchBar && endTurnButton}
        {/* While a rematch request is pending, the button retracts it; otherwise
            it starts a one-tap rematch. The "Waiting for opponent…" copy lives on
            the GameOverOverlay toast, so this slot just offers the action. */}
        {isFinished && onPlayAgain && rematchPending && !isSolo && (
          <button
            onClick={onCancelRematch}
            disabled={!onCancelRematch}
            title="Cancel the pending rematch request"
            style={{
              padding: '5px 12px',
              background: 'transparent',
              border: '1px solid rgba(107, 78, 39, 0.4)',
              borderRadius: 4,
              cursor: onCancelRematch ? 'pointer' : 'default',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'rgba(196, 149, 90, 0.6)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!onCancelRematch) return;
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.4)';
              e.currentTarget.style.color = 'rgba(196, 149, 90, 0.85)';
            }}
            onMouseLeave={(e) => {
              if (!onCancelRematch) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(107, 78, 39, 0.4)';
              e.currentTarget.style.color = 'rgba(196, 149, 90, 0.6)';
            }}
          >
            Cancel
          </button>
        )}
        {isFinished && onPlayAgain && !rematchPending && !isSolo && (
          <button
            onClick={onPlayAgain}
            style={{
              padding: '5px 12px',
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#e8d5a3',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
            }}
          >
            Play Again
          </button>
        )}
        {isFinished && !onPlayAgain && onBackToLobby && (
          <button
            onClick={onBackToLobby}
            style={{
              padding: '5px 12px',
              background: 'rgba(196, 149, 90, 0.15)',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#e8d5a3',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
            }}
          >
            Back to Lobby
          </button>
        )}
        {!isFinished && disconnectTimeoutFired && onClaimVictory && !isSolo && (
          <button
            onClick={onClaimVictory}
            style={{
              padding: '5px 12px',
              background: 'rgba(180, 140, 60, 0.15)',
              border: '1px solid rgba(180, 140, 60, 0.5)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#d4b86a',
              fontWeight: 600,
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(180, 140, 60, 0.28)';
              e.currentTarget.style.borderColor = 'rgba(180, 140, 60, 0.75)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(180, 140, 60, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(180, 140, 60, 0.5)';
            }}
          >
            Claim Victory
          </button>
        )}
        {!isFinished && !disconnectTimeoutFired && onConcede && !readOnly && (
          <button
            onClick={() => setShowConcedeConfirm(true)}
            style={{
              // Touch: End Turn shares the right cluster, and at portrait
              // widths the pair overflowed — Concede's box ran off-screen.
              padding: isTouchBar ? '5px 8px' : '5px 12px',
              background: 'transparent',
              border: '1px solid rgba(180, 60, 60, 0.5)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.75)',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(60, 10, 10, 0.5)';
              e.currentTarget.style.borderColor = 'rgba(220, 80, 80, 0.6)';
              e.currentTarget.style.color = 'rgba(240, 150, 150, 0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(180, 60, 60, 0.5)';
              e.currentTarget.style.color = 'rgba(220, 120, 120, 0.75)';
            }}
          >
            Concede
          </button>
        )}
        {!isFinished && !disconnectTimeoutFired && readOnly && onRequestHandReveal && (
          <button
            onClick={() => {
              if (handRevealOnCooldown) return;
              onRequestHandReveal();
              setHandRevealCooldownUntil(Date.now() + 30_000);
            }}
            disabled={handRevealOnCooldown}
            style={{
              padding: '5px 12px',
              background: 'transparent',
              border: '1px solid rgba(196, 149, 90, 0.45)',
              borderRadius: 4,
              cursor: handRevealOnCooldown ? 'default' : 'pointer',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#e8d5a3',
              opacity: handRevealOnCooldown ? 0.5 : 1,
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              if (handRevealOnCooldown) return;
              e.currentTarget.style.background = 'rgba(196, 149, 90, 0.18)';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.75)';
            }}
            onMouseLeave={(e) => {
              if (handRevealOnCooldown) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(196, 149, 90, 0.45)';
            }}
          >
            {handRevealOnCooldown ? 'Request Sent' : 'Request Hands'}
          </button>
        )}
      </div>

      {/* Concede confirmation modal */}
      {showConcedeConfirm && (
        <div
          onClick={() => setShowConcedeConfirm(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            // Desktop loupe-column dodge only — on touch the panel is a
            // full-screen overlay, and the inset squeezed this dialog into
            // the leftover gutter on portrait phones.
            right: isTouchBar ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 4, 2, 0.7)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(180, 60, 60, 0.3)',
              borderRadius: 10,
              padding: '32px 36px',
              textAlign: 'center',
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(180, 60, 60, 0.08)',
            }}
          >
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(220, 120, 120, 0.5)',
            }}>Concede</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.headline,
              fontWeight: 700,
              color: '#e8d5a3',
              marginTop: 8,
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}>{isSolo ? `Concede as ${seatInHandName ?? 'this seat'}?` : 'Are you sure?'}</h2>
            <p style={{
              marginTop: 8,
              fontFamily: 'Georgia, serif',
              fontSize: FZ.bodyLg,
              color: 'rgba(196, 149, 90, 0.5)',
            }}>This will end the game and count as a loss.</p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowConcedeConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConcedeConfirm(false);
                  onConcede?.();
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(180, 60, 60, 0.45)',
                  background: 'rgba(180, 60, 60, 0.15)',
                  color: '#dc7878',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Concede
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave game confirmation modal */}
      {showLeaveConfirm && (
        <div
          onClick={() => setShowLeaveConfirm(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            // Same touch-vs-loupe reasoning as the concede modal above.
            right: isTouchBar ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
            zIndex: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6, 4, 2, 0.7)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(107, 78, 39, 0.3)',
              borderRadius: 10,
              padding: '32px 36px',
              textAlign: 'center',
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            }}
          >
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.ui,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(196, 149, 90, 0.5)',
            }}>Leave Game</p>
            <h2 style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: FZ.headline,
              fontWeight: 700,
              color: '#e8d5a3',
              marginTop: 8,
              textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            }}>Return to lobby?</h2>
            <p style={{
              marginTop: 8,
              fontFamily: 'Georgia, serif',
              fontSize: FZ.bodyLg,
              color: 'rgba(196, 149, 90, 0.5)',
            }}>{readOnly
              ? 'You will stop spectating. The game will continue.'
              : 'This will end the game and count as a resignation.'}</p>

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  background: 'transparent',
                  color: 'rgba(196, 149, 90, 0.6)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onConcede?.();
                  window.location.href = lobbyPath;
                }}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(180, 60, 60, 0.45)',
                  background: 'rgba(180, 60, 60, 0.15)',
                  color: '#dc7878',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: FZ.body,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
