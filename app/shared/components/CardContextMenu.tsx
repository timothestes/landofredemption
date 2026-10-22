'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { GameCard, ZoneId, ZONE_LABELS, COUNTER_COLORS, CounterColorId } from '../../goldfish/types';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { GameActions } from '@/app/shared/types/gameActions';
import { getEffectiveAbilities, abilityLabel, DEFAULT_ABILITY_SOURCE_ZONES, isNewTestamentLostSoul } from '@/lib/cards/cardAbilities';

const MOVE_TARGETS: ZoneId[] = [
  'territory',
  'discard', 'reserve',
];

const LOST_SOUL_EXCLUDED_TARGETS: ZoneId[] = ['territory', 'discard', 'reserve'];

function isLostSoul(card: GameCard): boolean {
  return (
    card.type === 'LS' ||
    card.type === 'Lost Soul' ||
    card.type.toLowerCase().includes('lost soul') ||
    // Multiplayer Lost Soul tokens get cardType 'TOKEN_LS' but their cardName
    // always starts with "Lost Soul Token" — match on either to cover both
    // goldfish (type='LS') and multiplayer (type='TOKEN_LS') tokens.
    card.cardName.toLowerCase().startsWith('lost soul')
  );
}

interface CardContextMenuProps {
  card: GameCard;
  x: number;
  y: number;
  actions: GameActions;
  onClose: () => void;
  onExchange?: (cardIds: string[]) => void;
  /** Invoked when the user clicks "Unequip" on an attached weapon. Only renders the menu
   *  entry when this handler is provided AND card.equippedTo is set. */
  onDetach?: (cardInstanceId: string) => void;
  /** Invoked when the user clicks "Add text note" / "Edit note". When omitted, the
   *  menu entry is not rendered (used to gate the action to card owners). */
  onEditNote?: (card: GameCard) => void;
  /** Invoked when the user clicks "Surrender" on a Lost Soul in their own (or
   *  the shared Paragon) Land of Bondage. Sends the soul to the opponent's
   *  Land of Redemption. Multiplayer-only — goldfish leaves this undefined and
   *  the menu entry is suppressed. */
  onSurrender?: (cardInstanceId: string) => void;
  /** Invoked when the user clicks "Rescue" on a Lost Soul in the opponent's
   *  (or the shared Paragon) Land of Bondage. Sends the soul to the local
   *  player's Land of Redemption. Multiplayer-only. */
  onRescue?: (cardInstanceId: string) => void;
  /** Live zone state for reading updated card data (counters, etc.) */
  zones?: Record<ZoneId, GameCard[]>;
  /** When true, the whole-hand reveal is active — suppress the per-card
   *  "Reveal for 30s" entry as redundant. Optional; defaults to false. */
  isHandRevealed?: boolean;
  /** When true, the opponent's hand is currently revealed. Used to gate
   *  abilities that read the opponent's revealed hand (e.g. Matthew the
   *  Publican's "Draw cards equal to brigades"). Defaults to false. */
  opponentHandRevealed?: boolean;
  /** When true, the local player's "play with top card of deck face up"
   *  toggle is active — the toggle_top_deck_reveal menu item flips its label
   *  to the turn-off wording. Defaults to false. */
  topDeckRevealed?: boolean;
  /** True while the server still holds the local player's Philip's Daughters
   *  undo snapshot. Adds an "Undo" item under that card's ability. */
  keepOneUndoAvailable?: boolean;
  /** Opens the full-screen card reader. On touch the sheet's header becomes the
   *  button for it: hover previews and the right panel's loupe are both
   *  hover-fed and disabled on touch, so this is the only route a phone player
   *  has to a card's type and special ability. */
  onViewCard?: (card: GameCard) => void;
  /** Resolved (forge-aware) art for the header thumbnail. */
  cardImageUrl?: string;
}

