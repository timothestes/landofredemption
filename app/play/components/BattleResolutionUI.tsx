'use client';

// Battle Zone resolution buttons (design spec §8, Task 13), plus the
// awaiting-soul chooser dialog / waiting pill (Task 14). HTML overlay,
// positioned band-relative via the dual-corner virtualToScreen pattern the
// brigade-mismatch toast established (MultiplayerCanvas.tsx ~7517-7576) —
// the row is anchored just BELOW the band's bottom-LEFT corner (not
// inside it, and not the right corner — product direction, PR #197,
// previously overlapped the sidebar's Territory pile), clear of the
// brigade-mismatch toast, which occupies the band's own bottom-right
// corner. Mounted from MultiplayerCanvas (not client.tsx) because it needs
// band geometry + scale/offsets, which only exist there.
//
// battleState === 'active' and 'awaiting-soul' are mutually exclusive, so
// the resolution-button row and the awaiting-soul pill/modal safely reuse
// the same anchor geometry below.
//
// Every resolution action (Win Battle / Battle Lost)
// dispatches its reducer IMMEDIATELY on click — no confirm dialog (product
// direction: the confirm-summary step was cut). The post-battle summary is
// now a transient toast fired by the caller (MultiplayerCanvas) once the
// battle actually closes, not a pre-dispatch confirmation here.

import { useEffect, useState } from 'react';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import type { ZoneRect } from '../layout/multiplayerLayout';
import type { CardInstance } from '@/lib/spacetimedb/module_bindings/types';
import type { DeckFormat } from '@/lib/deck-format';
import { resolveCardImageUrl, type ForgeResolverMap } from '../utils/forgeResolver';

type ResolutionAction = 'claim-victory' | 'battle-lost';

interface BattleResolutionUIProps {
  /** Battle band rect (virtual coords). Caller gates mounting on this being present. */
  band: ZoneRect;
  scale: number;
  offsetX: number;
  offsetY: number;
  /** '' | 'active' | 'awaiting-soul' — 'active' shows buttons, 'awaiting-soul' shows the
   *  Task 14 chooser modal (chooser) / waiting pill (everyone else, incl. spectators). */
  battleState: string;
  /** Real seats for both players — for spectators these are seat0/seat1 (the actual
   *  players' seats), NOT "which seat is the viewer": spectators pass isSpectator=true
   *  separately so this component never treats a spectator as a participant. */
  mySeat: string;
  opponentSeat: string;
  attackerSeat: string;
  /** True for the spectator viewer. Spectators never see resolution buttons or the
   *  awaiting-soul picker — only the waiting pill. */
  isSpectator: boolean;
  /** Solo game (one human holds both seats): the human is always the chooser. */
  isSolo?: boolean;
  /** Deck format (normalizeDeckFormat mirror) — drives the awaiting-soul chooser rule
   *  (spec §7 / server surrender_soul: T1 defender picks, T2 & Paragon attacker picks). */
  format: DeckFormat;
  /** Display names for the pill/modal copy — real player names, not "You"/"Opponent",
   *  so the text reads correctly for spectators too. */
  myPlayerName: string;
  opponentPlayerName: string;
  /** Lost Souls at stake for the current battle (server's battleStakesLobLostSouls,
   *  mirrored client-side — see MultiplayerCanvas's stakesLostSoulRows). Only meaningful
   *  while battleState === 'awaiting-soul'. */
  eligibleSouls: CardInstance[];
  /** Stakes-soul ids (stringified) that have a Site attached — derived by the caller
   *  from the ACCESSORY rows' equippedToInstanceId links (a soul's own field is always
   *  0n; see siteAttachedSoulIds in battleMath). Drives the "⚑ in Site" badge. */
  siteAttachedSoulIds: Set<string>;
  /** Forge card-art resolver, for Forge playtest games. */
  forgeResolver?: ForgeResolverMap | null;
  /** True once the band holds at least one card. Win Battle / Battle Lost are
   *  confirm-free and consequence-heavy (a misclicked 🏳 with souls at stake
   *  goes straight into the surrender flow), so they stay hidden over an
   *  empty band. There is no End Battle button — the attacker walks away by
   *  progressing the phase (set_phase / end_turn auto-return any open battle
   *  server-side, from 'active' AND 'awaiting-soul'). */
  bandHasCards: boolean;
  /** Both Win Battle and Battle Lost dispatch the same server reducer (resolve_battle) —
   *  the server decides win/loss from caller identity, not from which button was pressed. */
  onResolveBattle: () => void;
  /** Dispatches end_battle. Only the awaiting-soul CHOOSER uses it now (the
   *  Decline / no-souls-left buttons) — the defender can't phase-progress on
   *  the attacker's turn, so those need an explicit control. */
  onEndBattle: () => void;
  onSurrenderSoul: (cardInstanceId: bigint) => void;
  /** Phase Stops: phase currently holding the turn ('' = no hold). end_battle/
   *  resolve_battle/surrender_soul are all hold-gated server-side for BOTH
   *  players (spec §5.4) — the conclude buttons below are disabled to match
   *  rather than dispatch a doomed reducer call. */
  holdPhase: string;
  /** Compact (phone) layout — the caller's useCompactLayout. The awaiting-soul
   *  chooser anchors to the viewport centre (the band midline can be panned
   *  off-screen on a phone) and scrims the live board behind it so a missed
   *  tap can't fall through to an armed Konva stage. Pointer mode is
   *  byte-identical when this is false/omitted. */
  compact?: boolean;
  /** A card is armed for tap-to-move (touch). The resolution row sits
   *  INSIDE the band's tap area, so with a card armed a band-aimed tap could
   *  fire a confirm-free, consequence-heavy resolution instead of committing
   *  the move. Hide the row until the arm resolves; the awaiting-soul UI is
   *  unaffected (no arm can be live behind its scrim). */
  suppressResolution?: boolean;
}

