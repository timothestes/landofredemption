'use client';

// REG Pre-Game Phase rail (steps 2 and 3): star reveals, then Lost Soul
// activation. A DOM overlay above the Konva canvas that MUST NOT block board
// interaction — star abilities manipulate decks, hands and zones, so drag,
// right-click, the toolbar, deck-search and every modal stay fully usable while
// the rail is on screen. The wrapper is pointer-events: none and only chips and
// buttons opt back in; Konva hit-tests on its own canvas element, so a
// click-through DOM overlay never intercepts board clicks. Same technique as
// BattleResolutionUI.tsx.
//
// Placement is the play UI's house idiom for a floating panel, shared with
// PauseConsentToast, SpectatorHandRequestBanner and GameOverOverlay: dead centre
// of the container, `top/left: 50%` with `translate(-50%, -50%)`. GameToolbar
// centres itself the same way and is a sibling of the canvas in that container,
// so the panel and the toolbar share one vertical axis — the thing the eye
// actually checks. (AwaitingSoulUI takes a computed `centerX` instead, but it is
// aligning to the battle band, not to the screen.) Both territories are empty
// during the pre-game, so the centre of the board is free.

import { useEffect, useRef, useState } from 'react';
import {
  getEffectiveAbilities,
  abilityLabel,
  DEFAULT_ABILITY_SOURCE_ZONES,
} from '@/lib/cards/cardAbilities';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { useModalCardHover, ModalCardHoverPreview } from '@/app/shared/components/ModalCardHoverPreview';
import StarOfDavidIcon from './StarOfDavidIcon';

// Sits below ZoneBrowseModal's overlay (z 500) so a deck/reserve browse opened
// from a star ability is never covered, and above the canvas. BattleResolutionUI
// uses 600, which would float over that modal — deliberately not copied.
const RAIL_Z = 450;

// Chrome copied from AwaitingSoulUI's panel so the two read as the same object
// in the same place. A fixed width also means the panel doesn't resize under the
// cursor as the star queue advances.
const PANEL: React.CSSProperties = {
  // The panel body itself stays click-through — only its chips and buttons opt
  // back in.
  pointerEvents: 'none',
  background: 'rgba(14, 10, 6, 0.97)',
  border: '1px solid rgba(107, 78, 39, 0.3)',
  borderRadius: 10,
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
  color: '#e8d5a3',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  padding: '20px 24px',
  textAlign: 'center',
  maxWidth: 420,
  width: '90vw',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
};

// Prose. Cinzel has no true lowercase — every glyph is a capital — so it turns
// instructions into a wall of caps that has to be read letter by letter. Georgia
// carries the sentences; Cinzel stays on headings, names and buttons, the same
// split BattleResolutionUI uses. `balance` evens the line lengths so a sentence
// never strands one or two words on the last line.
const BODY: React.CSSProperties = {
  fontFamily: 'Georgia, serif',
  fontSize: 14,
  lineHeight: 1.5,
  color: 'rgba(232, 213, 163, 0.92)',
  textWrap: 'balance',
};

// A hand with no stars has nothing to decide, so the panel eventually decides
// for the player rather than parking the game on a one-button screen until they
// happen to notice it. It deliberately does NOT submit on sight: the opponent
// cannot see your hand, only how long you took, and an instant reveal would
// announce "no stars" every single time. The wait is re-rolled per window inside
// the range a real player's picking takes, so both cases look alike across the
// table. Only the empty hand is on a timer — see `autoSubmits` below.
const AUTO_SUBMIT_MIN_MS = 6000;
const AUTO_SUBMIT_MAX_MS = 15000;

/**
 * Whether my open star window has held a star card at any point. The latch
 * feeding the empty-hand timer: a hand that HAD a star and now reads empty is a
 * player mid-action — they dragged it to the board or used an ability — not an
 * empty hand. Reading the hand live instead, the timer armed the moment the
 * last star left the hand, answered "no stars" for them, and skipped the seat
 * straight on to the Lost Souls step. Resets whenever the window is closed.
 * Exported for tests.
 */
export function hadStarsThisWindow(
  prev: boolean,
  windowOpen: boolean,
  handStarCount: number,
): boolean {
  if (!windowOpen) return false;
  return prev || handStarCount > 0;
}

const CHIP = (selected: boolean): React.CSSProperties => ({
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 12,
  fontSize: 11,
  whiteSpace: 'nowrap',
  border: `1px solid ${selected ? '#c4955a' : 'rgba(196, 149, 90, 0.35)'}`,
  background: selected ? 'rgba(196, 149, 90, 0.22)' : 'transparent',
  color: selected ? '#e8d5a3' : 'rgba(232, 213, 163, 0.6)',
});

const ACTION: React.CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '5px 12px',
  borderRadius: 4,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  border: '1px solid #c4955a',
  background: 'rgba(196, 149, 90, 0.18)',
  color: '#e8d5a3',
};