export function CardContextMenu({ card: initialCard, x, y, actions, onClose, onExchange, onDetach, onEditNote, onSurrender, onRescue, zones, isHandRevealed, opponentHandRevealed, topDeckRevealed, keepOneUndoAvailable, onViewCard, cardImageUrl }: CardContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: x, top: y, ready: false });
  // Touch renders this menu as a bottom sheet (globals.css [data-context-menu]).
  // A sheet needs its own header — which card this is, and an explicit close
  // target — and the click/context-click counter dots need real +/− steppers
  // (there is no right-click on touch).
  const isTouchMenu = useInputMode() === 'touch';

  // Press-gate (touch): the sheet often mounts UNDER the finger (a browse-grid
  // tap opens it), and the tap's synthesized mouse click fires AFTER touchend —
  // on whatever now occupies that point, e.g. a counter "+" row, dispatching a
  // real reducer call from pure browsing. A compat click never re-fires
  // pointerdown, so a click with no preceding press inside the menu is provably
  // synthetic — swallow it. Pointer mode is bit-identical (gate is touch-only).
  const sawRealPressRef = useRef(false);

  // Read live card data so counters update while menu is open
  const card = useMemo(() => {
    if (!zones) return initialCard;
    for (const zoneId of Object.keys(zones) as ZoneId[]) {
      const found = (zones[zoneId] ?? []).find(c => c.instanceId === initialCard.instanceId);
      if (found) return found;
    }
    return initialCard;
  }, [zones, initialCard]);

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

  // Measure after mount, compute final position, then reveal
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const parent = menu.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    let left = x;
    let top = y;

    if (left + rect.width > parentRect.width) {
      left = Math.max(0, parentRect.width - rect.width - 8);
    }
    if (top + rect.height > parentRect.height) {
      top = Math.max(8, parentRect.height - rect.height - 8);
    }

    setPos({ left, top, ready: true });
  }, [x, y]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    background: 'var(--gf-bg)',
    border: '1px solid var(--gf-border)',
    borderRadius: 6,
    padding: '4px 0',
    zIndex: 900,
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    whiteSpace: 'nowrap',
    visibility: pos.ready ? 'visible' : 'hidden',
  };

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gf-text)',
    fontSize: 13,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const separatorStyle: React.CSSProperties = {
    height: 1,
    background: 'var(--gf-border)',
    margin: '4px 8px',
    opacity: 0.5,
  };

  const labelStyle: React.CSSProperties = {
    ...itemStyle,
    color: 'var(--gf-text-dim)',
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    cursor: 'default',
    padding: '4px 16px 2px',
  };

  const doAction = (fn: () => void) => {
    fn();
    onClose();
  };

  // Get count for a given color
  const getCount = (colorId: CounterColorId): number => {
    const c = card.counters.find(c => c.color === colorId);
    return c?.count ?? 0;
  };

  // Per-card abilities from the CARD_ABILITIES registry. Keyed by cardName
  // (includes the set suffix, e.g., "Two Possessed (GoC)") — the identifier
  // field is a taxonomy descriptor, not a stable lookup key.
  // Effective abilities = card's own + inherited from imitated soul (if any).
  // abilityIndex in the dispatch path lines up with this list.
  const abilities = getEffectiveAbilities(card);
  // True when the local player controls this card. Abilities are NOT gated on
  // this — either player may fire any card's right-click ability and the effect
  // routes to whoever clicks (the server enforces the same). Still used below to
  // gate hand-reveal / surrender / rescue, which stay owner-relative.
  const isOwnedByLocalPlayer = card.ownerId === 'player1';
  // Each ability decides which zones it can fire from. Default is in-play
  // (territory + both lands). (Star) abilities like Virgin Birth's
  // look-at-top-6 override this to also allow 'hand'.
  const hasAbilities =
    abilities.length > 0 && typeof actions.executeCardAbility === 'function';

  // Per-card hand reveal — gated to local player's own hand cards and
  // suppressed when the whole hand is already publicly revealed.
  const canRevealInHand =
    card.zone === 'hand' &&
    isOwnedByLocalPlayer &&
    !isHandRevealed &&
    typeof actions.revealCardInHand === 'function';

  const nowForReveal = Date.now();
  const isActivelyRevealed =
    typeof card.revealUntil === 'number' && card.revealUntil > nowForReveal;
  const secondsRemaining = isActivelyRevealed
    ? Math.max(0, Math.ceil((card.revealUntil! - nowForReveal) / 1000))
    : 0;

  // Lost Soul tokens get a simplified menu in goldfish (single-player rescue
  // is just a moveCard). In multiplayer, onSurrender/onRescue handlers are
  // wired so we fall through to the normal menu and surface the proper
  // surrender/rescue buttons (which transfer ownership server-side).
  // Other tokens fall through to the normal menu — server-side cleanup deletes
  // them when they leave territory.
  const isGoldfishMode = !onSurrender && !onRescue;
  if (card.isToken && isLostSoul(card) && isGoldfishMode) {
    return (
      <div ref={menuRef} data-context-menu style={menuStyle} onContextMenu={(e) => e.preventDefault()}>
        <div style={labelStyle}>{card.cardName}</div>
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCard(card.instanceId, 'land-of-redemption'))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Rescue to L.O.R.
        </button>
        {actions.removeOpponentToken && (
          <>
            <div style={separatorStyle} />
            <button
              style={{ ...itemStyle, color: '#8b4a4a' }}
              onClick={() => doAction(() => actions.removeOpponentToken!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Remove Token
            </button>
          </>
        )}
      </div>
    );
  }

  // Lost Soul rescue/surrender buttons — Lost Souls (token or non-token) in a
  // Land of Bondage. Surrender applies to your own LoB. Rescue applies to the
  // opponent's LoB or the shared Paragon LoB. Paragon shared souls can only be
  // rescued — never surrendered — since neither player owns them. The shared
  // souls are identified by cardSet 'ParagonSoul' because the multiplayer
  // adapter renders them with ownerId='player1' for the local view (the true
  // shared marker lives on the underlying CardInstance, not the GameCard).
  // Handlers are multiplayer-only; goldfish leaves them undefined so the
  // buttons hide.
  const isLostSoulInLob = isLostSoul(card) && card.zone === 'land-of-bondage';
  const isParagonSharedSoul = card.cardSet === 'ParagonSoul';
  const canSurrender =
    isLostSoulInLob &&
    !!onSurrender &&
    !isParagonSharedSoul &&
    card.ownerId === 'player1';
  const canRescue =
    isLostSoulInLob &&
    !!onRescue &&
    (card.ownerId === 'player2' || isParagonSharedSoul);

  return (
    <div
      ref={menuRef}
      data-context-menu
      style={menuStyle}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={() => { sawRealPressRef.current = true; }}
      onTouchStartCapture={() => { sawRealPressRef.current = true; }}
      onClickCapture={(e) => {
        if (isTouchMenu && !sawRealPressRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >

      {/* Touch sheet header — the card's name plus an explicit close target.
          Pointer menus stay cursor-anchored and dismiss on outside click, so
          they skip this. */}
      {isTouchMenu && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '2px 4px 2px 16px',
            borderBottom: '1px solid var(--gf-border)',
            marginBottom: 4,
          }}
        >
          {onViewCard ? (
            <button
              type="button"
              onClick={() => onViewCard(card)}
              data-testid="context-menu-view-card"
              aria-label={`View ${card.cardName}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flex: 1,
                minWidth: 0,
                minHeight: 44,
                padding: 0,
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              {cardImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardImageUrl}
                  alt=""
                  style={{
                    width: 28, height: 39, objectFit: 'cover',
                    borderRadius: 3, flexShrink: 0,
                    border: '1px solid var(--gf-border)',
                  }}
                />
              )}
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    color: 'var(--gf-text)',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 15,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {card.cardName}
                </span>
                <span style={{ display: 'block', color: 'var(--gf-text-dim)', fontSize: 10 }}>
                  {card.type ? `${card.type} · ` : ''}Tap to read
                </span>
              </span>
            </button>
          ) : (
            <span
              style={{
                color: 'var(--gf-text)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 15,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {card.cardName}
            </span>
          )}
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            style={{
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--gf-text-dim)',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Card abilities from CARD_ABILITIES registry. Either player may fire an
          ability on any card (effects route to the activator). Rendered disabled
          only when the card isn't in a valid source zone, or when a brigade-draw
          needs the opponent's hand revealed — the server would reject those. */}
      {hasAbilities && (
        <>
          {abilities.map((ability, index) => {
            // set_rotation is a stateful toggle registered as two entries:
            // show only the direction that changes the card (an upright card
            // offers Turn Sideways, a sideways card offers Turn Upright).
            // Returning null keeps `index` aligned with the dispatch path.
            if (ability.type === 'set_rotation' && (card.isRotated ?? false) === ability.rotated) {
              return null;
            }
            const allowedZones = ability.sourceZones ?? DEFAULT_ABILITY_SOURCE_ZONES;
            const isInAbilityZone = allowedZones.includes(card.zone);
            // Brigade-draw abilities read the opponent's revealed hand —
            // disable when the opponent isn't currently revealing.
            const needsOpponentReveal = ability.type === 'draw_brigades';
            const opponentRevealMissing = needsOpponentReveal && !opponentHandRevealed;
            const disabled = !isInAbilityZone || opponentRevealMissing;
            const disabledReason = opponentRevealMissing
              ? "Opponent's hand isn't revealed"
              : undefined;
            return (
              <button
                key={index}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                style={{
                  ...itemStyle,
                  opacity: disabled ? 0.4 : 1,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
                onClick={() => {
                  if (disabled) return;
                  if (ability.type === 'imitate_lost_soul') {
                    actions.beginTargeting?.({
                      prompt: 'Click a New Testament Lost Soul to imitate',
                      isEligible: (c) => isLostSoul(c) && c.zone === 'land-of-bondage' && isNewTestamentLostSoul(c.reference),
                      onSelect: (targetId) => {
                        actions.imitateLostSoul?.(card.instanceId, targetId);
                      },
                      onCancel: () => {},
                    });
                  } else if (ability.type === 'draw_bottom_of_deck_choose') {
                    actions.beginCountPrompt?.({
                      title: 'Draw X from bottom of deck',
                      cardName: card.cardName,
                      defaultCount: 1,
                      onConfirm: (count) => {
                        actions.executeCardAbilityWithCount?.(card.instanceId, index, count);
                      },
                      onCancel: () => {},
                    });
                  } else if (
                    ability.type === 'look_at_own_deck_choose'
                    || ability.type === 'reveal_own_deck_choose'
                    || ability.type === 'look_at_opponent_deck_choose'
                    || ability.type === 'reveal_opponent_deck_choose'
                    || ability.type === 'discard_opponent_deck_choose'
                  ) {
                    // All five player-chosen-count abilities share one prompt;
                    // the canvas decides what to do with the number (local peek
                    // vs opponent-consent request) when it comes back.
                    const verb =
                      ability.type.startsWith('look') ? 'Look at'
                      : ability.type.startsWith('reveal') ? 'Reveal'
                      : 'Discard';
                    const whose = ability.type.includes('opponent') ? "opponent's deck" : 'deck';
                    const where = ability.position === 'random' ? 'X random' : `${ability.position} X`;
                    actions.beginCountPrompt?.({
                      title: `${verb} ${where} cards of ${whose} (limit ${ability.maxCount})`,
                      cardName: card.cardName,
                      defaultCount: ability.defaultCount,
                      maxCount: ability.maxCount,
                      confirmVerb: verb,
                      onConfirm: (count) => {
                        actions.executeCardAbilityWithCount?.(card.instanceId, index, count);
                      },
                      onCancel: () => {},
                    });
                  } else if (ability.type === 'all_players_keep_one_shuffle_draw') {
                    // The canvas shows KeepOneModal over the local hand; the
                    // opponent is asked separately so each picks their own.
                    actions.beginKeepOnePrompt?.(card.instanceId, index);
                  } else if (ability.type === 'resurrect_heroes') {
                    // The canvas builds the per-player discard pages from its
                    // own state and shows ResurrectHeroesModal.
                    actions.beginResurrectPrompt?.(card.instanceId, index);
                  } else {
                    actions.executeCardAbility?.(card.instanceId, index);
                  }
                  onClose();
                }}
                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--gf-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {ability.type === 'toggle_top_deck_reveal' && topDeckRevealed
                  ? 'Turn top card of deck face down'
                  : abilityLabel(ability)}
              </button>
            );
          })}
          {/* Philip's Daughters undo — your own half only (the opponent undoes
              theirs the same way). Not zone-gated: the card may well have left
              play by the time a negate gets sorted out. */}
          {keepOneUndoAvailable
            && typeof actions.undoKeepOneShuffleDraw === 'function'
            && abilities.some((a) => a.type === 'all_players_keep_one_shuffle_draw') && (
            <button
              style={itemStyle}
              onClick={() => {
                actions.undoKeepOneShuffleDraw?.();
                onClose();
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Undo Philip’s Daughters (restore your hand and deck)
            </button>
          )}
          {(card.imitatingName ?? '') !== '' && (
            <button
              style={itemStyle}
              onClick={() => {
                actions.stopImitatingLostSoul?.(card.instanceId);
                onClose();
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Stop Imitating
            </button>
          )}
          <div style={separatorStyle} />
        </>
      )}

      {canRevealInHand && (
        <>
          <button
            style={itemStyle}
            onClick={() => doAction(() => actions.revealCardInHand!(card.instanceId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {isActivelyRevealed
              ? `Reveal for 30s (${secondsRemaining}s left — reset)`
              : 'Reveal for 30s'}
          </button>
          <div style={separatorStyle} />
        </>
      )}

      {/* Counter swatches — territory, land-of-bondage and battle always; land-of-redemption only when counters already exist */}
      {(card.zone === 'territory' || card.zone === 'land-of-bondage' || card.zone === 'battle' || (card.zone === 'land-of-redemption' && card.counters.some(c => c.count > 0))) && (
        <>
          <div style={labelStyle}>Counters</div>
          {/* Touch: explicit +/− steppers per color — the pointer row's
              left-click/right-click semantics don't exist on touch. The
              existing add/remove handlers are reused verbatim. */}
          {isTouchMenu && (
            <div style={{ display: 'flex', gap: 12, padding: '4px 16px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {COUNTER_COLORS.filter(c => c.id === 'red' || c.id === 'green' || c.id === 'blue').map((color) => {
                const count = getCount(color.id);
                const stepStyle: React.CSSProperties = {
                  minWidth: 40,
                  minHeight: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid var(--gf-border)',
                  borderRadius: 8,
                  color: 'var(--gf-text)',
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: 'pointer',
                };
                return (
                  <div key={color.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      aria-label={`Remove ${color.label} counter`}
                      disabled={count === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (count > 0) actions.removeCounter(card.instanceId, color.id);
                      }}
                      style={{ ...stepStyle, opacity: count === 0 ? 0.35 : 1, cursor: count === 0 ? 'default' : 'pointer' }}
                    >
                      −
                    </button>
                    <span
                      aria-label={`${color.label} counters: ${count}`}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: color.hex,
                        border: count > 0 ? '2px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: 13,
                        fontWeight: 'bold',
                        flexShrink: 0,
                      }}
                    >
                      {count > 0 ? count : ''}
                    </span>
                    <button
                      type="button"
                      aria-label={`Add ${color.label} counter`}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.addCounter(card.instanceId, color.id);
                      }}
                      style={stepStyle}
                    >
                      +
                    </button>
                  </div>
                );
              })}
              {card.counters.some(c => c.count > 0) && (
                <button
                  type="button"
                  aria-label="Clear all counters"
                  onClick={(e) => {
                    e.stopPropagation();
                    card.counters.forEach(c => {
                      for (let i = 0; i < c.count; i++) {
                        actions.removeCounter(card.instanceId, c.color);
                      }
                    });
                  }}
                  style={{
                    minHeight: 40,
                    padding: '0 12px',
                    background: 'transparent',
                    border: '1px solid var(--gf-border)',
                    borderRadius: 8,
                    color: 'var(--gf-text-dim)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {!isTouchMenu && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 16px 2px', alignItems: 'center' }}>
            {COUNTER_COLORS.filter(c => c.id === 'red' || c.id === 'green' || c.id === 'blue').map((color) => {
              const count = getCount(color.id);
              return (
                <button
                  key={color.id}
                  title={`${color.label}${count > 0 ? ` (${count})` : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.addCounter(card.instanceId, color.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (count > 0) actions.removeCounter(card.instanceId, color.id);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: color.hex,
                    border: count > 0 ? '2px solid rgba(255,255,255,0.8)' : '2px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.1s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 'bold',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  {count > 0 ? count : ''}
                </button>
              );
            })}
            {card.counters.some(c => c.count > 0) && (
              <button
                title="Clear all counters"
                aria-label="Clear all counters"
                onClick={(e) => {
                  e.stopPropagation();
                  card.counters.forEach(c => {
                    for (let i = 0; i < c.count; i++) {
                      actions.removeCounter(card.instanceId, c.color);
                    }
                  });
                }}
                style={{
                  width: 22,
                  height: 22,
                  marginLeft: 2,
                  borderRadius: '50%',
                  background: 'transparent',
                  border: '1px solid var(--gf-border)',
                  cursor: 'pointer',
                  transition: 'transform 0.1s, border-color 0.1s, color 0.1s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gf-text-dim)',
                  fontSize: 12,
                  lineHeight: 1,
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                  e.currentTarget.style.color = 'var(--gf-text)';
                  e.currentTarget.style.borderColor = 'var(--gf-text-dim)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.color = 'var(--gf-text-dim)';
                  e.currentTarget.style.borderColor = 'var(--gf-border)';
                }}
              >
                ×
              </button>
            )}
          </div>
          )}
          {!isTouchMenu && (
          <div style={{ padding: '0 16px 4px', fontSize: 9, color: 'var(--gf-border)', fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
            Left-click +1 · Right-click -1
          </div>
          )}
        </>
      )}

      {(canSurrender || canRescue) && (
        <>
          {canRescue && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => onRescue!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Rescue
            </button>
          )}
          {canSurrender && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => onSurrender!(card.instanceId))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Surrender
            </button>
          )}
        </>
      )}

      <button
        style={itemStyle}
        onClick={() => doAction(() => card.isMeek ? actions.unmeekCard(card.instanceId) : actions.meekCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isMeek ? 'Unmeek' : 'Make Meek'}
      </button>

      <button
        style={itemStyle}
        onClick={() => doAction(() => actions.flipCard(card.instanceId))}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {card.isFlipped ? 'Turn Face-Up' : 'Turn Face-Down'}
      </button>

      {card.equippedTo && onDetach && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => onDetach(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Unequip
        </button>
      )}

      {onEditNote && (
        <>
          <button
            style={itemStyle}
            onClick={() => doAction(() => onEditNote(card))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {card.notes
              ? `Edit note: "${card.notes.length > 20 ? card.notes.slice(0, 20) + '…' : card.notes}"`
              : 'Add text note'}
          </button>
          <button
            style={itemStyle}
            onClick={() => doAction(() => actions.setNote(card.instanceId, 'Negated'))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Negated
          </button>
          {card.notes && (
            <button
              style={itemStyle}
              onClick={() => doAction(() => actions.setNote(card.instanceId, ''))}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Clear note
            </button>
          )}
        </>
      )}

      <div style={separatorStyle} />

      {/* Zone targets */}
      <div style={labelStyle}>Move to...</div>
      {MOVE_TARGETS
        .filter(z => z !== card.zone)
        .filter(z => !isLostSoul(card) || !LOST_SOUL_EXCLUDED_TARGETS.includes(z))
        .map(zoneId => (
          <button
            key={zoneId}
            style={itemStyle}
            onClick={() => doAction(() => actions.moveCard(card.instanceId, zoneId))}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {ZONE_LABELS[zoneId]}
          </button>
        ))}

      <div style={separatorStyle} />
      <div style={labelStyle}>Deck...</div>

      {/* Deck actions */}
      {actions.moveCardToTopOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToTopOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Top of Deck
        </button>
      )}
      {actions.moveCardToBottomOfDeck && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.moveCardToBottomOfDeck!(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Bottom of Deck
        </button>
      )}
      {!card.isToken && (
        <button
          style={itemStyle}
          onClick={() => doAction(() => actions.shuffleCardIntoDeck(card.instanceId))}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Shuffle into Deck
        </button>
      )}
      {onExchange && card.zone !== 'deck' && (
        <button
          style={itemStyle}
          onClick={() => { onClose(); onExchange([card.instanceId]); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          Exchange with Deck
        </button>
      )}
    </div>
  );
}