const BUTTON_COPY: Record<ResolutionAction, { label: string; compactLabel: string }> = {
  // Compact labels: on a phone the full row spanned most of the band and sat
  // over its bottom card edge — the icons carry the verb, so the noun goes.
  'claim-victory': { label: '⚑ Win Battle', compactLabel: '⚑ Win' },
  'battle-lost': { label: '🏳 Battle Lost', compactLabel: '🏳 Lost' },
};

type Tone = 'gold' | 'red' | 'neutral';

const TONE_STYLE: Record<Tone, { border: string; bg: string; bgHover: string; color: string }> = {
  gold: { border: 'rgba(196, 149, 90, 0.5)', bg: 'rgba(196, 149, 90, 0.15)', bgHover: 'rgba(196, 149, 90, 0.3)', color: '#e8d5a3' },
  red: { border: 'rgba(180, 60, 60, 0.5)', bg: 'rgba(60, 10, 10, 0.35)', bgHover: 'rgba(60, 10, 10, 0.55)', color: '#dc7878' },
  neutral: { border: 'rgba(196, 149, 90, 0.45)', bg: 'rgba(14, 10, 6, 0.6)', bgHover: 'rgba(107, 78, 39, 0.35)', color: '#e8d5a3' },
};

function ResolutionButton({
  label,
  tone,
  onClick,
  disabled,
  title,
  compact,
}: {
  label: string;
  tone: Tone;
  onClick: () => void;
  /** Phase Stops: true while a hold blocks the reducer this button dispatches. */
  disabled?: boolean;
  title?: string;
  /** Phone layout: tighter padding + smaller type (labels shrink too). */
  compact?: boolean;
}) {
  const t = TONE_STYLE[tone];
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: compact ? '4px 10px' : '6px 14px',
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        color: t.color,
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = t.bgHover; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = t.bg; }}
    >
      {label}
    </button>
  );
}

/**
 * Task 14: awaiting-soul UI. Chooser (spec §7: T1 defender / T2 & Paragon
 * attacker — mirrors the server's surrender_soul permission check exactly)
 * sees a compact centered picker of the souls at stake; everyone else
 * (non-chooser + every spectator) sees a status pill near the band, never
 * the picker. No opaque full-screen backdrop — the picker's own bounds are
 * kept small (max-height + scroll) specifically so it doesn't block the
 * chooser's view of the band behind it (spec §8).
 *
 * The picker centers on `centerX` — the band's horizontal midline in screen
 * px, i.e. the middle of the play mat. Viewport centering sat visibly right
 * of the board (the sidebar piles + chat column all live on the right).
 */