interface PregameRailProps {
  step: 'stars' | 'souls';
  isMyWindow: boolean;
  opponentName: string;
  /** Star cards in my hand — the rail only needs to know whether I have any. */
  handStars: Array<{ instanceId: bigint; cardName: string; imitatingName?: string }>;
  /** Submitted stars for the active seat, ascending by slot. */
  queue: Array<{ starId: bigint; cardInstanceId: bigint; resolved: boolean; cardName: string; cardImgFile: string; imitatingName?: string }>;
  /** Lost Souls I control that carry ability text. Only the count is used —
   *  an empty list finishes the window instead of drawing a panel. */
  activatableSouls: Array<{ instanceId: bigint; cardName: string }>;
  /** True when I have submitted my star selection this window. */
  hasSubmitted: boolean;
  /** Star cards I've clicked in hand, in pick order. Owned by MultiplayerCanvas
   *  so the hand's order badges and this panel's submit button agree. */
  selection: bigint[];
  onSubmitStars: (ids: bigint[]) => void;
  onResolveStar: (starId: bigint) => void;
  onFinishSouls: () => void;
  onExecuteAbility: (instanceId: bigint, abilityIndex: number) => void;
}

export default function PregameRail({
  step, isMyWindow, opponentName, handStars, queue, activatableSouls,
  hasSubmitted, selection,
  onSubmitStars, onResolveStar, onFinishSouls, onExecuteAbility,
}: PregameRailProps) {
  // The opponent's revealed stars are named but not on any board the viewer can
  // hover — they go straight from the opponent's hand to this list. The shared
  // hook gives them the same two-tier preview a browse modal's cards get: the
  // loupe pane updates on every hover, and only when the pane is collapsed does
  // the floating tooltip appear after a beat. Forge cards can't reach this list
  // (the world-readable row blanks specialAbility, so nothing there ever reads
  // as a star), which is why the hook's plain getCardImageUrl is safe here.
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, onCardMouseEnter, onCardMouseLeave } =
    useModalCardHover(200, { setPreviewCard, isLoupeVisible, keepPreviewOnLeave: true });

  // Only a hand that never held a star auto-submits. A player holding stars is
  // mid-decision, and a timer firing under them would throw away picks they'd
  // already made; a player whose stars have LEFT the hand this window is
  // mid-action, and a timer firing there would skip them ahead — see
  // `hadStarsThisWindow`.
  const windowOpen = isMyWindow && step === 'stars' && !hasSubmitted;
  const [hadStars, setHadStars] = useState(false);
  useEffect(() => {
    setHadStars((prev) => hadStarsThisWindow(prev, windowOpen, handStars.length));
  }, [windowOpen, handStars.length]);
  const autoSubmits = windowOpen && handStars.length === 0 && !hadStars;

  // One submit per window, whichever gets there first. `hasSubmitted` doesn't
  // flip until the server answers, so without this the button and the timer can
  // both fire during the reducer's round-trip.
  const submitOnceRef = useRef(false);
  const onSubmitStarsRef = useRef(onSubmitStars);
  onSubmitStarsRef.current = onSubmitStars;
  const submitStars = (ids: bigint[]) => {
    if (submitOnceRef.current) return;
    submitOnceRef.current = true;
    onSubmitStarsRef.current(ids);
  };

  // Keyed on `autoSubmits` alone, so the delay is rolled once when the empty
  // hand's window opens — depending on the callback would re-roll it (and extend
  // the wait) every time a reconnect swapped the connection underneath.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!autoSubmits) {
      setSecondsLeft(null);
      return;
    }
    const ms = AUTO_SUBMIT_MIN_MS + Math.random() * (AUTO_SUBMIT_MAX_MS - AUTO_SUBMIT_MIN_MS);
    const deadline = Date.now() + ms;
    setSecondsLeft(Math.ceil(ms / 1000));
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    const fire = setTimeout(() => {
      if (submitOnceRef.current) return;
      submitOnceRef.current = true;
      onSubmitStarsRef.current([]);
    }, ms);
    return () => {
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [autoSubmits]);

  // Nothing to activate means nothing to show — don't make the player dismiss an
  // empty panel. The server already skips this window when the seat controls no
  // ability-bearing Lost Soul, so this covers the residual case where the two
  // disagree. No randomized pause here, unlike the star window: the Land of
  // Bondage is face up, so how fast this answers reveals nothing the opponent
  // can't already see.
  const autoFinishSouls =
    isMyWindow && step === 'souls' && activatableSouls.length === 0;
  const finishOnceRef = useRef(false);
  const onFinishSoulsRef = useRef(onFinishSouls);
  onFinishSoulsRef.current = onFinishSouls;
  useEffect(() => {
    if (!autoFinishSouls || finishOnceRef.current) return;
    finishOnceRef.current = true;
    onFinishSoulsRef.current();
  }, [autoFinishSouls]);

  // The whole wrapper is click-through; only chips and buttons opt back in.
  // Konva hit-tests on its own canvas, so this never blocks board interaction.
  const wrapper = (children: React.ReactNode) => (
    <div data-pregame-rail style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: RAIL_Z }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)', ...PANEL }}>
        {children}
      </div>
      <ModalCardHoverPreview hover={hover} />
    </div>
  );

  // `star` marks the headings that are about (Star) abilities — the same
  // hexagram the eligible cards wear in hand. The Lost Souls step never gets
  // it; that step isn't about stars.
  //
  // This is the panel's title, so it outranks the body copy below it — brighter
  // and larger, not the dim 11px caption it started as. Tracking eases off as
  // the size goes up: wide letterspacing buys legibility on small caps and costs
  // it on large ones.
  const heading = (text: string, star = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 17, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', lineHeight: 1.2,
                  color: '#e8d5a3' }}>
      {star && <StarOfDavidIcon size={18} />}
      {text}
    </div>
  );

  if (!isMyWindow) {
    return wrapper(
      <>
        {heading('Pre-Game Phase')}
        {/* A star window is two waits, not one. Once rows exist for the active
            seat they have submitted — the names are right there below this
            line — and what's left is watching them resolve one at a time. */}
        <div style={BODY}>
          {step === 'souls'
            ? `Waiting for ${opponentName} to activate Lost Souls…`
            : queue.length === 0
              ? `Waiting for ${opponentName} to reveal stars…`
              : `Waiting for ${opponentName} to resolve their stars…`}
        </div>
        {queue.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {queue.map((s) => (
              <span
                key={s.starId.toString()}
                style={CHIP(!s.resolved)}
                onMouseEnter={(e) => onCardMouseEnter(s.cardImgFile, s.cardName, e)}
                onMouseLeave={onCardMouseLeave}
              >
                {s.resolved ? '✓ ' : ''}{s.cardName}
              </span>
            ))}
          </div>
        )}
      </>,
    );
  }

  if (step === 'souls') {
    // The effect above is finishing this window; drawing a panel for the frame
    // or two before the server answers would flash an empty box.
    if (activatableSouls.length === 0) return null;
    return wrapper(
      <>
        {heading('Pre-Game Phase · Lost Souls')}
        {/* No name chips. The souls are face up in the Land of Bondage right
            below this panel, so listing them here only repeated the board. */}
        <div style={BODY}>Activate any Lost Souls you control.</div>
        <button style={ACTION} onClick={onFinishSouls}>Done</button>
      </>,
    );
  }

  if (!hasSubmitted) {
    return wrapper(
      <>
        {heading('Pre-Game Phase · Stars', true)}
        {handStars.length === 0 ? (
          <div style={BODY}>No star cards in hand.</div>
        ) : (
          // The picked cards carry a numbered gold badge in the hand itself, so
          // the panel no longer repeats them as name chips.
          <div style={BODY}>
            Click the star cards in your hand. They resolve in the order you
            pick them.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {selection.length > 0 && (
            <button style={ACTION} onClick={() => submitStars(selection)}>
              Reveal {selection.length} star{selection.length === 1 ? '' : 's'}
            </button>
          )}
          <button style={ACTION} onClick={() => submitStars([])}>No stars</button>
        </div>
        {secondsLeft !== null && (
          <div style={{ ...BODY, fontSize: 11, color: 'rgba(232, 213, 163, 0.75)' }}>
            Continuing automatically in {secondsLeft}s
          </div>
        )}
      </>,
    );
  }

  const current = queue.find((s) => !s.resolved);
  if (!current) return wrapper(<>{heading('Pre-Game Phase · Stars', true)}<div style={BODY}>Resolving…</div></>);

  // Map the UNFILTERED ability list and disable out-of-zone entries. Both the
  // client dispatcher and the server index the full array, so filtering first
  // would dispatch the wrong ability. Mirrors CardContextMenu.
  const abilities = getEffectiveAbilities({
    cardName: current.cardName,
    imitatingName: current.imitatingName,
  });

  return wrapper(
    <>
      {heading('Pre-Game Phase · Stars', true)}
      {/* The name only. The card's own text is a paragraph of small caps that
          dwarfed the panel, and the player is holding the card — they can read
          it there, or hover it. It stays a step above the heading: the heading
          says where you are, this says what you're resolving. */}
      <div style={{ fontSize: 20, color: '#e8d5a3', lineHeight: 1.3 }}>
        {current.cardName}
      </div>
      {abilities.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {abilities.map((ability, index) => {
            const allowed = ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES;
            const disabled = !allowed.includes('hand');
            return (
              <button
                key={index}
                disabled={disabled}
                title={disabled ? 'This ability cannot be used from hand' : undefined}
                style={{ ...ACTION, opacity: disabled ? 0.4 : 1,
                         cursor: disabled ? 'not-allowed' : 'pointer' }}
                onClick={() => !disabled && onExecuteAbility(current.cardInstanceId, index)}
              >
                {abilityLabel(ability)}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={ACTION} onClick={() => onResolveStar(current.starId)}>Resolved →</button>
        <span style={{ fontSize: 10, color: 'rgba(232, 213, 163, 0.5)' }}>
          {queue.filter((s) => s.resolved).length + 1} of {queue.length}
        </span>
      </div>
    </>,
  );
}
