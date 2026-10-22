'use client';

import { useState, useEffect } from 'react';
import { useToastKeyboardNav, toastFocusShadow } from '@/app/shared/components/toastKeyboardNav';
import { DeckPickerModal } from './DeckPickerModal';
import type { DeckOption } from './DeckPickerCard';
import { loadDeckForGame } from '../actions';
import { loadForgeDeckForGame } from '@/app/forge/lib/playDecks';
import type { GameState } from '../hooks/useGameState';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { useInputMode } from '@/app/shared/hooks/useInputMode';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GameOverOverlayProps {
  game: any;
  myPlayer: any;
  opponentPlayer: any;
  gameActions: any[];
  gameState: GameState;
  playAgainTriggered?: boolean;
  onPlayAgainHandled?: () => void;
  // Forge playtest games skip the deck picker for rematches — the same
  // authorized deck is reused automatically (see handleOneTapRematch below).
  isForge?: boolean;
  myDeckId?: string;
  /** Bracket games: no rematch request/accept/cancel/change-deck and no
   *  rematch status line — the series decides what comes next. */
  hideRematch?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveEndReason(
  gameActions: any[],
  myPlayer: any,
): { label: string; winnerName: string; outcome: 'won' | 'lost' | 'ended' } {
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();

    if (actionType === 'WIN') {
      const winnerId = action.playerId ?? action.actorId;
      const iWon = myPlayer?.id !== undefined && winnerId === myPlayer.id;
      return iWon
        ? { label: 'You won', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' }
        : { label: 'You lost', winnerName: '', outcome: 'lost' };
    }

    if (actionType === 'RESIGN') {
      const actorId = action.playerId ?? action.actorId;
      const iResigned = myPlayer?.id !== undefined && actorId === myPlayer.id;
      return iResigned
        ? { label: 'You resigned', winnerName: '', outcome: 'lost' }
        : { label: 'Opponent resigned', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' };
    }

    if (actionType === 'TIMEOUT') {
      return { label: 'Opponent disconnected', winnerName: myPlayer?.displayName ?? 'You', outcome: 'won' };
    }
  }

  return { label: 'Game ended', winnerName: '', outcome: 'ended' };
}

// ---------------------------------------------------------------------------
// Component — temporary toast + rematch logic (no blocking modal)
// ---------------------------------------------------------------------------

export default function GameOverOverlay({
  game,
  myPlayer,
  opponentPlayer,
  gameActions,
  gameState,
  playAgainTriggered,
  onPlayAgainHandled,
  isForge,
  myDeckId,
  hideRematch = false,
}: GameOverOverlayProps) {
  const { isLoupeVisible } = useCardPreview();
  // Touch: interactive buttons get the 44px minimum target (min-height grows
  // the padding via the button's own vertical centering; fonts stay put).
  // Pointer rendering is untouched.
  const isTouch = useInputMode() === 'touch';
  const { label, outcome } = deriveEndReason(gameActions, myPlayer);
  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const mySeat = myPlayer?.seat?.toString() ?? '0';

  // Both players get a persistent result screen — winner and loser alike.
  const didWin = outcome === 'won';
  const showResultModal = didWin || outcome === 'lost';

  // Rematch state from game (derived before effects that use it)
  const rematchRequestedBy = game?.rematchRequestedBy ?? '';
  const rematchResponse = game?.rematchResponse ?? '';
  const iRequested = rematchRequestedBy === mySeat;
  const opponentRequested = rematchRequestedBy !== '' && !iRequested;

  // Toast visibility (only for non-opponent-left cases)
  const [toastVisible, setToastVisible] = useState(true);
  // Modal dismissed state
  const [modalDismissed, setModalDismissed] = useState(false);

  // Auto-dismiss toast after 4 seconds — only the generic "Game ended"
  // fallback uses a toast; wins and losses use the persistent modal.
  useEffect(() => {
    if (outcome !== 'ended') return;
    const timer = setTimeout(() => setToastVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [outcome]);

  // Play Again from TurnIndicator — one-tap run-it-back with the last deck
  // (both normal and Forge). "Change deck" lives on the result modal / banner.
  // If the opponent has already requested a rematch, "play again" means
  // accept it — requesting on top of theirs is a server error.
  useEffect(() => {
    if (!playAgainTriggered || hideRematch) return;
    if (!rematchRequestedBy) {
      void handleOneTapRematch('request');
    } else if (opponentRequested && !rematchResponse) {
      void handleOneTapRematch('respond');
    }
    onPlayAgainHandled?.();
  }, [playAgainTriggered, rematchRequestedBy, onPlayAgainHandled, isForge, hideRematch]);

  // Deck picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'request' | 'respond'>('request');
  const [isLoading, setIsLoading] = useState(false);

  // When rematch is accepted, the server resets the game in-place.
  // The game status changes from 'finished' to 'pregame/rolling' automatically
  // via SpacetimeDB subscription — no navigation needed.

  // One-tap rematch — reuse the deck the player last played (myDeckId), no
  // picker. This is the primary "run it back" path for both normal and Forge
  // games. Forge decks are authorized once per seat at create/join time and
  // reload via loadForgeDeckForGame; normal decks reload via loadDeckForGame
  // and carry the player's current paragon. If the deck can't be loaded we fall
  // back to the picker (normal only) so the player is never stuck on a dead
  // button. request_rematch/respond_rematch don't re-check deck authorization,
  // so this is the only place enforcing "same deck" for a one-tap rematch.
  const handleOneTapRematch = async (mode: 'request' | 'respond') => {
    if (!myDeckId) {
      // No known last deck — fall back to the picker (shouldn't happen for Forge).
      handleChangeDeck(mode);
      return;
    }
    setIsLoading(true);
    try {
      if (isForge) {
        const r = await loadForgeDeckForGame(myDeckId);
        if (r.ok === false) { console.error('Forge rematch deck load failed:', r.error); return; }
        const deckData = JSON.stringify(r.deckData);
        if (mode === 'request') gameState.requestRematch(myDeckId, deckData, r.deck.paragon, r.deck.format || 'Type 1');
        else gameState.respondRematch(true, myDeckId, deckData, r.deck.paragon, r.deck.format || 'Type 1');
      } else {
        const result = await loadDeckForGame(myDeckId);
        const deckData = JSON.stringify(result.deckData);
        const paragon = myPlayer?.paragon ?? '';
        const format = result.deck.format || 'Type 1';
        if (mode === 'request') gameState.requestRematch(myDeckId, deckData, paragon, format);
        else gameState.respondRematch(true, myDeckId, deckData, paragon, format);
      }
    } catch (e) {
      console.error('Rematch deck load failed:', e);
      if (!isForge) handleChangeDeck(mode); // don't strand the player on a dead button
    } finally {
      setIsLoading(false);
    }
  };

  // Change deck (normal only) — open the picker; handleDeckSelected fires the
  // request/respond using pickerMode. Forge decks are seat-locked, so Forge
  // never surfaces this escape hatch.
  const handleChangeDeck = (mode: 'request' | 'respond') => {
    setPickerMode(mode);
    setPickerOpen(true);
  };

  // Deck selected handler
  const handleDeckSelected = async (deck: DeckOption) => {
    setPickerOpen(false);
    setIsLoading(true);
    try {
      const result = await loadDeckForGame(deck.id);
      const deckData = JSON.stringify(result.deckData);
      const paragon = deck.paragon || '';
      const format = deck.format || 'Type 1';
      if (pickerMode === 'request') {
        gameState.requestRematch(deck.id, deckData, paragon, format);
      } else {
        gameState.respondRematch(true, deck.id, deckData, paragon, format);
      }
    } catch (e) {
      console.error('Failed to load deck:', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Show opponent's rematch request as a persistent banner
  // Hidden while the picker is open — the banner would float above the
  // body-portaled dialog (z-50) and steal clicks in its footprint. It
  // returns if the picker is dismissed without a selection.
  // Also hidden while the result modal is up: the modal backdrop (z-900) sat
  // on top of the banner (z-800), so Accept was visible but unclickable —
  // elementFromPoint returned the backdrop. While the modal is showing, the
  // request is surfaced inside it instead (Accept Rematch).
  const showRematchBanner =
    !hideRematch && opponentRequested && !rematchResponse && !pickerOpen && (modalDismissed || !showResultModal);
  // Show waiting status
  const showWaitingStatus = !hideRematch && iRequested && !rematchResponse;
  // Show rematch result
  const showRematchResult = !hideRematch && (rematchResponse === 'declined' || rematchResponse === 'accepted');

  return (
    <>
      {/* Persistent result modal — both winner and loser get one */}
      {showResultModal && !modalDismissed && (
        <GameOverModal
          didWin={didWin}
          label={label}
          oppName={oppName}
          opponentRequested={!hideRematch && opponentRequested && !rematchResponse}
          isLoupeVisible={isLoupeVisible}
          // If the opponent already requested a rematch while this modal was
          // up, "play again" / "change deck" must RESPOND to their request —
          // firing a second request is a server error.
          onPlayAgain={hideRematch ? undefined : () => {
            setModalDismissed(true);
            void handleOneTapRematch(opponentRequested ? 'respond' : 'request');
          }}
          // Normal games can swap decks between rematches; Forge decks are
          // seat-locked, so the escape hatch is hidden there.
          onChangeDeck={isForge || hideRematch ? undefined : () => {
            setModalDismissed(true);
            handleChangeDeck(opponentRequested ? 'respond' : 'request');
          }}
          onDismiss={() => setModalDismissed(true)}
        />
      )}

      {/* Temporary toast — auto-dismisses (generic/unknown end only) */}
      {outcome === 'ended' && toastVisible && (() => {
        const isWin = label === 'Opponent resigned' || label === 'Opponent disconnected';
        const isLoss = label === 'You resigned';
        const accent = isWin
          ? { border: 'rgba(80, 180, 100, 0.55)', color: 'rgba(160, 230, 170, 0.95)' }
          : isLoss
            ? { border: 'rgba(200, 80, 80, 0.55)', color: 'rgba(240, 160, 160, 0.95)' }
            : { border: 'rgba(var(--gf-border-rgb), 0.5)', color: 'var(--gf-text-bright)' };
        return (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 800,
            background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
            border: `1px solid ${accent.border}`,
            borderRadius: 8,
            padding: '14px 28px',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            animation: 'fadeInCenter 0.3s ease',
          }}>
            <p style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 14,
              fontWeight: 700,
              color: accent.color,
              letterSpacing: '0.06em',
            }}>
              {label}
            </p>
          </div>
        );
      })()}

      {/* Rematch request banner from opponent */}
      {showRematchBanner && (
        <RematchRequestBanner
          oppName={oppName}
          isLoading={isLoading}
          onAccept={() => void handleOneTapRematch('respond')}
          // Normal games can accept with a different deck; Forge is seat-locked.
          onChangeDeck={isForge ? undefined : () => handleChangeDeck('respond')}
          onDecline={() => gameState.respondRematch(false, '', '', '', '')}
        />
      )}

      {/* Waiting/result status toast. While waiting for the opponent, the
          requester can cancel and retract the pending rematch. */}
      {(showWaitingStatus || showRematchResult) && (
        <div style={{
          position: 'absolute',
          bottom: 70,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 800,
          maxWidth: 'calc(100vw - 24px)',
          background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
          border: `1px solid ${rematchResponse === 'declined' ? 'rgba(180, 60, 60, 0.3)' : 'rgba(var(--gf-border-rgb), 0.4)'}`,
          borderRadius: 8,
          padding: '10px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}>
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            color: rematchResponse === 'declined'
              ? 'rgba(220, 120, 120, 0.6)'
              : rematchResponse === 'accepted'
                ? 'rgba(var(--gf-accent-rgb), 0.7)'
                : 'rgba(var(--gf-accent-rgb), 0.5)',
          }}>
            {rematchResponse === 'declined'
              ? (iRequested ? 'Opponent declined.' : 'You declined.')
              : rematchResponse === 'accepted'
                ? 'Setting up rematch...'
                : 'Waiting for opponent...'}
          </p>
          {showWaitingStatus && (
            <button
              onClick={() => gameState.cancelRematch()}
              style={{
                padding: '5px 12px',
                minHeight: isTouch ? 44 : undefined,
                borderRadius: 4,
                border: '1px solid rgba(var(--gf-border-rgb), 0.4)',
                background: 'transparent',
                color: 'rgba(var(--gf-accent-rgb), 0.6)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.14s, color 0.14s, border-color 0.14s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.12)';
                e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.85)';
                e.currentTarget.style.borderColor = 'rgba(var(--gf-accent-rgb), 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.6)';
                e.currentTarget.style.borderColor = 'rgba(var(--gf-border-rgb), 0.4)';
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Deck picker. Rendered bare like every other DeckPickerModal site —
          its Dialog portals to document.body (PR #219), so a positioned
          wrapper here never contains it; a fixed inset-0 wrapper just sits
          above the portaled dialog and swallows its clicks. */}
      {pickerOpen && (
        <DeckPickerModal
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleDeckSelected}
          selectedDeckId={myPlayer?.deckId}
        />
      )}

      {/* Inline CSS animation */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes fadeInCenter {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Interactive sub-surfaces (extracted so the keyboard-nav hook is active only
// while the surface is on screen).
// ---------------------------------------------------------------------------

/**
 * Persistent blocking result modal shown to BOTH players when the game ends —
 * a win or a loss (rescue win, resign, or disconnect). Dismiss is the
 * affirmative default (Enter); Escape also dismisses. Highest priority so it
 * wins the keyboard over any lingering banner.
 */
function GameOverModal({
  didWin,
  label,
  oppName,
  opponentRequested,
  isLoupeVisible,
  onPlayAgain,
  onChangeDeck,
  onDismiss,
}: {
  didWin: boolean;
  label: string;
  oppName: string;
  /** The opponent already asked for a rematch — Play Again becomes Accept. */
  opponentRequested?: boolean;
  isLoupeVisible: boolean;
  /** Omitted for bracket games: Dismiss is the only option. */
  onPlayAgain?: () => void;
  /** Normal games only — open the deck picker instead of one-tap reuse. */
  onChangeDeck?: () => void;
  onDismiss: () => void;
}) {
  const isTouch = useInputMode() === 'touch';
  const dismissIndex = onPlayAgain ? 1 : 0;
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: dismissIndex + 1,
    defaultIndex: dismissIndex, // Dismiss
    priority: 2,
    onSelect: idx => (idx === dismissIndex ? onDismiss() : onPlayAgain?.()),
    onCancel: onDismiss,
  });

  const playAgainFocused = !!onPlayAgain && focusedIndex === 0;
  const dismissFocused = focusedIndex === dismissIndex;

  const eyebrow = didWin ? 'Victory' : 'Defeat';
  const title = didWin
    ? (label === 'Opponent resigned'
        ? `${oppName} Conceded`
        : label === 'Opponent disconnected'
          ? `${oppName} Left`
          : 'You Won')
    : (label === 'You resigned' ? 'You Resigned' : 'You Lost');
  const subtitle = didWin
    ? (label === 'Opponent resigned'
        ? 'Your opponent has surrendered the game.'
        : label === 'Opponent disconnected'
          ? 'Your opponent has left the game.'
          : 'You rescued enough Lost Souls to win.')
    : (label === 'You resigned'
        ? 'You surrendered the game.'
        : 'Your opponent rescued enough Lost Souls to win.');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // The right inset dodges the DESKTOP loupe column. On touch the
        // panel is a full-screen overlay (or a 45px rail), so the inset just
        // squeezed the dialog into a ~113px gutter on portrait phones.
        right: isTouch ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(var(--gf-deep-rgb), 0.7)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div style={{
        background: 'rgba(var(--gf-bg-dark-rgb), 0.97)',
        border: `1px solid ${didWin ? 'rgba(var(--gf-accent-rgb), 0.4)' : 'rgba(var(--gf-border-rgb), 0.3)'}`,
        borderRadius: 10,
        padding: '32px 36px',
        textAlign: 'center',
        maxWidth: 340,
        width: '100%',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--gf-accent-rgb), 0.08)',
      }}>
        <p style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: didWin ? 'rgba(var(--gf-accent-rgb), 0.7)' : 'rgba(var(--gf-accent-rgb), 0.5)',
        }}>{eyebrow}</p>
        <h2 style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--gf-text-bright)',
          marginTop: 8,
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
        }}>{title}</h2>
        <p style={{
          marginTop: 8,
          fontFamily: 'Georgia, serif',
          fontSize: 13,
          color: 'rgba(var(--gf-accent-rgb), 0.5)',
        }}>{subtitle}</p>

        {opponentRequested && (
          <p style={{
            marginTop: 12,
            fontFamily: 'Georgia, serif',
            fontSize: 13,
            color: 'var(--gf-text-bright)',
          }}>
            {oppName} wants to play again
          </p>
        )}

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          {onPlayAgain && (
          <button
            onClick={onPlayAgain}
            onMouseEnter={() => setFocusedIndex(0)}
            style={{
              flex: 1,
              padding: '10px 16px',
              minHeight: isTouch ? 44 : undefined,
              borderRadius: 4,
              border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
              background: playAgainFocused ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
              color: 'var(--gf-text-bright)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: playAgainFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
            }}
          >
            {opponentRequested ? 'Accept Rematch' : 'Play Again'}
          </button>
          )}
          <button
            onClick={onDismiss}
            onMouseEnter={() => setFocusedIndex(dismissIndex)}
            style={{
              flex: 1,
              padding: '10px 16px',
              minHeight: isTouch ? 44 : undefined,
              borderRadius: 4,
              border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
              background: dismissFocused ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
              color: 'var(--gf-text-bright)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: dismissFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
            }}
          >
            Dismiss
          </button>
        </div>

        {/* Change deck — quiet secondary escape hatch (normal games only). */}
        {onChangeDeck && (
          <button
            onClick={onChangeDeck}
            style={{
              marginTop: 14,
              background: 'none',
              border: 'none',
              padding: 0,
              minHeight: isTouch ? 44 : undefined,
              color: 'rgba(var(--gf-accent-rgb), 0.5)',
              fontFamily: 'Georgia, serif',
              fontSize: 12,
              letterSpacing: '0.04em',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              cursor: 'pointer',
              transition: 'color 0.14s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.85)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.5)'; }}
          >
            Change deck
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Opponent's rematch request. Accept is the affirmative default (Enter);
 * Escape declines.
 */
function RematchRequestBanner({
  oppName,
  isLoading,
  onAccept,
  onChangeDeck,
  onDecline,
}: {
  oppName: string;
  isLoading: boolean;
  onAccept: () => void;
  /** Normal games only — accept the rematch with a different deck. */
  onChangeDeck?: () => void;
  onDecline: () => void;
}) {
  const isTouch = useInputMode() === 'touch';
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 0, // Accept
    onSelect: idx => (idx === 0 ? onAccept() : onDecline()),
    onCancel: onDecline,
  });

  const acceptFocused = focusedIndex === 0;
  const declineFocused = focusedIndex === 1;

  return (
    <div style={{
      position: 'absolute',
      bottom: 70,
      left: '50%',
      transform: 'translateX(-50%)',
      // Above the result modal (z-900): this is a must-answer prompt, and at
      // 800 it rendered under the modal backdrop — visible but unclickable.
      zIndex: 950,
      // The single nowrap row is ~540px intrinsic — on a portrait phone it
      // clipped the name off the left edge and "Change deck" entirely off the
      // right (the parent is overflow:hidden). Cap and wrap instead.
      maxWidth: 'calc(100vw - 24px)',
      background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
      border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
      borderRadius: 8,
      padding: '12px 20px',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    }}>
      <p style={{
        fontFamily: 'Georgia, serif',
        fontSize: 14,
        color: 'var(--gf-text-bright)',
        textAlign: 'center',
      }}>
        {oppName} wants to play again
      </p>
      <button
        onClick={onAccept}
        onMouseEnter={() => setFocusedIndex(0)}
        disabled={isLoading}
        style={{
          padding: '8px 16px',
          minHeight: isTouch ? 44 : undefined,
          borderRadius: 4,
          border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
          background: acceptFocused ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
          color: 'var(--gf-text-bright)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: acceptFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Accept
      </button>
      <button
        onClick={onDecline}
        onMouseEnter={() => setFocusedIndex(1)}
        style={{
          padding: '8px 16px',
          minHeight: isTouch ? 44 : undefined,
          borderRadius: 4,
          border: `1px solid ${declineFocused ? 'rgba(var(--gf-accent-rgb), 0.4)' : 'rgba(var(--gf-border-rgb), 0.3)'}`,
          background: declineFocused ? 'rgba(var(--gf-accent-rgb), 0.12)' : 'transparent',
          color: declineFocused ? 'rgba(var(--gf-accent-rgb), 0.85)' : 'rgba(var(--gf-accent-rgb), 0.5)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: declineFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.5)', 'rgba(var(--gf-accent-rgb), 0.22)') : 'none',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Decline
      </button>
      {/* Change deck — quiet secondary escape hatch (normal games only). */}
      {onChangeDeck && (
        <button
          onClick={onChangeDeck}
          disabled={isLoading}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            minHeight: isTouch ? 44 : undefined,
            color: 'rgba(var(--gf-accent-rgb), 0.5)',
            fontFamily: 'Georgia, serif',
            fontSize: 12,
            letterSpacing: '0.04em',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'color 0.14s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.85)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(var(--gf-accent-rgb), 0.5)'; }}
        >
          Change deck
        </button>
      )}
    </div>
  );
}

// Export the helper so client.tsx can derive winner name
export { deriveEndReason };