function AwaitingSoulUI({
  topLeft,
  right,
  centerX,
  mySeat,
  opponentSeat,
  attackerSeat,
  isSpectator,
  isSolo,
  format,
  myPlayerName,
  opponentPlayerName,
  eligibleSouls,
  siteAttachedSoulIds,
  forgeResolver,
  pendingSoulId,
  setPendingSoulId,
  onSurrenderSoul,
  onEndBattle,
  compact,
}: {
  topLeft: { x: number; y: number };
  right: { x: number; y: number };
  /** Horizontal midline of the battle band (= the play mat) in screen px. */
  centerX: number;
  mySeat: string;
  opponentSeat: string;
  attackerSeat: string;
  isSpectator: boolean;
  isSolo?: boolean;
  format: DeckFormat;
  myPlayerName: string;
  opponentPlayerName: string;
  eligibleSouls: CardInstance[];
  siteAttachedSoulIds: Set<string>;
  forgeResolver?: ForgeResolverMap | null;
  pendingSoulId: bigint | null;
  setPendingSoulId: (id: bigint | null) => void;
  onSurrenderSoul: (cardInstanceId: bigint) => void;
  /** Bare dispatch (no confirm) — used by both the chooser's own "no souls
   *  left" button above and the non-chooser's escape-hatch button below. */
  onEndBattle: () => void;
  compact?: boolean;
}) {
  // Chooser derivation (spec §7 / server surrender_soul guard): T1 → the
  // defender picks which of their own souls to give up; T2 & Paragon → the
  // attacker picks which to take. mySeat/opponentSeat are the REAL seats of
  // both players (even for the spectator viewer — see BattleResolutionUIProps
  // doc), so this comparison is safe on its own; isSpectator is what stops a
  // spectator from ever being treated as the chooser.
  const defenderSeat = attackerSeat === mySeat ? opponentSeat : attackerSeat === opponentSeat ? mySeat : '';
  const chooserSeat = format === 'T1' ? defenderSeat : attackerSeat;
  // Solo: the one human picks for whichever seat chooses (the server acts as
  // the chooser seat for surrender_soul in a solo game).
  const isChooser = isSolo === true ? true : !isSpectator && mySeat !== '' && mySeat === chooserSeat;
  // Tap-safety is an input-mode property, not a viewport-size one: on ANY
  // touch device (tablet included) a missed tap must not fall through to the
  // live Konva stage. The visible scrim stays compact-only.
  const isTouchInput = useInputMode() === 'touch';

  // The "Waiting for <chooser> to choose a soul…" status lives in the band
  // HEADER. The attacker's old ↩ End escape hatch here is GONE: it rendered
  // exactly where ⚑ Win / ↩ End had just been, so one stray tap during the
  // opponent's open chooser forfeited the soul the attacker had just won
  // (verified live). The server-side hatch survives without a button —
  // set_phase / end_turn auto-return any open battle from 'awaiting-soul'
  // too, so a stalling-but-connected chooser still can't strand the
  // attacker: they just progress the phase, the normal "move on" gesture.
  if (!isChooser) return null;

  const title = chooserSeat === attackerSeat ? 'Choose a Lost Soul to rescue' : 'Choose a Lost Soul to surrender';
  // One line of context so the picker stands on its own for a chooser who
  // wasn't watching the band (UX review F8): who won, where the soul goes.
  const attackerName = attackerSeat === mySeat ? myPlayerName : opponentPlayerName;
  const chooserName = chooserSeat === mySeat ? myPlayerName : opponentPlayerName;
  const subtitle = isSolo === true
    ? `Choose a soul for ${chooserName}`
    : chooserSeat === attackerSeat
      ? 'You won the battle — the soul you pick moves to your Land of Redemption.'
      : `${attackerName} won the battle — the soul you pick goes to their Land of Redemption.`;

  const handlePick = (cardId: bigint) => {
    if (pendingSoulId !== null) return;
    setPendingSoulId(cardId);
    onSurrenderSoul(cardId);
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 900,
        // Touch: a missed tap must not fall through to the live (possibly
        // armed) Konva stage underneath — the wrapper becomes a tap shield
        // (visible scrim on compact only). Desktop pointer mode keeps
        // pointerEvents:none per the spec §8 no-backdrop direction.
        pointerEvents: compact === true || isTouchInput ? 'auto' : 'none',
        background: compact === true ? 'rgba(0, 0, 0, 0.45)' : undefined,
      }}
    >
      <div
        data-soul-chooser
        style={{
          position: 'absolute',
          // Compact anchors to the container centre — the band midline is a
          // desktop nicety that pans off-viewport on a phone (the right rail
          // is only 36px, so container centre ≈ board centre).
          left: compact === true ? '50%' : centerX,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          background: 'rgba(14, 10, 6, 0.97)',
          border: '1px solid rgba(107, 78, 39, 0.3)',
          borderRadius: 10,
          padding: '20px 24px',
          textAlign: 'center',
          maxWidth: 420,
          width: '90vw',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 18,
            fontWeight: 700,
            color: '#e8d5a3',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            flexShrink: 0,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            fontFamily: 'Georgia, serif',
            fontSize: 12.5,
            color: 'rgba(196, 149, 90, 0.75)',
            flexShrink: 0,
          }}
        >
          {subtitle}
        </p>

        {eligibleSouls.length === 0 ? (
          <>
            <p
              style={{
                marginTop: 16,
                fontFamily: 'Georgia, serif',
                fontSize: 13,
                color: 'rgba(196, 149, 90, 0.75)',
              }}
            >
              No Lost Souls remain to surrender.
            </p>
            <button
              onClick={onEndBattle}
              style={{
                marginTop: 16,
                alignSelf: 'center',
                padding: '10px 16px',
                borderRadius: 4,
                border: '1px solid rgba(107, 78, 39, 0.4)',
                background: 'rgba(107, 78, 39, 0.15)',
                color: 'rgba(196, 149, 90, 0.9)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              ↩ End Battle
            </button>
          </>
        ) : (
          <>
            {/* Scroll container OUTSIDE the grid (the ZoneBrowseModal pattern):
                a flex-crushed grid with overflow on itself clipped every
                portrait to an identical ~25px sliver instead of scrolling. */}
            <div style={{ marginTop: 16, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
            <div
              data-soul-grid
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                gap: 10,
                alignContent: 'start',
              }}
            >
              {eligibleSouls.map((soul) => {
                const imageUrl = resolveCardImageUrl(soul.cardImgFile, forgeResolver);
                // Attachment link lives on the ACCESSORY row (the Site), not
                // the soul — the caller pre-derives membership; see
                // siteAttachedSoulIds in battleMath.
                const isSiteAttached = siteAttachedSoulIds.has(String(soul.id));
                const disabled = pendingSoulId !== null;
                return (
                  <button
                    key={String(soul.id)}
                    onClick={() => handlePick(soul.id)}
                    disabled={disabled}
                    style={{
                      position: 'relative',
                      padding: 0,
                      border: pendingSoulId === soul.id ? '2px solid rgba(196, 149, 90, 0.8)' : '1px solid rgba(107, 78, 39, 0.4)',
                      borderRadius: 4,
                      background: 'transparent',
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: disabled && pendingSoulId !== soul.id ? 0.4 : 1,
                      overflow: 'hidden',
                      lineHeight: 0,
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={soul.cardName}
                        draggable={false}
                        style={{ width: '100%', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: '#1e1610',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'rgba(196, 149, 90, 0.6)',
                          fontSize: 9,
                          padding: 4,
                          textAlign: 'center',
                        }}
                      >
                        {soul.cardName}
                      </div>
                    )}
                    {isSiteAttached && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          left: 2,
                          right: 2,
                          padding: '1px 3px',
                          background: 'rgba(6, 4, 2, 0.85)',
                          border: '1px solid rgba(196, 149, 90, 0.5)',
                          borderRadius: 3,
                          color: '#e8d5a3',
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                        }}
                      >
                        ⚑ in Site
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            </div>
            {/* Decline (owner direction): the chooser can refuse the pick —
                dispatches end_battle, so the battle auto-returns with NO
                soul awarded and the modal closes when battleState clears.
                Rules-wise a lost rescue owes a soul; this stays consistent
                with the app's no-hard-enforcement philosophy (the log shows
                the battle ended without a soul — table talk handles it). */}
            <button
              data-soul-decline
              onClick={onEndBattle}
              disabled={pendingSoulId !== null}
              style={{
                marginTop: 14,
                alignSelf: 'center',
                flexShrink: 0,
                padding: '6px 14px',
                borderRadius: 4,
                border: '1px solid rgba(107, 78, 39, 0.4)',
                background: 'transparent',
                color: 'rgba(196, 149, 90, 0.7)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: pendingSoulId !== null ? 'default' : 'pointer',
                opacity: pendingSoulId !== null ? 0.4 : 1,
              }}
            >
              Decline — end battle without a soul
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function BattleResolutionUI({
  band,
  scale,
  offsetX,
  offsetY,
  battleState,
  mySeat,
  opponentSeat,
  attackerSeat,
  isSpectator,
  isSolo,
  format,
  myPlayerName,
  opponentPlayerName,
  eligibleSouls,
  siteAttachedSoulIds,
  forgeResolver,
  bandHasCards,
  onResolveBattle,
  onEndBattle,
  onSurrenderSoul,
  holdPhase,
  compact,
  suppressResolution,
}: BattleResolutionUIProps) {
  // Guards against a double-fire from a fast repeat click while the pick is
  // in flight (self-review requirement, Task 14). Resets whenever the
  // eligible-souls set changes shape (e.g. the defender reloads decks away
  // the last surrenderable soul mid-pick) or the battle state moves on — a
  // fresh awaiting-soul reopening after reconnect.
  const [pendingSoulId, setPendingSoulId] = useState<bigint | null>(null);
  useEffect(() => {
    setPendingSoulId(null);
  }, [eligibleSouls, battleState]);

  // Dual-corner virtualToScreen (width only, height is CSS content-driven) —
  // same idiom as the brigade toast. Anchored INSIDE the band's bottom-left
  // corner (owner direction — the below-the-band row floated on top of
  // territory cards); the row div gets translateY(-100%) so its BOTTOM sits
  // 8 virtual px above the band's bottom edge, on the dark band background.
  // battleState 'active' and 'awaiting-soul' are mutually exclusive, so the
  // resolution-button row and the awaiting-soul pill safely share this
  // anchor.
  const rowVirtualWidth = 300;
  const topLeft = virtualToScreen(band.x + 8, band.y + band.height - 8, scale, offsetX, offsetY);
  const right = virtualToScreen(band.x + 8 + rowVirtualWidth, band.y + band.height - 8, scale, offsetX, offsetY);
  // Band horizontal midline = play-mat midline (the band spans the play area
  // edge to edge) — the soul picker centers on this, not the viewport.
  const bandCenterX = virtualToScreen(band.x + band.width / 2, band.y, scale, offsetX, offsetY).x;

  if (battleState === 'awaiting-soul') {
    return (
      <AwaitingSoulUI
        topLeft={topLeft}
        right={right}
        centerX={bandCenterX}
        mySeat={mySeat}
        opponentSeat={opponentSeat}
        attackerSeat={attackerSeat}
        isSpectator={isSpectator}
        isSolo={isSolo}
        format={format}
        myPlayerName={myPlayerName}
        opponentPlayerName={opponentPlayerName}
        eligibleSouls={eligibleSouls}
        siteAttachedSoulIds={siteAttachedSoulIds}
        forgeResolver={forgeResolver}
        pendingSoulId={pendingSoulId}
        setPendingSoulId={setPendingSoulId}
        onSurrenderSoul={onSurrenderSoul}
        onEndBattle={onEndBattle}
        compact={compact}
      />
    );
  }

  if (battleState !== 'active' || isSpectator) return null;
  // Armed tap-to-move: get the resolution row out of the band's tap area so a
  // commit tap can't land on ⚑ Win Battle (see suppressResolution docs).
  if (suppressResolution === true) return null;

  const isAttacker = mySeat !== '' && mySeat === attackerSeat;
  const isDefender = mySeat !== '' && attackerSeat !== '' && mySeat !== attackerSeat;

  // Phase Stops (spec §5.4): end_battle/resolve_battle are hold-gated
  // server-side for EITHER player, so disable the row rather than dispatch a
  // doomed reducer call. battleAttackerSeat is always stamped from
  // game.currentTurn (enter_battle) and a hold always belongs to the
  // non-active seat, so during a hold the attacker is always the held party
  // and the defender is always the holder. The title mirrors the server's
  // own SenderError text (assertTurnNotHeld) — exactly what the toast would
  // show if this call ever got through anyway.
  const isTurnHeld = holdPhase !== '';
  const holdTitle = isTurnHeld
    ? `The turn is held — ${isAttacker ? opponentPlayerName : myPlayerName} has priority`
    : undefined;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 600 }}>
      <div
        data-battle-resolution
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          transform: 'translateY(-100%)',
          width: right.x - topLeft.x,
          display: 'flex',
          justifyContent: 'flex-start',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        {isAttacker && bandHasCards && (
          <ResolutionButton
            label={compact ? BUTTON_COPY['claim-victory'].compactLabel : BUTTON_COPY['claim-victory'].label}
            tone="gold"
            onClick={onResolveBattle}
            disabled={isTurnHeld}
            title={holdTitle}
            compact={compact}
          />
        )}
        {/* No End Battle button: the attacker (= turn player) walks away by
            progressing the phase — set_phase / end_turn auto-return the
            battle server-side. One button per role: attacker ⚑ Win,
            defender 🏳 Battle Lost. */}
        {isDefender && bandHasCards && (
          <ResolutionButton
            label={compact ? BUTTON_COPY['battle-lost'].compactLabel : BUTTON_COPY['battle-lost'].label}
            tone="red"
            onClick={onResolveBattle}
            disabled={isTurnHeld}
            title={holdTitle}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}
