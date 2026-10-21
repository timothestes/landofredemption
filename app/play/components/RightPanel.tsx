'use client';

import { useEffect, useRef, useState } from 'react';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import ChatPanel from '@/app/play/components/ChatPanel';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: bigint;
  gameId: bigint;
  senderId: bigint;
  text: string;
  sentAt: { microsSinceUnixEpoch: bigint };
}

interface GameAction {
  id: bigint;
  gameId: bigint;
  playerId: bigint;
  actionType: string;
  payload: string;
  turnNumber: bigint;
  phase: string;
  timestamp: { microsSinceUnixEpoch: bigint };
}

interface RightPanelProps {
  chatMessages: ChatMessage[];
  gameActions: GameAction[];
  myPlayerId: bigint;
  onSendChat: (text: string) => void | Promise<unknown>;
  playerNames: Record<string, string>;
  chatScale: number;
  unreadChatCount?: number;
  /** When true, chat input is disabled (read-only chat). Used by spectators. */
  chatDisabled?: boolean;
  /** Solo game: no one to chat with — the chat surfaces (Chat and All tabs,
   *  both of which carry the message box) are hidden and the panel shows Log. */
  hideChat?: boolean;
  // ---- Spectator-controls subsection (player-mode only) ----
  spectators?: Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>;
  myIdentityHex?: string;
  shareHandWithSpectators?: boolean;
  isGamePublic?: boolean;
  onSetShareHand?: (share: boolean) => void;
  onKickSpectator?: (spectatorId: bigint) => void;
  onSetGamePrivate?: (isPublic: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PANEL_EXPANDED_WIDTH = 'clamp(280px, 20vw, 380px)';
const PANEL_COLLAPSED_WIDTH = 36;
// Touch: the collapsed rail IS the expand button, and 36px is under the 44px
// minimum touch target. The panel clips overflow (needed for the width
// transition), so a hit-area overhang would be unclickable — widen the whole
// rail instead. Pointer keeps the original 36px.
const PANEL_COLLAPSED_WIDTH_TOUCH = 45; // 44 of button + the 1px left border

export default function RightPanel({
  chatMessages,
  gameActions,
  myPlayerId,
  onSendChat,
  playerNames,
  chatScale,
  unreadChatCount = 0,
  chatDisabled = false,
  hideChat = false,
  spectators,
  myIdentityHex,
  shareHandWithSpectators,
  isGamePublic,
  onSetShareHand,
  onKickSpectator,
  onSetGamePrivate,
}: RightPanelProps) {
  const { isLoupeVisible, toggleLoupe, previewCard, isPreviewFlipped } = useCardPreview();
  const [chatTab, setChatTab] = useState<'chat' | 'log' | 'all' | 'spectators'>(hideChat ? 'log' : 'all');
  useEffect(() => {
    if (hideChat && (chatTab === 'chat' || chatTab === 'all')) setChatTab('log');
  }, [hideChat, chatTab]);
  // Opening the panel clears the unread badge (client.tsx), so it must land
  // on a tab that actually SHOWS the messages. The tab is remembered across
  // opens, and reopening on Spectators/Log silently swallowed the unread
  // count — the player "read" nothing (found live: 2 unread → panel opened
  // on Spectators → badge gone, messages never seen).
  const wasOpenRef = useRef(isLoupeVisible);
  useEffect(() => {
    const justOpened = isLoupeVisible && !wasOpenRef.current;
    wasOpenRef.current = isLoupeVisible;
    if (!hideChat && justOpened && unreadChatCount > 0 && (chatTab === 'spectators' || chatTab === 'log')) {
      setChatTab('all');
    }
  }, [isLoupeVisible, unreadChatCount, chatTab, hideChat]);
  // The draft lives here, not in ChatPanel: collapsing the panel unmounts
  // ChatPanel, and on a phone collapsing is the ONLY way to see the board, so
  // a half-typed message was destroyed every time a player checked their
  // territory mid-sentence.
  const [chatDraft, setChatDraft] = useState('');
  const isTouch = useInputMode() === 'touch';
  const collapsedWidth = isTouch ? PANEL_COLLAPSED_WIDTH_TOUCH : PANEL_COLLAPSED_WIDTH;
  // Collapsed on touch, only the top 48px of the 44px-wide rail did anything —
  // the rest was an empty scrim running the height of the screen, reading as
  // dead space beside the sidebar. The whole strip is the control instead,
  // labelled so it says what it opens.
  const isRail = isTouch && !isLoupeVisible;

  return (
    <div
      data-right-panel
      data-panel-open={isLoupeVisible ? 'true' : undefined}
      style={{
      width: isLoupeVisible ? PANEL_EXPANDED_WIDTH : collapsedWidth,
      minWidth: isLoupeVisible ? undefined : collapsedWidth,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      // Collapsed rail gets a scrim too — transparent, it showed a bright
      // strip of raw background art down the whole right screen edge while
      // every neighboring surface is darkened.
      background: isLoupeVisible ? 'rgba(10, 8, 5, 0.97)' : 'rgba(10, 8, 5, 0.55)',
      borderLeft: '1px solid rgba(107, 78, 39, 0.3)',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
    }}>
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide panel (Tab)' : 'Show panel (Tab)'}
        aria-label={isLoupeVisible ? 'Hide chat and game log' : 'Show chat and game log'}
        style={{
          width: '100%',
          height: isRail ? 'auto' : 48,
          minHeight: 48,
          // Longhands, not the `flex` shorthand: mixing `flex` with the
          // `flexShrink` below trips React's conflicting-style warning every
          // time isRail flips (dev error overlay on every game).
          flexGrow: isRail ? 1 : 0,
          flexBasis: isRail ? '0%' : 'auto',
          background: isRail ? 'transparent' : 'rgba(10, 8, 5, 0.96)',
          borderTop: 'none',
          borderLeft: 'none',
          borderRight: 'none',
          borderBottom: isRail ? 'none' : '1px solid rgba(107, 78, 39, 0.5)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: isRail ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: isLoupeVisible ? 'flex-start' : 'center',
          gap: isRail ? 14 : 6,
          padding: isLoupeVisible ? '0 12px' : '0',
          color: 'rgba(232, 213, 163, 0.5)',
          flexShrink: 0,
        }}
      >
        {isLoupeVisible ? (
          <>
            <span style={{ fontSize: 14 }}>›</span>
            <span style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              {isTouch ? 'Chat & Log' : 'Preview'}
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 14, position: 'relative' }}>
              ‹
              {unreadChatCount > 0 && (
                // Was a 7x7px dot on the far screen edge — 0.015% of a phone
                // screen, outside the player's scan path, and the only signal
                // that an opponent had said anything. A counted badge at least
                // survives a glance; the toast in client.tsx does the rest.
                <span
                  aria-label={`${unreadChatCount} unread`}
                  style={{
                    position: 'absolute',
                    top: -9,
                    right: -11,
                    minWidth: 17,
                    height: 17,
                    padding: '0 4px',
                    borderRadius: 999,
                    background: '#c4955a',
                    color: '#1a1206',
                    fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: '17px',
                    textAlign: 'center',
                    boxShadow: '0 0 6px rgba(196, 149, 90, 0.7)',
                    animation: 'unread-pulse 2s ease-in-out infinite',
                  }}
                >
                  {unreadChatCount > 9 ? '9+' : unreadChatCount}
                </span>
              )}
            </span>
            {isRail && (
              <span
                style={{
                  writingMode: 'vertical-rl',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 10,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  opacity: 0.8,
                }}
              >
                Chat &amp; Log
              </span>
            )}
          </>
        )}
      </button>
      {/* Keyframe for unread dot pulse */}
      {unreadChatCount > 0 && !isLoupeVisible && (
        <style>{`
          @keyframes unread-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
      {isLoupeVisible && (
        <>
          <div data-panel-preview style={{
            flexShrink: 0,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
          }}>
            {previewCard ? (
              <div style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '375 / 525',
                borderRadius: 6,
                overflow: 'hidden',
                boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 8px rgba(212,168,103,0.2)',
                background: '#000',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  // Unresolved forge refs ("forge:<uuid>") resolve to '' — show the
                  // card back instead of an empty src (React warns + refetches page).
                  src={getCardImageUrl(previewCard.cardImgFile) || '/gameplay/cardback.webp'}
                  alt={previewCard.cardName}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'fill',
                    transform: previewCard.isMeek && !isPreviewFlipped ? 'rotate(180deg)' : undefined,
                  }}
                />
                {previewCard.notes && (
                  <div style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    bottom: 10,
                    background: 'rgba(0, 0, 0, 0.88)',
                    border: '1px solid #c4955a',
                    borderRadius: 999,
                    padding: '5px 10px',
                    color: '#f0d9a8',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                    wordBreak: 'break-word',
                  }}>
                    {previewCard.notes}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                width: '100%',
                aspectRatio: '1 / 1.4',
                borderRadius: 6,
                border: '1px dashed rgba(107, 78, 39, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.55,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/gameplay/cardback.webp"
                  alt="Hover a card"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6, opacity: 0.7 }}
                />
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(107, 78, 39, 0.3)' }}>
            <ChatPanel
              chatMessages={chatMessages}
              gameActions={gameActions}
              myPlayerId={myPlayerId}
              onSendChat={onSendChat}
              playerNames={playerNames}
              activeTab={chatTab}
              onActiveTabChange={setChatTab}
              chatScale={chatScale}
              chatDisabled={chatDisabled}
              hideChat={hideChat}
              spectators={spectators}
              myIdentityHex={myIdentityHex}
              shareHandWithSpectators={shareHandWithSpectators}
              isGamePublic={isGamePublic}
              onSetShareHand={onSetShareHand}
              onKickSpectator={onKickSpectator}
              onSetGamePrivate={onSetGamePrivate}
              // Touch: chat is the panel's whole reason to be open, so its
              // close control collapses the panel back to the rail instead of
              // leaving a full-width shell over the board.
              onCollapsePanel={isTouch ? toggleLoupe : undefined}
              draft={chatDraft}
              onDraftChange={setChatDraft}
            />
          </div>
        </>
      )}
    </div>
  );
}
