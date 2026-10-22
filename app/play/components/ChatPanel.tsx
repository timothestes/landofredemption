'use client';

import { createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type CSSProperties, type UIEvent } from 'react';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
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

type TabKey = 'chat' | 'log' | 'all' | 'spectators';

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  gameActions: GameAction[];
  myPlayerId: bigint;
  /** May return a promise; a rejection restores the draft. */
  onSendChat: (text: string) => void | Promise<unknown>;
  playerNames: Record<string, string>; // playerId.toString() → display name
  activeTab?: TabKey;
  onActiveTabChange?: (tab: TabKey) => void;
  /** Font scale for chat/log content. Defaults to 1.0. */
  chatScale?: number;
  /** When true, the chat input is disabled (read-only). Defaults to false. */
  chatDisabled?: boolean;
  /** Solo game: drop the Chat and All tabs (both carry the message box). */
  hideChat?: boolean;
  // ---- Spectator-controls subsection (player-mode only) ----
  /** Spectators in the current game. When provided, the Spectators tab renders. */
  spectators?: Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>;
  /** Local player's identity hex — used to filter own row from the list. */
  myIdentityHex?: string;
  /** Local player's shareHandWithSpectators flag. */
  shareHandWithSpectators?: boolean;
  /** Whether the game is currently public. */
  isGamePublic?: boolean;
  /** Reducer callbacks. */
  onSetShareHand?: (share: boolean) => void;
  onKickSpectator?: (spectatorId: bigint) => void;
  onSetGamePrivate?: (isPublic: boolean) => void;
  /** When set, "close chat" collapses the WHOLE right panel instead of just
   *  this section. On phones the panel is full-width and chat is its only
   *  content, so collapsing the section alone left a full-screen empty panel
   *  swallowing every tap until the tiny header rail was found. */
  onCollapsePanel?: () => void;
  /** Draft message text, owned by the parent. On a phone the panel collapses
   *  to see the board, which unmounts this component — with the draft in local
   *  state a half-typed message was destroyed every time. */
  draft: string;
  onDraftChange: (text: string) => void;
}

// Discriminated union for interleaved timeline entries
type TimelineEntry =
  | { kind: 'chat'; msg: ChatMessage; micros: bigint }
  | { kind: 'action'; action: GameAction; micros: bigint };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Keep in sync with RITUAL_TUMBLE_MS (1200) + dice reveal delay (600) in
// PregameScreen.tsx — this is how long the rolling animation runs before the
// die lands, so we hide PREGAME_ROLL log entries until then.
const PREGAME_ROLL_REVEAL_DELAY_MS = 1800;

/** Flatten a ReactNode (string, number, array, fragment, element) to plain text.
 *  Used to build searchable strings from the rich JSX returned by formatActionType. */
export function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join(' ');
  if (isValidElement(node)) {
    const props = node.props as {
      children?: ReactNode;
      name?: unknown;
      cards?: unknown;
    };
    // CardNameList passes its cards as a `cards` array with neither `name` nor
    // `children`, so it used to flatten to '' — which meant search could not
    // find any card in a multi-card line, and multi-card lines are the common
    // ones on a phone (drag-select a few cards, discard them all at once).
    if (Array.isArray(props.cards)) {
      return props.cards
        .map((c) => (c && typeof c === 'object' && 'name' in c ? String((c as { name?: unknown }).name ?? '') : ''))
        .filter(Boolean)
        .join(' ');
    }
    // HoverableCard / similar pass the card name as a `name` prop, not children.
    if (typeof props.name === 'string' && !props.children) return props.name;
    return nodeToText(props.children);
  }
  return '';
}

function formatTimestamp(micros: bigint): string {
  const ms = Number(micros / BigInt(1000));
  const date = new Date(ms);
  // Seconds matter: a Redemption turn fires a dozen actions inside one minute,
  // and "was the discard before or after the battle was called?" is exactly
  // the question the log gets opened to settle. Without them every entry in a
  // busy turn reads with the same timestamp.
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  DRAW: 'drew a card',
  // DRAW_MULTIPLE is handled inline in formatActionType (with count + private card names)
  MOVE_CARD: 'moved a card',
  MOVE_CARDS_BATCH: 'moved multiple cards',
  SEARCH_OWN_DECK: 'is searching their deck',
  SHUFFLE_DECK: 'shuffled their deck',
  SHUFFLE: 'shuffled their deck',
  SHUFFLE_CARD_INTO_DECK: 'shuffled a card into their deck',
  SHUFFLE_INTO_DECK: 'shuffled a card into their deck',
  MEEK_CARD: 'converted a card to meek',
  MEEK: 'converted a card to meek',
  UNMEEK_CARD: 'converted a card from meek',
  UNMEEK: 'converted a card from meek',
  FLIP_CARD: 'flipped a card',
  ADD_COUNTER: 'added a counter',
  REMOVE_COUNTER: 'removed a counter',
  SET_NOTE: 'set a note on a card',
  EXCHANGE: 'exchanged cards with their deck',
  EXCHANGE_CARDS: 'exchanged cards with their deck',
  SET_PHASE: 'moved to a new phase',
  END_TURN: 'ended their turn',
  ROLL_DICE: 'rolled dice',
  SEND_CHAT: 'sent a message',
  SET_PLAYER_OPTION: 'changed a setting',
  RESIGN: 'resigned',
  RESIGN_GAME: 'resigned',
  LEAVE_GAME: 'left the game',
  UPDATE_CARD_POSITION: 'repositioned a card',
  PREGAME_ROLL: 'rolled for first player',
  // REG Pre-Game Phase. PREGAME_STARS_REVEALED / PREGAME_STAR_RESOLVED carry
  // card payloads rendered in formatActionType; these are the parse-failure
  // fallbacks.
  PREGAME_STAR_PHASE: 'began the pre-game phase',
  PREGAME_STARS_REVEALED: 'revealed star cards',
  PREGAME_STARS_NONE: 'revealed no star cards',
  PREGAME_STAR_RESOLVED: 'resolved a star card',
  PREGAME_SOULS_DONE: 'finished activating Lost Souls',
  PREGAME_IDLE_SKIP: 'ran out of time in the pre-game phase',
  PLAYER_JOINED: 'joined the game',
  GAME_CREATED: 'created the game',
  REMATCH_REQUESTED: 'wants to play again',
  REMATCH_RESPONSE: 'responded to rematch',
  // Battle actions carry rich payloads rendered in formatActionType; these
  // are the payload-parse-failure fallbacks (previously they fell through to
  // the raw lowercased type: "resolve battle", "surrender soul", …).
  ENTER_BATTLE: 'moved a card into battle',
  RESOLVE_BATTLE: 'resolved the battle',
  SURRENDER_SOUL: 'gave up a lost soul',
  BATTLE_END: 'ended the battle',
  // Phase Stops — payloads rendered in formatActionType; these are the
  // parse-failure fallbacks.
  STOP_HOLD: 'requested action priority',
  STOP_RELEASE: 'resolved a priority request',
  // The Foretelling Angel's toggle — payload rendered in formatActionType;
  // this is the parse-failure fallback.
  TOGGLE_TOP_DECK_REVEAL: 'toggled their top-deck reveal',
  // How the game ENDED had no entry at all, so the single most important line
  // in the log rendered through the raw-type fallback as the literal word
  // "win" ("alice win"). WIN/TIMEOUT carry payloads rendered in
  // formatActionType; these are the parse-failure fallbacks.
  WIN: 'won the game',
  TIMEOUT: 'won on the clock',
  DISCONNECT_TIMEOUT_WARNING: 'disconnected — forfeit countdown started',
  // Pause / resume — a paused game is the most confusing state to walk into
  // with no explanation of who paused it.
  PAUSE_REQUESTED: 'asked to pause the game',
  PAUSE_ACCEPTED: 'agreed to pause',
  PAUSE_DECLINED: 'declined the pause',
  PAUSE_REQUEST_CANCELLED: 'withdrew the pause request',
  RESUME_REQUESTED: 'asked to resume',
  RESUME_ACCEPTED: 'agreed to resume',
  RESUME_DECLINED: 'declined the resume',
  // Rematch — the log runs on into the next game (the rematch reuses the same
  // game id), so this line is the only boundary between them.
  REMATCH_STARTED: 'started a rematch',
  REMATCH_DECLINED: 'declined the rematch',
  REMATCH_CANCELLED: 'cancelled the rematch',
  PREGAME_DECK_CHANGE: 'switched decks before the game',
  PLAYER_LEFT: 'left the game',
  RELOAD_DECK: 'reloaded their deck',
  SHUFFLE_OPPONENT_DECK: "shuffled their opponent's deck",
  SHUFFLE_SOUL_DECK: 'shuffled the soul deck',
  KEEP_ONE_SHUFFLE_DRAW: 'shuffled a card back and drew',
  RANDOM_OPPONENT_HAND_TO_ZONE: "took a card at random from their opponent's hand",
  RANDOM_RESERVE_TO_ZONE: 'moved a card at random out of reserve',
  REORDER_LOB: 'reordered the Land of Bondage',
  REMOVE_TOKEN: 'removed a token',
  DISCARD_CHARACTERS_FROM_RESERVE_CANCELLED: 'cancelled the reserve discard',
};

/**
 * Action types whose log line is a fixed sentence with nothing per-entry to
 * read, so a run of them by the same player collapses to one line with a
 * count. Anything that names a card, carries a roll, or reports a result is
 * deliberately absent — folding those would hide information.
 */
const REPEATABLE_ACTION_TYPES = new Set([
  'DRAW',
  'SHUFFLE',
  'SHUFFLE_DECK',
  'ADD_COUNTER',
  'REMOVE_COUNTER',
  'UPDATE_CARD_POSITION',
]);

/** Human phrasing for a collapsed run, keyed by the underlying action type. */
const REPEAT_PHRASES: Record<string, (n: number) => string> = {
  DRAW: (n) => `drew ${n} cards`,
  SHUFFLE: (n) => `shuffled their deck ${n} times`,
  SHUFFLE_DECK: (n) => `shuffled their deck ${n} times`,
  ADD_COUNTER: (n) => `added ${n} counters`,
  REMOVE_COUNTER: (n) => `removed ${n} counters`,
  UPDATE_CARD_POSITION: (n) => `repositioned ${n} cards`,
};

/**
 * Set on touch so a card name in the log can open a reader. On a pointer
 * device the name feeds the right panel's loupe on hover; that loupe is
 * `display: none` on touch (globals.css), so the dotted underline and
 * `cursor: pointer` were advertising an affordance that did nothing — on the
 * one surface a phone player actually uses to ask "what card was that?".
 */
const LogCardTapContext = createContext<((card: { name: string; img: string }) => void) | null>(null);

function HoverableCard({ name, img }: { name: string; img?: string }) {
  const { setPreviewCard } = useCardPreview();
  const onTapCard = useContext(LogCardTapContext);
  if (name === 'a face-down card' || !img) return <span>{name}</span>;
  if (onTapCard) {
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => onTapCard({ name, img })}
        style={{
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: 2,
          cursor: 'pointer',
          // The name sits mid-sentence, so it can't be padded to 44px without
          // wrecking the line. Widen the strike zone vertically instead — the
          // inline box grows, the visual line height does not.
          padding: '6px 0',
          margin: '-6px 0',
        }}
      >
        {name}
      </span>
    );
  }
  return (
    <span
      style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2, cursor: 'pointer' }}
      onMouseEnter={() => setPreviewCard({ cardName: name, cardImgFile: img ?? '' })}
      onMouseLeave={() => {}}
    >
      {name}
    </span>
  );
}

/** Full-screen card scan, opened by tapping a card name in the log on touch. */
function LogCardReader({ card, onClose }: { card: { name: string; img: string }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        // Above the panel's own 300 and above the blocking prompts at 800 is
        // wrong — this is dismissible and must not outrank a Grant/Deny. 1200
        // matches CardReaderOverlay, which is also a read-only surface the
        // player opened deliberately.
        zIndex: 1200,
        background: 'rgba(0, 0, 0, 0.88)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getCardImageUrl(card.img) || '/gameplay/cardback.webp'}
        alt={card.name}
        style={{ maxHeight: '78%', maxWidth: '100%', objectFit: 'contain', borderRadius: 8 }}
      />
      <div style={{ color: 'var(--gf-text-bright)', fontSize: 15, textAlign: 'center', wordBreak: 'break-word' }}>{card.name}</div>
      <div style={{ color: 'rgba(232, 213, 163, 0.5)', fontSize: 12 }}>Tap anywhere to close</div>
    </div>
  );
}

function CardNameList({ cards }: { cards: { name: string; img: string }[] }) {
  return (
    <>
      {cards.map((c, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <HoverableCard name={c.name} img={c.img} />
        </span>
      ))}
    </>
  );
}

export function formatActionType(actionType: string, payload?: string, playerNames?: Record<string, string>, actorPlayerId?: string, viewerPlayerId?: string): ReactNode {
  if (actionType.endsWith('_REPEAT') && payload) {
    try {
      const data = JSON.parse(payload);
      const phrase = REPEAT_PHRASES[data.of];
      if (phrase && typeof data.count === 'number') return phrase(data.count);
    } catch { /* fall through */ }
  }
  // How the game ended. Both of these used to fall through to the raw-type
  // fallback, so the last and most consequential line in the log read "alice
  // win" / "bob timeout" with the payload — the soul count that decided it,
  // and which side the timeout actually went against — thrown away.
  if (actionType === 'WIN' && payload) {
    try {
      const data = JSON.parse(payload);
      const goal = data.format === 'T2' ? 7 : 5;
      return (
        <>
          <strong>won the game</strong>
          {typeof data.soulCount === 'number' ? ` — ${data.soulCount}/${goal} souls rescued` : ''}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'TIMEOUT' && payload) {
    try {
      const data = JSON.parse(payload);
      // The two reasons are logged against OPPOSITE players: a claimed win is
      // logged by the winner, a disconnect timeout by the player who dropped.
      if (data.reason === 'claimed_by_opponent') {
        return <><strong>won the game</strong> — claimed after their opponent ran out of time</>;
      }
      if (data.reason === 'disconnect_timeout') {
        return <><strong>lost the game</strong> — disconnected and the timer ran out</>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'ROLL_DICE' && payload) {
    try {
      const data = JSON.parse(payload);
      return `rolled a d${data.sides} → ${data.result}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'STOP_HOLD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.phase === 'end') return '⏸ requests priority before the turn ends';
      const label = typeof data.phase === 'string' && data.phase
        ? data.phase.charAt(0).toUpperCase() + data.phase.slice(1)
        : 'a phase';
      return `⏸ requests priority before ${label}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'STOP_RELEASE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.reason === 'grant') return '▶ granted action priority';
      if (data.reason === 'deny') return '▶ declined the priority request';
      if (data.reason === 'timeout') return '▶ priority request timed out';
      return '▶ passed — turn resumes'; // legacy rev-3 reasons (manual / toggle-off)
    } catch { /* fall through */ }
  }
  if (actionType === 'GAME_STARTED' && payload) {
    try {
      const data = JSON.parse(payload);
      const chosenName = data.chosenName ?? ('Player ' + (Number(data.chosenSeat) + 1));
      return `chose ${chosenName} to go first`;
    } catch { /* fall through */ }
  }
  if (actionType === 'PREGAME_ROLL' && payload) {
    try {
      const data = JSON.parse(payload);
      const winnerRoll = data.winner === '0' ? data.result0 : data.result1;
      const loserRoll = data.winner === '0' ? data.result1 : data.result0;
      return `won the roll: ${winnerRoll} vs ${loserRoll}`;
    } catch { /* fall through */ }
  }
  // REG Pre-Game Phase: name the star cards, hoverable like every other card
  // reference in the log. The payload carries {name, img} per card because
  // HoverableCard degrades to plain text without an image.
  if (actionType === 'PREGAME_STARS_REVEALED' && payload) {
    try {
      const data = JSON.parse(payload);
      const cards = Array.isArray(data.cards) ? data.cards : [];
      if (cards.length > 0) {
        return (
          <>
            revealed <CardNameList cards={cards} /> for the star{cards.length === 1 ? '' : 's'}
          </>
        );
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'PREGAME_STAR_RESOLVED' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        return (
          <>
            resolved the star on <HoverableCard name={data.cardName} img={data.cardImgFile} />
          </>
        );
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'DRAW_MULTIPLE') {
    if (payload) {
      try {
        const data = JSON.parse(payload);
        const count = data.count ? Number(data.count) : undefined;
        const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
        const hasCards = data.cards && Array.isArray(data.cards) && data.cards.length > 0;
        const countText = count ? `drew ${count} card${count === 1 ? '' : 's'}` : 'drew multiple cards';
        if (isViewer && hasCards) {
          return (
            <>
              {countText}: <CardNameList cards={data.cards} />
              <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
                (only visible to you)
              </span>
            </>
          );
        }
        return countText;
      } catch { /* fall through */ }
    }
    return 'drew multiple cards';
  }
  if (actionType === 'MATTHEW_DRAW_BRIGADES' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = data.brigadeCount ? Number(data.brigadeCount) : 0;
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const hasCards = data.cards && Array.isArray(data.cards) && data.cards.length > 0;
      const sourceNode = data.sourceCardName
        ? <HoverableCard name={data.sourceCardName} img={data.sourceCardImgFile} />
        : 'Matthew';
      const drewText = `drew ${count} card${count === 1 ? '' : 's'}`;
      if (isViewer && hasCards) {
        return (
          <>
            {drewText} via {sourceNode}: <CardNameList cards={data.cards} />
            <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
              (only visible to you)
            </span>
          </>
        );
      }
      return <>{drewText} via {sourceNode}</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'MEEK' || actionType === 'MEEK_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>converted <HoverableCard name={data.cardName} img={data.cardImgFile} /> to meek</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'UNMEEK' || actionType === 'UNMEEK_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>converted <HoverableCard name={data.cardName} img={data.cardImgFile} /> from meek</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'FLIP' || actionType === 'FLIP_CARD') && payload) {
    try {
      const data = JSON.parse(payload);
      if (!data.isFlipped && data.cardName) return <>flipped <HoverableCard name={data.cardName} img={data.cardImgFile} /> face up</>;
      return data.isFlipped ? 'turned a card face down' : 'flipped a card face up';
    } catch { /* fall through */ }
  }
  if (actionType === 'REVEAL_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>revealed <HoverableCard name={data.cardName} img={data.cardImgFile} /> from hand</>;
      return 'revealed a card from hand';
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_PHASE' && payload) {
    try {
      const data = JSON.parse(payload);
      // "entered the X phase", not "moved to X" — "moved to battle" /
      // "moved to discard" read exactly like a card move with a missing
      // card name next to the real move lines (wave-3 QA).
      if (data.phase) return `entered the ${data.phase} phase`;
    } catch { /* fall through */ }
  }
  if (actionType === 'SPAWN_LOST_SOUL') {
    return 'spawned a lost soul token';
  }
  if (actionType === 'REVEAL_CARDS' && payload) {
    try {
      const parsed = JSON.parse(payload);
      // New-shape payload from ability-triggered reveals — renders rich detail.
      if (parsed && !Array.isArray(parsed) && parsed.cardIds && parsed.context) {
        const ctx = parsed.context;
        const count = Number(ctx.count ?? (Array.isArray(parsed.cardIds) ? parsed.cardIds.length : 0));
        const position = ctx.position ?? 'top';
        const where = position === 'random' ? `${count} random` : `${position} ${count}`;
        const source: string | undefined = ctx.sourceCardName;
        if (source) {
          return <>revealed {where} card{count === 1 ? '' : 's'} of deck via <HoverableCard name={source} /></>;
        }
        return `revealed ${where} card${count === 1 ? '' : 's'} of deck`;
      }
      // Legacy raw cardIds array (deck-menu Reveal Top/Bottom/Random).
      if (Array.isArray(parsed)) {
        const n = parsed.length;
        return `revealed ${n} card${n === 1 ? '' : 's'}`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'SHUFFLE_AND_DRAW' && payload) {
    try {
      const data = JSON.parse(payload);
      const shuffled = Number(data.shuffled ?? 0);
      const drawn = Number(data.drawn ?? 0);
      return `shuffled ${shuffled} from hand into deck and drew ${drawn}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'DRAW_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const prefix = count === 1 ? 'drew bottom card of deck' : `drew bottom ${count} cards of deck`;
      return (
        <>
          {prefix}
          {isViewer && cards.length > 0 ? (
            <>
              : <CardNameList cards={cards} />
              <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
                (only visible to you)
              </span>
            </>
          ) : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'DISCARD_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const card: { name: string; img: string } | undefined = data.card;
      const toLob = Boolean(data.toLandOfBondage);
      return (
        <>
          {toLob ? 'played bottom card of deck (Lost Soul)' : 'discarded bottom card of deck'}
          {card?.name ? (
            <>
              : <HoverableCard name={card.name} img={card.img} />
            </>
          ) : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'UNDERDECK_TOP_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const prefix = count === 1 ? 'underdecked top card of deck' : `underdecked top ${count} cards of deck`;
      return (
        <>
          {prefix}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'RESERVE_TOP_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const routedToLob: { name: string; img: string }[] = Array.isArray(data.routedToLob) ? data.routedToLob : [];
      const hasCards = cards.length > 0;
      const prefix = count === 0
        ? 'tried to reserve top of deck'
        : count === 1
          ? 'reserved top card of deck'
          : `reserved top ${count} cards of deck`;
      return (
        <>
          {prefix}
          {hasCards ? (
            <>
              : <CardNameList cards={cards} />
            </>
          ) : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
          {routedToLob.length > 0 ? (
            <>
              {' '}— <CardNameList cards={routedToLob} /> went to land of bondage instead
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'DRAW_AND_TOPDECK_SELF' && payload) {
    try {
      const data = JSON.parse(payload);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const drew = data.drewCard;
      return (
        <>
          drew 1 and topdecked
          {sourceName ? (
            <>
              {' '}<HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
          {drew ? (
            <>
              {' '}— drew <HoverableCard name={drew.name} img={drew.img} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_CARD_OUTLINE' && payload) {
    try {
      const data = JSON.parse(payload);
      const cardName: string = data.cardName ?? 'a card';
      const color = data.color === 'good' ? 'Good' : data.color === 'evil' ? 'Evil' : '';
      if (!color) {
        return <>cleared the outline on <HoverableCard name={cardName} img="" /></>;
      }
      return (
        <>
          chose <strong>{color}</strong> on <HoverableCard name={cardName} img="" />
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_ROTATION' && payload) {
    try {
      const data = JSON.parse(payload);
      const cardName: string = data.cardName ?? 'a card';
      return (
        <>
          turned <HoverableCard name={cardName} img="" /> {data.rotated ? 'sideways' : 'upright'}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'SPAWN_TOKEN' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 1);
      const tokenName: string = data.tokenName ?? 'a token';
      const tokenImg: string = data.tokenImgFile ?? '';
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const tokenLabel = count > 1 ? `${count}× ${tokenName}` : tokenName;
      return (
        <>
          created <HoverableCard name={tokenLabel} img={tokenImg} />
          {sourceName ? (
            <>
              {' '}from <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'TOGGLE_TOP_DECK_REVEAL' && payload) {
    try {
      const data = JSON.parse(payload);
      const revealed = data.revealed === true;
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      return (
        <>
          {revealed ? 'is playing with top card of deck face up' : 'turned top card of deck face down'}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'BAND_HEROES_FROM_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const book: string = data.referenceBook ?? '';
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const noun = count === 1 ? 'Hero' : 'Heroes';
      // Banded Heroes land face-up in the Field of Battle, so the list is
      // public — no viewer-only gate like the deck-peek entries above.
      return (
        <>
          banded {count} {book ? `${book} ` : ''}{noun} from deck into battle
          {cards.length > 0 ? <>: <CardNameList cards={cards} /></> : null}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'RESURRECT_HEROES' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const noun = count === 1 ? 'Hero' : 'Heroes';
      return (
        <>
          resurrected {count} {noun}
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'DISCARD_CHARACTERS_FROM_RESERVE' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const whose = data.target === 'opponent' ? "opponent's" : 'their own';
      const noun = count === 1 ? 'character' : 'characters';
      return (
        <>
          discarded {count} {noun} from {whose} Reserve
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'PLAY_ALL_LOST_SOULS' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const sourceName: string = data.sourceCardName ?? '';
      const sourceImg: string = data.sourceCardImgFile ?? '';
      const noun = count === 1 ? 'Lost Soul' : 'Lost Souls';
      return (
        <>
          played {count} {noun} from each deck into Land of Bondage
          {sourceName ? (
            <>
              {' '}via <HoverableCard name={sourceName} img={sourceImg} />
            </>
          ) : null}
        </>
      );
    } catch { /* fall through */ }
  }
  if ((actionType === 'EXCHANGE' || actionType === 'EXCHANGE_CARDS') && payload) {
    try {
      const data = JSON.parse(payload);
      const count = data.count ? Number(data.count) : 0;
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const rawExchanged: { name: string; img: string; fromZone?: string; deckOwnerId?: string }[] = Array.isArray(data.cards) ? data.cards : [];
      // Hand cards are private — only reveal names/images to the actor themselves.
      const exchangedForDisplay = rawExchanged.map((c) => {
        if (!isViewer && c.fromZone === 'hand') {
          return { name: 'a card from hand', img: '' };
        }
        return { name: c.name, img: c.img };
      });
      const received: { name: string; img: string }[] = Array.isArray(data.received) ? data.received : [];
      const hasExchanged = exchangedForDisplay.length > 0;
      const hasReceived = received.length > 0;

      // Cross-player routing: cards going back to an opponent's deck get a
      // trailing clause so the log accurately reflects where they landed.
      const crossOwnerGroups = new Map<string, { name: string; img: string }[]>();
      for (let i = 0; i < rawExchanged.length; i++) {
        const raw = rawExchanged[i];
        const owner = raw.deckOwnerId;
        if (!owner || !actorPlayerId || owner === actorPlayerId) continue;
        const display = exchangedForDisplay[i];
        if (!display) continue;
        if (!crossOwnerGroups.has(owner)) crossOwnerGroups.set(owner, []);
        crossOwnerGroups.get(owner)!.push(display);
      }
      const crossClauses: ReactNode[] = [];
      for (const [ownerId, cards] of crossOwnerGroups) {
        const name = playerNames?.[ownerId];
        if (!name) continue;
        crossClauses.push(
          <span key={ownerId}>; <CardNameList cards={cards} /> shuffled into {name}&apos;s deck</span>
        );
      }

      if (hasExchanged && hasReceived) {
        return (
          <>
            exchanged <CardNameList cards={exchangedForDisplay} /> for <CardNameList cards={received} />
            {crossClauses}
          </>
        );
      }
      if (hasExchanged) {
        return (
          <>
            exchanged <CardNameList cards={exchangedForDisplay} /> with their deck
            {crossClauses}
          </>
        );
      }
      if (count > 0) {
        return `exchanged ${count} card${count === 1 ? '' : 's'} with their deck`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'SURRENDER_LOST_SOUL' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const targetName = data.targetOwnerId && playerNames?.[data.targetOwnerId];
        return targetName
          ? <>surrendered <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of redemption</>
          : <>surrendered <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'RESCUE_LOST_SOUL' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const fromOwnerName = data.fromOwnerId && data.fromOwnerId !== '0' && data.fromOwnerId !== actorPlayerId
          ? playerNames?.[data.fromOwnerId]
          : null;
        return fromOwnerName
          ? <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /> from {fromOwnerName}&apos;s land of bondage</>
          : <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.redirected && data.cardName) {
        return <>{data.redirected} <HoverableCard name={data.cardName} img={data.cardImgFile} /> but went to land of bondage instead</>;
      }
      if (data.cardName) {
        const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
        const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
        const cardEl = <HoverableCard name={data.cardName} img={data.cardImgFile} />;
        const fromCtx = targetName && data.from ? <> from {targetName}&apos;s {data.from}</> : null;
        if (data.to === 'discard') return targetName ? <>discarded {cardEl}{fromCtx} into {targetName}&apos;s discard</> : <>discarded {cardEl}</>;
        if (data.to === 'reserve') return targetName ? <>placed {cardEl}{fromCtx} into {targetName}&apos;s reserve</> : <>placed {cardEl} in reserve</>;
        if (data.to === 'banish') return targetName ? <>banished {cardEl}{fromCtx} into {targetName}&apos;s banish</> : <>banished {cardEl}</>;
        if (data.to === 'deck') return targetName ? <>put {cardEl}{fromCtx} into {targetName}&apos;s deck</> : 'put a card into their deck';
        if (data.to === 'hand') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s hand</>
            : <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to hand</>;
        }
        if (data.to === 'territory') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s territory</>
            : <>played <HoverableCard name={data.cardName} img={data.cardImgFile} /> to territory</>;
        }
        if (data.to === 'land-of-bondage') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>sent <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of bondage</>
            : <>sent <HoverableCard name={data.cardName} img={data.cardImgFile} /> to land of bondage</>;
        }
        if (data.to === 'land-of-redemption') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          return targetName
            ? <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> to {targetName}&apos;s land of redemption</>
            : <>rescued <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
        if (data.to === 'battle') {
          return <>moved {cardEl} into battle</>;
        }
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'ENTER_BATTLE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        return <>moved <HoverableCard name={data.cardName} img={data.cardImgFile} /> into battle</>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'RESOLVE_BATTLE' && payload) {
    // Both ⚑ Win Battle (attacker) and 🏳 Battle Lost (defender) dispatch
    // resolve_battle — the caller's seat tells the log which one happened.
    try {
      const data = JSON.parse(payload);
      if (data.callerSeat && data.attackerSeat) {
        return data.callerSeat === data.attackerSeat ? 'won the battle' : 'lost the battle';
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'SURRENDER_SOUL' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const cardEl = <HoverableCard name={data.cardName} img={data.cardImgFile} />;
        // T1: the defender surrenders one of their own souls; T2/Paragon: the
        // attacker picks the soul they take (actor is also the destination).
        return actorPlayerId && data.targetOwnerId === actorPlayerId
          ? <>rescued {cardEl}</>
          : <>surrendered {cardEl}</>;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'BATTLE_END' && payload) {
    try {
      const data = JSON.parse(payload);
      const kept: string[] = Array.isArray(data.kept) ? data.kept : [];
      return kept.length > 0
        ? `ended the battle — kept in play: ${kept.join(', ')}`
        : 'ended the battle';
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_OPPONENT_CARD' && payload) {
    try {
      const data = JSON.parse(payload);
      const cardEl = data.cardName ? <HoverableCard name={data.cardName} img={data.cardImgFile} /> : 'a card';
      const ownerName = data.cardOwnerName ?? 'opponent';
      if (data.to === 'discard') return <>discarded {cardEl} from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'reserve') return <>placed {cardEl} in reserve from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'banish') return <>banished {cardEl} from {ownerName}&apos;s {data.from}</>;
      if (data.to === 'deck') return <>put a card into {ownerName}&apos;s deck from {data.from}</>;
      if (data.to === 'hand') return <>took {cardEl} from {ownerName}&apos;s {data.from} to hand</>;
      if (data.to === 'territory') return <>moved {cardEl} from {ownerName}&apos;s {data.from} to territory</>;
      if (data.to === 'land-of-bondage') return <>sent {cardEl} from {ownerName}&apos;s {data.from} to land of bondage</>;
      if (data.to === 'land-of-redemption') return <>rescued {cardEl} from {ownerName}&apos;s {data.from}</>;
      return <>moved {cardEl} from {ownerName}&apos;s {data.from} to {data.to}</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_TOP_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>moved {cardEl} to top of {targetName}&apos;s deck</>
        : <>moved {cardEl} to top of their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_BOTTOM_OF_DECK' && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>moved {cardEl} to bottom of {targetName}&apos;s deck</>
        : <>moved {cardEl} to bottom of their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_TO_BOTTOM_OF_DECK_GROUP' && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
      const cards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];
      const namedCards = cards.filter((c) => c.name && c.name !== 'a face-down card');
      const deckLabel = targetName ? <>{targetName}&apos;s deck</> : <>their deck</>;
      if (namedCards.length === cards.length && namedCards.length > 0) {
        return <>underdecked <CardNameList cards={namedCards} /> to {deckLabel}</>;
      }
      return <>underdecked {data.count} cards to {deckLabel}</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'MOVE_CARDS_BATCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const parts: ReactNode[] = [];
      const sourceName = data.sourceOwnerId && playerNames?.[data.sourceOwnerId] ? playerNames[data.sourceOwnerId] : null;
      const deckLabel = sourceName ? `${sourceName}'s deck` : 'deck';
      // Build a "from" suffix. Prefer the explicit fromSource (deck-derived
      // batch ops like "top of deck"); otherwise, if every card shares the
      // same originating zone, surface that — e.g. "from territory".
      const explicitFromSuffix = data.fromSource === 'top-of-deck' ? ` from top of ${deckLabel}`
        : data.fromSource === 'bottom-of-deck' ? ` from bottom of ${deckLabel}`
        : data.fromSource === 'random-from-deck' ? ` randomly from ${deckLabel}`
        : '';
      const cardFromZones: string[] = Array.isArray(data.cards)
        ? data.cards.map((c: { from?: string }) => c?.from).filter((z: string | undefined): z is string => !!z)
        : [];
      const allSameFrom = cardFromZones.length > 0 && cardFromZones.length === data.cards?.length
        && cardFromZones.every((z) => z === cardFromZones[0]);
      const commonFromZone = allSameFrom ? cardFromZones[0] : null;
      const ZONE_LABEL: Record<string, string> = {
        territory: 'territory',
        'land-of-bondage': 'land of bondage',
        'land-of-redemption': 'land of redemption',
        'soul-deck': 'soul deck',
        hand: 'hand', deck: 'deck', discard: 'discard', reserve: 'reserve', banish: 'banish',
      };
      const sharedFromSuffix = explicitFromSuffix
        || (commonFromZone && commonFromZone !== data.toZone
              ? ` from ${sourceName ? `${sourceName}'s ` : 'their '}${ZONE_LABEL[commonFromZone] ?? commonFromZone}`
              : '');
      const isCrossPlayerBatch = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
      const targetNameBatch = isCrossPlayerBatch && playerNames?.[data.targetOwnerId];
      const intoSuffix = (zone: string) => targetNameBatch ? <> into {targetNameBatch}&apos;s {zone}</> : null;
      if (data.cards?.length) {
        if (data.toZone === 'discard') parts.push(<span key="discard">discarded <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('discard')}</span>);
        if (data.toZone === 'reserve') parts.push(<span key="reserve">reserved <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('reserve')}</span>);
        if (data.toZone === 'banish') parts.push(<span key="banish">banished <CardNameList cards={data.cards} />{sharedFromSuffix}{intoSuffix('banish')}</span>);
        if (data.toZone === 'deck') {
          const allFaceDown = data.cards.every((c: { name?: string }) => c?.name === 'a face-down card');
          const deckTarget = targetNameBatch ? <>{targetNameBatch}&apos;s deck</> : <>their deck</>;
          parts.push(
            <span key="deck">
              {allFaceDown
                ? <>put {data.cards.length === 1 ? 'a card' : `${data.cards.length} cards`} into {deckTarget}</>
                : <>put <CardNameList cards={data.cards} />{sharedFromSuffix} into {deckTarget}</>}
            </span>
          );
        }
        if (data.toZone === 'hand') {
          const isCrossPlayer = data.targetOwnerId && playerNames?.[data.targetOwnerId] && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
          const fromHiddenDeck = data.fromSource === 'top-of-deck' || data.fromSource === 'bottom-of-deck' || data.fromSource === 'random-from-deck';
          // "Drew" only applies when cards actually came from a deck. Moving from
          // territory/discard/reserve/etc. into hand is a move, not a draw.
          const isDrawFromDeck = fromHiddenDeck || commonFromZone === 'deck';
          // Drawing from own deck into own hand is private — don't reveal card names to the opponent.
          const hideFromOpponent = !targetName && fromHiddenDeck && !isViewer;
          if (hideFromOpponent) {
            const n = data.cards.length;
            parts.push(<span key="hand">drew {n === 1 ? 'a card' : `${n} cards`}{explicitFromSuffix}</span>);
          } else if (targetName) {
            parts.push(<span key="hand">moved <CardNameList cards={data.cards} /> to {targetName}&apos;s hand{explicitFromSuffix}</span>);
          } else if (isDrawFromDeck) {
            parts.push(<span key="hand">drew <CardNameList cards={data.cards} />{explicitFromSuffix}{isViewer && fromHiddenDeck ? <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>(only visible to you)</span> : null}</span>);
          } else {
            parts.push(<span key="hand">moved <CardNameList cards={data.cards} /> to hand{sharedFromSuffix}</span>);
          }
        }
        if (data.toZone === 'territory') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="territory">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s territory</> : <>played <CardNameList cards={data.cards} /> to territory</>}</span>);
        }
        if (data.toZone === 'land-of-bondage') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="lob">{targetName ? <>sent <CardNameList cards={data.cards} /> to {targetName}&apos;s land of bondage</> : <>sent <CardNameList cards={data.cards} /> to land of bondage</>}</span>);
        }
        if (data.toZone === 'land-of-redemption') {
          const isCrossPlayer = data.targetOwnerId && data.targetOwnerId !== actorPlayerId;
          const targetName = isCrossPlayer && playerNames?.[data.targetOwnerId];
          parts.push(<span key="lor">{targetName ? <>moved <CardNameList cards={data.cards} /> to {targetName}&apos;s land of redemption</> : <>rescued <CardNameList cards={data.cards} /></>}</span>);
        }
      }
      if (data.redirectedLostSouls?.length) {
        const actionWord = data.toZone === 'discard' ? 'discarded' : data.toZone === 'reserve' ? 'reserved' : 'banished';
        parts.push(<span key="redirect">{actionWord} <CardNameList cards={data.redirectedLostSouls} /> but went to land of bondage instead</span>);
      }
      if (parts.length) return <>{parts.map((p, i) => <span key={i}>{i > 0 && '; '}{p}</span>)}</>;
    } catch { /* fall through */ }
  }
  if ((actionType === 'SHUFFLE_INTO_DECK' || actionType === 'SHUFFLE_CARD_INTO_DECK') && payload) {
    try {
      const data = JSON.parse(payload);
      const isCrossPlayer = data.deckOwnerId && data.deckOwnerId !== actorPlayerId;
      const targetName = isCrossPlayer && playerNames?.[data.deckOwnerId];
      const cardEl = data.cardName && data.cardName !== 'a face-down card'
        ? <HoverableCard name={data.cardName} img={data.cardImgFile} />
        : 'a card';
      return targetName
        ? <>shuffled {cardEl} into {targetName}&apos;s deck</>
        : <>shuffled {cardEl} into their deck</>;
    } catch { /* fall through */ }
  }
  if (actionType === 'LOOK_AT_TOP' && payload) {
    // New format: JSON {count, sourceCardName, position}. Old format: bare count string.
    if (payload.startsWith('{')) {
      try {
        const data = JSON.parse(payload) as { count: number; sourceCardName?: string; position?: 'top' | 'bottom' | 'random' };
        const count = Number(data.count) || 0;
        const positionWord = data.position === 'bottom' ? 'bottom' : data.position === 'random' ? 'random' : 'top';
        const cardsWord = count === 1 ? 'card' : 'cards';
        const pickPhrase =
          positionWord === 'random'
            ? `at ${count} random ${cardsWord} from their deck`
            : `at the ${positionWord} ${count} ${cardsWord} of their deck`;
        if (data.sourceCardName) {
          return <>used <HoverableCard name={data.sourceCardName} /> to look {pickPhrase}</>;
        }
        return `looked ${pickPhrase}`;
      } catch { /* fall through */ }
    }
    const count = parseInt(payload, 10);
    if (count === 1) return 'looked at the top card of their deck';
    if (count > 1) return `looked at the top ${count} cards of their deck`;
    return 'looked at the top of their deck';
  }
  if (actionType === 'REVEAL_HAND') return 'revealed their hand for 30 seconds';
  if (actionType === 'HIDE_HAND') return 'hid their hand';
  if (actionType === 'REVEAL_RESERVE') return 'revealed their reserve';
  if (actionType === 'HIDE_RESERVE') return 'hid their reserve';
  if (actionType === 'PASS_INITIATIVE') return 'passed initiative';
  if (actionType === 'REQUEST_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const zoneName = data.zone === 'hand-reveal' ? 'hand' : data.zone === 'action-priority' ? 'action priority' : data.zone === 'initiative' ? 'initiative' : data.zone;
      const targetName = data.targetName ?? 'opponent';
      if (data.zone === 'hand-reveal') return `requested to reveal ${targetName}'s hand`;
      if (data.zone === 'action-priority') return `requested action priority`;
      if (data.zone === 'initiative') return `requested initiative`;
      return `requested to search ${targetName}'s ${zoneName}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'REQUEST_OPPONENT_ACTION' && payload) {
    try {
      const data = JSON.parse(payload);
      const targetName = data.targetName ?? 'opponent';
      let count = 0;
      try { count = data.actionParams ? (JSON.parse(data.actionParams).count ?? 0) : 0; } catch {}
      const plural = count === 1 ? '' : 's';
      switch (data.action) {
        case 'shuffle_deck': return `asked to shuffle ${targetName}'s deck`;
        case 'look_deck_top': return `asked to look at the top ${count} card${plural} of ${targetName}'s deck`;
        case 'look_deck_bottom': return `asked to look at the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'look_deck_random': return `asked to look at ${count} random card${plural} from ${targetName}'s deck`;
        case 'reveal_deck_top': return `asked to reveal the top ${count} card${plural} of ${targetName}'s deck`;
        case 'reveal_deck_bottom': return `asked to reveal the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'reveal_deck_random': return `asked to reveal ${count} random card${plural} from ${targetName}'s deck`;
        case 'draw_deck_top': return `asked to draw ${count} from the top of ${targetName}'s deck`;
        case 'draw_deck_bottom': return `asked to draw ${count} from the bottom of ${targetName}'s deck`;
        case 'draw_deck_random': return `asked to draw ${count} random card${plural} from ${targetName}'s deck`;
        case 'discard_deck_top': return `asked to discard the top ${count} card${plural} of ${targetName}'s deck`;
        case 'discard_deck_bottom': return `asked to discard the bottom ${count} card${plural} of ${targetName}'s deck`;
        case 'discard_deck_random': return `asked to discard ${count} random card${plural} from ${targetName}'s deck`;
        case 'reserve_deck_top': return `asked to send the top ${count} card${plural} of ${targetName}'s deck to reserve`;
        case 'reserve_deck_bottom': return `asked to send the bottom ${count} card${plural} of ${targetName}'s deck to reserve`;
        case 'reserve_deck_random': return `asked to send ${count} random card${plural} from ${targetName}'s deck to reserve`;
        case 'random_hand_to_discard': return `asked to discard ${count} random card${plural} from ${targetName}'s hand`;
        case 'random_hand_to_reserve': return `asked to send ${count} random card${plural} from ${targetName}'s hand to reserve`;
        case 'random_hand_to_deck_top': return `asked to send ${count} random card${plural} from ${targetName}'s hand to the top of their deck`;
        case 'random_hand_to_deck_bottom': return `asked to send ${count} random card${plural} from ${targetName}'s hand to the bottom of their deck`;
        case 'random_hand_to_deck_shuffle': return `asked to shuffle ${count} random card${plural} from ${targetName}'s hand into their deck`;
        case 'three_nails_reset': {
          let name = 'Three Nails (GoC)';
          try {
            const p = data.actionParams ? JSON.parse(data.actionParams) : {};
            if (p.cardName) name = p.cardName;
          } catch { /* legacy request without cardName */ }
          return `asked to activate ${name} reset`;
        }
        case 'shuffle_and_draw': {
          let s = 0, d = 0;
          try {
            const p = data.actionParams ? JSON.parse(data.actionParams) : {};
            s = p.shuffleCount ?? 0; d = p.drawCount ?? 0;
          } catch {}
          return `asked ${targetName} to shuffle ${s} from hand into deck and draw ${d}`;
        }
        default: return `asked to perform an action on ${targetName}'s deck`;
      }
    } catch { /* fall through */ }
  }
  if (actionType === 'APPROVE_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.zone === 'hand-reveal') return 'approved hand reveal';
      if (data.zone === 'action-priority') return 'granted action priority';
      if (data.zone === 'initiative') return 'granted initiative';
      return `allowed ${data.zone} search`;
    } catch { /* fall through */ }
  }
  if (actionType === 'DENY_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.zone === 'hand-reveal') return 'denied hand reveal';
      if (data.zone === 'action-priority') return 'denied action priority';
      if (data.zone === 'initiative') return 'denied initiative';
      return `denied ${data.zone} search`;
    } catch { /* fall through */ }
  }
  if (actionType === 'COMPLETE_ZONE_SEARCH' && payload) {
    try {
      const data = JSON.parse(payload);
      const targetName = data.targetName ?? 'opponent';
      if (data.zone === 'hand-reveal') return `finished viewing ${targetName}'s hand`;
      if (data.zone === 'action-priority') return 'finished action priority';
      if (data.zone === 'initiative') return 'finished initiative';
      if (data.zone === 'deck') {
        const suffix = data.shuffled ? ' (and shuffled it)' : ' (and chose not to shuffle it)';
        return `finished searching ${targetName}'s deck${suffix}`;
      }
      return `finished searching ${targetName}'s ${data.zone}`;
    } catch { /* fall through */ }
  }
  if (actionType === 'THREE_NAILS_RESET') {
    let name = 'Three Nails (GoC)';
    try {
      const p = JSON.parse(payload ?? '{}');
      if (p.cardName) name = p.cardName;
    } catch { /* legacy log without cardName */ }
    return `activated ${name} reset — both players drew 8`;
  }
  if (actionType === 'THREE_NAILS_RESET_CANCELLED') {
    let name = 'Three Nails (GoC)';
    try {
      const p = JSON.parse(payload ?? '{}');
      if (p.cardName) name = p.cardName;
    } catch { /* legacy log without cardName */ }
    return `tried to activate ${name}, but the source card was no longer in play`;
  }
  if (actionType === 'IMITATE_LOST_SOUL') {
    try {
      const { targetCardName, label, hasArt } = JSON.parse(payload ?? '{}');
      const short = label || targetCardName;
      return (
        <span>
          imitated <strong>{short}</strong>
          {hasArt ? '' : ' (no art)'}
        </span>
      );
    } catch {
      return <span>imitated a Lost Soul</span>;
    }
  }
  if (actionType === 'STOP_IMITATING_LOST_SOUL') {
    return <span>stopped imitating</span>;
  }
  if (actionType === 'DECK_SEARCH_NO_SHUFFLE' && payload) {
    try {
      const data = JSON.parse(payload);
      const top = Number(data.topCount) || 0;
      const bottom = Number(data.bottomCount) || 0;
      const parts: string[] = [];
      if (top > 0) parts.push(`${top} card${top === 1 ? '' : 's'} on top`);
      if (bottom > 0) parts.push(`${bottom} card${bottom === 1 ? '' : 's'} on bottom`);
      const message = parts.length > 0
        ? `stacked ${parts.join(' and ')} of their deck and chose NOT to shuffle`
        : 'searched their deck and chose NOT to shuffle';
      return (
        <span style={{ color: '#e8b56b', fontWeight: 600 }}>
          {message}
        </span>
      );
    } catch { /* fall through */ }
  }
  if (actionType === 'ADD_COUNTER' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>added {data.color} counter to <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
    } catch { /* fall through */ }
  }
  if (actionType === 'REMOVE_COUNTER' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) return <>removed {data.color} counter from <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
    } catch { /* fall through */ }
  }
  if (actionType === 'RANDOM_HAND_TO_ZONE' && payload) {
    try {
      const data = JSON.parse(payload);
      const count = Number(data.count ?? 0);
      const plural = count === 1 ? '' : 's';
      const destination: string = data.destination ?? '';
      const isViewer = actorPlayerId && viewerPlayerId && actorPlayerId === viewerPlayerId;
      const rawCards: { name: string; img: string }[] = Array.isArray(data.cards) ? data.cards : [];

      let verb: string;
      if (destination === 'discard') verb = `discarded ${count} random card${plural} from their hand`;
      else if (destination === 'reserve') verb = `sent ${count} random card${plural} from their hand to reserve`;
      else if (destination === 'banish') verb = `banished ${count} random card${plural} from their hand`;
      else if (destination === 'land-of-bondage') verb = `sent ${count} random card${plural} from their hand to land of bondage`;
      else if (destination === 'deck (top)') verb = `put ${count} random card${plural} from their hand on top of their deck`;
      else if (destination === 'deck (bottom)') verb = `put ${count} random card${plural} from their hand on the bottom of their deck`;
      else if (destination === 'deck (shuffle)') verb = `shuffled ${count} random card${plural} from their hand into their deck`;
      else verb = `moved ${count} random card${plural} from their hand to ${destination}`;

      if (isViewer && rawCards.length > 0) {
        return (
          <>
            {verb}: <CardNameList cards={rawCards} />
            <span style={{ fontSize: 'calc(9px * var(--chat-fs, 1))', fontStyle: 'italic', color: 'rgba(232, 213, 163, 0.35)', marginLeft: 4 }}>
              (only visible to you)
            </span>
          </>
        );
      }
      return verb;
    } catch { /* fall through */ }
  }
  if (actionType === 'SET_NOTE' && payload) {
    try {
      const data = JSON.parse(payload);
      if (data.cardName) {
        const note = typeof data.note === 'string' ? data.note : '';
        const previous = typeof data.previousNote === 'string' ? data.previousNote : '';
        if (!note && previous) {
          return <>cleared note on <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
        if (note && !previous) {
          return <>added note &ldquo;{note}&rdquo; to <HoverableCard name={data.cardName} img={data.cardImgFile} /></>;
        }
        if (note && previous) {
          return <>edited note on <HoverableCard name={data.cardName} img={data.cardImgFile} /> to &ldquo;{note}&rdquo;</>;
        }
      }
    } catch { /* fall through */ }
  }
  return ACTION_TYPE_LABELS[actionType] ?? actionType.toLowerCase().replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatPanel({
  chatMessages,
  gameActions,
  myPlayerId,
  onSendChat,
  playerNames,
  activeTab: controlledTab,
  onActiveTabChange,
  chatScale = 1,
  chatDisabled = false,
  hideChat = false,
  spectators,
  myIdentityHex,
  shareHandWithSpectators,
  isGamePublic,
  onSetShareHand,
  onKickSpectator,
  onSetGamePrivate,
  onCollapsePanel,
  draft,
  onDraftChange,
}: ChatPanelProps) {
  const showSpectatorsTab = spectators !== undefined;
  const isTouch = useInputMode() === 'touch';
  const [isOpen, setIsOpen] = useState(true);
  const [internalTab, setInternalTab] = useState<TabKey>('all');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = onActiveTabChange ?? setInternalTab;
  const inputText = draft;
  const setInputText = onDraftChange;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  /** Card scan opened by tapping a card name in the log (touch only). */
  const [readerCard, setReaderCard] = useState<{ name: string; img: string } | null>(null);

  // Delay PREGAME_ROLL log entries so they appear when the dice land, not
  // when the server broadcasts the roll. Actions present on first mount are
  // considered "already revealed" so a mid-game refresh doesn't re-hide them.
  const seenActionIdsRef = useRef<Set<string> | null>(null);
  const revealTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [hiddenActionIds, setHiddenActionIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (seenActionIdsRef.current === null) {
      seenActionIdsRef.current = new Set(gameActions.map((a) => a.id.toString()));
      return;
    }
    const newIds: string[] = [];
    for (const action of gameActions) {
      const id = action.id.toString();
      if (seenActionIdsRef.current.has(id)) continue;
      seenActionIdsRef.current.add(id);
      if (action.actionType === 'PREGAME_ROLL') newIds.push(id);
    }
    if (newIds.length === 0) return;
    setHiddenActionIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });
    for (const id of newIds) {
      // Timers are tracked in a ref and cleared only on unmount. They used to
      // be cleaned up by this effect, which re-runs on every `gameActions`
      // change: any action landing inside the 1.8s window cleared the pending
      // reveal, and the re-run returned early at `newIds.length === 0` without
      // rescheduling — so the roll line stayed hidden for the rest of the
      // session, and "who won the roll" silently vanished from the log.
      const t = setTimeout(() => {
        revealTimersRef.current.delete(id);
        setHiddenActionIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, PREGAME_ROLL_REVEAL_DELAY_MS);
      revealTimersRef.current.set(id, t);
    }
  }, [gameActions]);

  useEffect(() => {
    const timers = revealTimersRef.current;
    return () => { timers.forEach((t) => clearTimeout(t)); timers.clear(); };
  }, []);

  // Memoised: the trailing `.filter` allocated a fresh array on EVERY render,
  // so `actionSearchText` and `displayActions` downstream never hit their memo
  // cache — the whole log was re-formatted (JSON.parse + JSX build per entry,
  // twice over) on every keystroke in the chat and search inputs.
  const visibleGameActions = useMemo(() => (
    (hiddenActionIds.size === 0
      ? gameActions
      : gameActions.filter((a) => !hiddenActionIds.has(a.id.toString()))
    ).filter((a) => {
      // Suppress "finished action priority" / "finished initiative" — the grant/request pair is enough.
      if (a.actionType === 'COMPLETE_ZONE_SEARCH' && a.payload) {
        try {
          const z = JSON.parse(a.payload).zone;
          if (z === 'action-priority' || z === 'initiative') return false;
        } catch { /* fall through */ }
      }
      return true;
    })
  ), [gameActions, hiddenActionIds]);

  // ---- Search filter ----
  // Build a lowercased searchable string for each visible action by flattening
  // the rich JSX returned by formatActionType to plain text. Memoized by id +
  // payload so re-renders don't redo the work.
  // Built only while a search is actually running. It used to be computed on
  // every render — a JSON.parse plus a full JSX build plus a tree walk for
  // every entry in the game's history — so 100% of normal play paid for an
  // index nobody was querying.
  const actionSearchText = useMemo(() => {
    const map = new Map<string, string>();
    if (!isSearching) return map;
    for (const a of visibleGameActions) {
      const playerName = playerNames[a.playerId.toString()] ?? `Player ${a.playerId}`;
      const verb = formatActionType(a.actionType, a.payload, playerNames, a.playerId.toString(), myPlayerId.toString());
      // Turn and phase are rendered on every entry ("T4 · battle · …") but
      // were absent from the index, so searching "t4" or "battle" — the two
      // things you actually search a game log for — matched nothing.
      map.set(
        a.id.toString(),
        `${playerName} ${nodeToText(verb)} ${a.actionType} t${a.turnNumber} ${a.phase}`.toLowerCase(),
      );
    }
    return map;
  }, [isSearching, visibleGameActions, playerNames, myPlayerId]);

  const matchesQuery = (text: string) => !isSearching || text.includes(normalizedQuery);

  const senderNameOf = (msg: { senderId: bigint }) =>
    msg.senderId === 0n ? '' : (playerNames[msg.senderId.toString()] ?? '');

  const filteredChat = isSearching
    ? chatMessages.filter((msg) =>
        `${senderNameOf(msg)} ${msg.text}`.toLowerCase().includes(normalizedQuery),
      )
    : chatMessages;

  // System messages (senderId === 0n) are spectator/admin notifications —
  // they belong in the LOG tab next to game actions, not in the user-to-user
  // CHAT tab. They still appear in the ALL tab via filteredChat.
  const userChat = useMemo(
    () => filteredChat.filter((m) => m.senderId !== 0n),
    [filteredChat],
  );
  const systemChat = useMemo(
    () => filteredChat.filter((m) => m.senderId === 0n),
    [filteredChat],
  );

  const filteredActions = isSearching
    ? visibleGameActions.filter((a) => matchesQuery(actionSearchText.get(a.id.toString()) ?? ''))
    : visibleGameActions;

  // Collapse runs of same-actor MOVE_TO_BOTTOM_OF_DECK actions into a single
  // synthetic MOVE_TO_BOTTOM_OF_DECK_GROUP entry so e.g. underdecking 5 cards
  // from a top-N reveal renders as one line instead of five.
  const displayActions = useMemo(() => {
    const result: GameAction[] = [];
    let i = 0;
    while (i < filteredActions.length) {
      const action = filteredActions[i];
      if (action.actionType === 'MOVE_TO_BOTTOM_OF_DECK') {
        let j = i + 1;
        while (
          j < filteredActions.length
          && filteredActions[j].actionType === 'MOVE_TO_BOTTOM_OF_DECK'
          && filteredActions[j].playerId === action.playerId
        ) {
          j++;
        }
        const runLength = j - i;
        if (runLength >= 2) {
          const cards: { name: string; img: string }[] = [];
          let targetOwnerId: string | undefined;
          for (let k = i; k < j; k++) {
            try {
              const data = JSON.parse(filteredActions[k].payload || '{}');
              cards.push({ name: data.cardName ?? 'a face-down card', img: data.cardImgFile ?? '' });
              if (data.targetOwnerId) targetOwnerId = data.targetOwnerId;
            } catch { /* ignore */ }
          }
          const last = filteredActions[j - 1];
          result.push({
            ...last,
            id: action.id,
            actionType: 'MOVE_TO_BOTTOM_OF_DECK_GROUP',
            payload: JSON.stringify({ count: runLength, cards, targetOwnerId }),
          });
          i = j;
          continue;
        }
      }
      // Collapse a run of the same actor repeating the same plain action.
      // Drawing eight cards wrote eight identical "drew a card" entries, each
      // two lines tall — on a landscape phone the log shows about five entries
      // at a time, so one opening draw filled the entire visible log with the
      // same sentence and pushed everything that mattered off the top.
      // Restricted to types with no per-entry detail to render, so nothing
      // that names a card or carries a payload is ever folded away.
      if (REPEATABLE_ACTION_TYPES.has(action.actionType)) {
        let j = i + 1;
        while (
          j < filteredActions.length
          && filteredActions[j].actionType === action.actionType
          && filteredActions[j].playerId === action.playerId
        ) {
          j++;
        }
        const runLength = j - i;
        if (runLength >= 2) {
          const last = filteredActions[j - 1];
          result.push({
            ...last,
            id: action.id,
            actionType: `${action.actionType}_REPEAT`,
            payload: JSON.stringify({ count: runLength, of: action.actionType }),
          });
          i = j;
          continue;
        }
      }
      result.push(action);
      i++;
    }
    return result;
  }, [filteredActions]);

  const totalMatches = isSearching ? filteredChat.length + filteredActions.length : 0;

  // System messages (senderId === 0n) render in LOG, not CHAT — don't count
  // them toward the CHAT unread badge.
  const userChatCount = useMemo(
    () => chatMessages.reduce((n, m) => (m.senderId !== 0n ? n + 1 : n), 0),
    [chatMessages],
  );
  const prevChatLengthRef = useRef(userChatCount);

  // Track unread messages when chat isn't actively visible
  useEffect(() => {
    const chatVisible = isOpen && (activeTab === 'chat' || activeTab === 'all');
    if (!chatVisible && userChatCount > prevChatLengthRef.current) {
      setUnreadCount((n) => n + (userChatCount - prevChatLengthRef.current));
    }
    prevChatLengthRef.current = userChatCount;
  }, [userChatCount, isOpen, activeTab]);

  // Clear unread when opening chat or all tab
  useEffect(() => {
    if (isOpen && (activeTab === 'chat' || activeTab === 'all')) {
      setUnreadCount(0);
    }
  }, [isOpen, activeTab]);

  // ---- Auto-scroll -------------------------------------------------------
  // Replaces three near-duplicate per-tab effects that each called
  // `scrollIntoView` on a trailing sentinel. Two things were wrong with that:
  //
  //  1. The chat tab had no "just switched" case at all, so every time you
  //     tabbed over to Chat it SMOOTH-scrolled from the top of a freshly
  //     mounted list all the way down — a long, visible animation through the
  //     whole history, on every single switch. The same thing happened on
  //     every panel open for all three tabs: the panel unmounts when it
  //     collapses, so the refs that were meant to detect "just switched"
  //     re-initialised to the current tab and reported `false`.
  //  2. Nothing checked where the reader actually was, so a new action — and
  //     in this game the log grows every few seconds — yanked you to the
  //     bottom mid-sentence while you were reading back through the turn.
  //
  // Now: changing what's on screen (open / tab / search) jumps with no
  // animation, and new content only follows you if you were already at the
  // bottom. Otherwise a "new activity" pill offers the jump.
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const scrollListToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const handleListScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // A generous slop: momentum scrolling on iOS routinely stops a handful of
    // pixels short, and a reader who is "basically at the bottom" wants to
    // keep following.
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
    pinnedRef.current = atBottom;
    setShowJumpToLatest((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  // What's on screen changed (panel opened, tab switched, search toggled) —
  // land at the bottom with no animation.
  const listKey = `${isOpen ? 'open' : 'closed'}:${activeTab}:${isSearching ? 'search' : 'live'}`;
  const prevListKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevListKeyRef.current === listKey) return;
    prevListKeyRef.current = listKey;
    if (!isOpen || isSearching) { setShowJumpToLatest(false); return; }
    scrollListToBottom(false);
  }, [listKey, isOpen, isSearching, scrollListToBottom]);

  // New content arrived — follow it only if the reader hadn't scrolled away.
  useEffect(() => {
    if (!isOpen || isSearching) return;
    if (pinnedRef.current) scrollListToBottom(true);
    else setShowJumpToLatest(true);
  }, [chatMessages, gameActions, hiddenActionIds, isOpen, isSearching, scrollListToBottom]);

  // Focus the search input when the search bar opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    // Clear optimistically so typing stays responsive, but put the text back
    // if the send actually failed. Previously the field was cleared
    // unconditionally against a fire-and-forget reducer call: on a phone that
    // had dropped its socket (backgrounded tab, wifi→cellular handoff) the
    // message went nowhere, the draft was gone, and nothing was shown.
    const result = onSendChat(trimmed);
    setInputText('');
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(() => {
        // Only restore if the player hasn't started a new message meanwhile.
        if (!draftRef.current) setInputText(trimmed);
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const togglePanel = () => {
    if (isOpen && onCollapsePanel) {
      onCollapsePanel();
      return;
    }
    setIsOpen((prev) => !prev);
  };

  return (
    <LogCardTapContext.Provider value={isTouch ? setReaderCard : null}>
    {readerCard && <LogCardReader card={readerCard} onClose={() => setReaderCard(null)} />}
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
      ['--chat-fs' as string]: chatScale,
    } as CSSProperties}>
      {/* On touch the panel is a full-screen overlay whose own collapse
          control (RightPanel's header, 48px) sits directly above this one,
          and `togglePanel` routes here to the SAME action — two stacked,
          identically-behaved buttons costing 44px of a 393px-tall landscape
          phone, where only ~186px was left for messages. Pointer keeps it. */}
      {!onCollapsePanel && (<>
      {/* ================================================================
          Toggle button — horizontal row in the sidebar
          ================================================================ */}
      <button
        onClick={togglePanel}
        aria-label={`${isOpen ? 'Close' : 'Open'} ${hideChat ? 'log' : 'chat'} panel`}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: isOpen ? 'rgba(var(--gf-accent-rgb), 0.08)' : 'transparent',
          border: 'none',
          borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.2)',
          color: 'var(--gf-text-bright)',
          cursor: 'pointer',
          fontSize: 'calc(11px * var(--chat-fs, 1))',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        {/* Chat bubble icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {/* Solo hides the chat tabs, so the header names what is left. */}
        {hideChat ? 'Log' : 'Chat'}
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} unread messages`}
            style={{
              background: 'var(--gf-accent)',
              color: '#0a0805',
              borderRadius: '50%',
              fontSize: 'calc(9px * var(--chat-fs, 1))',
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              marginLeft: 'auto',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        {/* Chevron indicator */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            marginLeft: unreadCount > 0 ? 0 : 'auto',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      </>)}

      {/* ================================================================
          Panel content — conditionally rendered when open
          ================================================================ */}
      {isOpen && (
        <div
          role="complementary"
          aria-label="Chat and game log panel"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'rgba(10, 8, 5, 0.97)',
            // Anchors the jump-to-latest pill below.
            position: 'relative',
          }}
        >
          {/* Shown only when the reader has scrolled away from the bottom, so
              new activity is announced instead of stealing their place. */}
          {showJumpToLatest && activeTab !== 'spectators' && (
            <button
              onClick={() => scrollListToBottom(true)}
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: activeTab === 'log' ? 12 : 64,
                zIndex: 2,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid rgba(var(--gf-accent-rgb), 0.55)',
                background: 'rgba(28, 20, 12, 0.96)',
                color: 'var(--gf-text-bright)',
                fontFamily: 'inherit',
                fontSize: 'calc(11px * var(--chat-fs, 1))',
                letterSpacing: '0.04em',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                whiteSpace: 'nowrap',
              }}
            >
              ↓ New activity
            </button>
          )}
          {/* ---- Header with tabs ---- */}
          {/* Flex, not `1fr auto 1fr` grid: the intrinsic tab row (330px once
              the touch rule inflates the buttons) maximized the middle track,
              collapsed the 1fr sides, and pushed the search button past the
              panel's right edge — at 1024px it sat fully off-viewport. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 8px',
              borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.3)',
              flexShrink: 0,
            }}
          >
            {/* Tabs — scroll within the panel instead of overflowing it */}
            <div style={{ display: 'flex', gap: 4, flex: '1 1 0', minWidth: 0, overflowX: 'auto' }}>
              {((showSpectatorsTab
                ? (['all', 'chat', 'log', 'spectators'] as const)
                : (['all', 'chat', 'log'] as const)) as readonly TabKey[])
                .filter((tab) => !hideChat || (tab !== 'chat' && tab !== 'all'))
                .map((tab) => {
                const isActive = activeTab === tab;
                const label =
                  tab === 'chat' ? 'Chat'
                  : tab === 'log' ? 'Log'
                  : tab === 'spectators' ? 'Spectators'
                  : 'All';
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '3px 10px',
                      background: isActive ? 'rgba(var(--gf-accent-rgb), 0.12)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(var(--gf-accent-rgb), 0.45)' : 'transparent'}`,
                      borderRadius: 20,
                      cursor: 'pointer',
                      fontSize: 'calc(10px * var(--chat-fs, 1))',
                      letterSpacing: '0.07em',
                      textTransform: 'uppercase',
                      color: isActive ? 'var(--gf-text-bright)' : 'rgba(232, 213, 163, 0.4)',
                      fontFamily: 'inherit',
                      transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                    }}
                  >
                    {tab === 'chat' ? (
                      <span style={{ position: 'relative' }}>
                        Chat
                        {unreadCount > 0 && activeTab !== 'chat' && activeTab !== 'all' && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -1,
                              right: -7,
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--gf-accent)',
                              boxShadow: '0 0 4px rgba(var(--gf-accent-rgb), 0.6)',
                            }}
                          />
                        )}
                      </span>
                    ) : label}
                  </button>
                );
              })}
            </div>
            {/* Search toggle (fixed at the row's right edge) */}
            <div style={{ flexShrink: 0, marginLeft: 'auto' }}>
              <button
                onClick={() => {
                  setSearchOpen((prev) => {
                    const next = !prev;
                    if (!next) setSearchQuery('');
                    return next;
                  });
                }}
                aria-label={searchOpen ? 'Close search' : 'Search messages and log'}
                aria-pressed={searchOpen}
                title={searchOpen ? 'Close search' : 'Search'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: searchOpen ? 'rgba(var(--gf-accent-rgb), 0.18)' : 'transparent',
                  border: `1px solid ${searchOpen ? 'rgba(var(--gf-accent-rgb), 0.45)' : 'transparent'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: searchOpen ? 'var(--gf-text-bright)' : 'rgba(232, 213, 163, 0.55)',
                  transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </div>
          </div>

          {/* ---- Search bar (collapsible) ---- */}
          {searchOpen && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.3)',
                background: 'rgba(var(--gf-accent-rgb), 0.04)',
                flexShrink: 0,
              }}
            >
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSearchQuery('');
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search messages, actions, cards..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(var(--gf-border-rgb), 0.35)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: 'var(--gf-text-bright)',
                  fontSize: 'calc(11px * var(--chat-fs, 1))',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
                aria-label="Search messages and log"
              />
              <span
                style={{
                  fontSize: 'calc(10px * var(--chat-fs, 1))',
                  color: 'rgba(232, 213, 163, 0.45)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                  minWidth: 56,
                  textAlign: 'right',
                }}
              >
                {isSearching ? `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}` : 'Esc to close'}
              </span>
            </div>
          )}

          {/* ---- Tab: Chat ---- */}
          {activeTab === 'chat' && (
            <>
              {/* Message list */}
              <div
                ref={listRef}
                onScroll={handleListScroll}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  padding: '8px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {userChat.length === 0 && (
                  <p
                    style={{
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontSize: 'calc(11px * var(--chat-fs, 1))',
                      textAlign: 'center',
                      marginTop: 16,
                      fontStyle: 'italic',
                    }}
                  >
                    {isSearching ? 'No matches.' : 'No messages yet.'}
                  </p>
                )}
                {userChat.map((msg) => {
                  if (msg.senderId === 0n) {
                    return (
                      <div
                        key={msg.id.toString()}
                        style={{
                          textAlign: 'center',
                          fontStyle: 'italic',
                          opacity: 0.6,
                          fontSize: 11,
                          margin: '4px 0',
                          padding: '0 8px',
                        }}
                      >
                        {msg.text}
                      </div>
                    );
                  }
                  const isMe = msg.senderId === myPlayerId;
                  const senderName =
                    playerNames[msg.senderId.toString()] ??
                    (isMe ? 'You' : `Player ${msg.senderId}`);
                  const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);

                  return (
                    <div
                      key={msg.id.toString()}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMe ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {/* Sender + time */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'baseline',
                          marginBottom: 2,
                          flexDirection: isMe ? 'row-reverse' : 'row',
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 'calc(10px * var(--chat-fs, 1))',
                            color: isMe ? 'var(--gf-accent)' : '#4a7ab5',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {senderName}
                        </span>
                        <span
                          style={{
                            fontSize: 'calc(9px * var(--chat-fs, 1))',
                            color: 'rgba(232, 213, 163, 0.3)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {time}
                        </span>
                      </div>

                      {/* Bubble */}
                      <div
                        style={{
                          maxWidth: '90%',
                          padding: '4px 8px',
                          borderRadius: isMe ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
                          background: isMe
                            ? 'rgba(var(--gf-accent-rgb), 0.14)'
                            : 'rgba(255, 255, 255, 0.06)',
                          border: isMe
                            ? '1px solid rgba(var(--gf-accent-rgb), 0.3)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          fontSize: 'calc(12px * var(--chat-fs, 1))',
                          color: 'var(--gf-text-bright)',
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input row */}
              <div
                style={{
                  padding: '6px 8px',
                  borderTop: '1px solid rgba(var(--gf-border-rgb), 0.3)',
                  display: 'flex',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={chatDisabled ? "Spectators can't chat" : "Message..."}
                  enterKeyHint="send"
                  maxLength={500}
                  disabled={chatDisabled}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(var(--gf-border-rgb), 0.35)',
                    borderRadius: 4,
                    padding: '5px 8px',
                    color: 'var(--gf-text-bright)',
                    fontSize: 'calc(12px * var(--chat-fs, 1))',
                    fontFamily: 'inherit',
                    outline: 'none',
                    opacity: chatDisabled ? 0.5 : 1,
                    cursor: chatDisabled ? 'not-allowed' : 'text',
                  }}
                  aria-label="Chat message"
                />
                <button
                  onClick={handleSend}
                  disabled={chatDisabled || !inputText.trim()}
                  aria-label="Send message"
                  style={{
                    padding: '5px 8px',
                    background:
                      inputText.trim()
                        ? 'rgba(var(--gf-accent-rgb), 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${inputText.trim() ? 'rgba(var(--gf-accent-rgb), 0.5)' : 'rgba(var(--gf-border-rgb), 0.2)'}`,
                    borderRadius: 4,
                    color: inputText.trim() ? 'var(--gf-text-bright)' : 'rgba(232, 213, 163, 0.3)',
                    cursor: inputText.trim() ? 'pointer' : 'default',
                    fontSize: 'calc(10px * var(--chat-fs, 1))',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {/* ---- Tab: Game Log ---- */}
          {activeTab === 'log' && (
            <div
              ref={listRef}
              onScroll={handleListScroll}
              style={{
                flex: 1,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                padding: '8px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {filteredActions.length === 0 && systemChat.length === 0 && (
                <p
                  style={{
                    color: 'rgba(232, 213, 163, 0.3)',
                    fontSize: 'calc(11px * var(--chat-fs, 1))',
                    textAlign: 'center',
                    marginTop: 16,
                    fontStyle: 'italic',
                  }}
                >
                  {isSearching ? 'No matches.' : 'No activity yet.'}
                </p>
              )}
              {(() => {
                // Interleave system messages (spectator events, private
                // toggle, etc.) with game actions, chronologically.
                const timeline: TimelineEntry[] = [];
                for (const msg of systemChat) {
                  timeline.push({ kind: 'chat', msg, micros: msg.sentAt.microsSinceUnixEpoch });
                }
                for (const action of displayActions) {
                  timeline.push({ kind: 'action', action, micros: action.timestamp.microsSinceUnixEpoch });
                }
                timeline.sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0));

                return timeline.map((entry) => {
                  if (entry.kind === 'chat') {
                    const msg = entry.msg;
                    return (
                      <div
                        key={`sys-${msg.id.toString()}`}
                        style={{
                          textAlign: 'center',
                          fontStyle: 'italic',
                          opacity: 0.6,
                          fontSize: 'calc(11px * var(--chat-fs, 1))',
                          color: 'var(--gf-text-bright)',
                          margin: '4px 0',
                          padding: '0 8px',
                        }}
                      >
                        {msg.text}
                      </div>
                    );
                  }
                  const action = entry.action;
                  const playerName =
                    playerNames[action.playerId.toString()] ??
                    `Player ${action.playerId}`;
                  const verb = formatActionType(action.actionType, action.payload, playerNames, action.playerId.toString(), myPlayerId.toString());
                  const time = formatTimestamp(action.timestamp.microsSinceUnixEpoch);
                  const turn = Number(action.turnNumber);
                  return (
                    <div
                      key={action.id.toString()}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        padding: '4px 6px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 4,
                        borderLeft: '2px solid rgba(var(--gf-border-rgb), 0.3)',
                      }}
                    >
                      <span style={{ fontSize: 'calc(11px * var(--chat-fs, 1))', color: '#c8b882', lineHeight: 1.35 }}>
                        <strong style={{ color: 'var(--gf-text-bright)' }}>{playerName}</strong>{' '}
                        {verb}
                      </span>
                      <span
                        style={{
                          fontSize: 'calc(9px * var(--chat-fs, 1))',
                          color: 'rgba(232, 213, 163, 0.3)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        T{turn} · {action.phase} · {time}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* ---- Tab: All (Combined) ---- */}
          {activeTab === 'all' && (
            <>
              {/* Combined timeline */}
              <div
                ref={listRef}
                onScroll={handleListScroll}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  padding: '8px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {filteredChat.length === 0 && filteredActions.length === 0 && (
                  <p
                    style={{
                      color: 'rgba(232, 213, 163, 0.3)',
                      fontSize: 'calc(11px * var(--chat-fs, 1))',
                      textAlign: 'center',
                      marginTop: 16,
                      fontStyle: 'italic',
                    }}
                  >
                    {isSearching ? 'No matches.' : 'No activity yet.'}
                  </p>
                )}
                {(() => {
                  // Build a merged timeline sorted chronologically
                  const timeline: TimelineEntry[] = [];
                  for (const msg of filteredChat) {
                    timeline.push({ kind: 'chat', msg, micros: msg.sentAt.microsSinceUnixEpoch });
                  }
                  for (const action of displayActions) {
                    timeline.push({ kind: 'action', action, micros: action.timestamp.microsSinceUnixEpoch });
                  }
                  timeline.sort((a, b) => (a.micros < b.micros ? -1 : a.micros > b.micros ? 1 : 0));

                  return timeline.map((entry) => {
                    if (entry.kind === 'chat') {
                      const msg = entry.msg;
                      if (msg.senderId === 0n) {
                        return (
                          <div
                            key={`chat-${msg.id.toString()}`}
                            style={{
                              textAlign: 'center',
                              fontStyle: 'italic',
                              opacity: 0.6,
                              fontSize: 11,
                              margin: '4px 0',
                              padding: '0 8px',
                            }}
                          >
                            {msg.text}
                          </div>
                        );
                      }
                      const isMe = msg.senderId === myPlayerId;
                      const senderName =
                        playerNames[msg.senderId.toString()] ??
                        (isMe ? 'You' : `Player ${msg.senderId}`);
                      const time = formatTimestamp(msg.sentAt.microsSinceUnixEpoch);

                      return (
                        <div
                          key={`chat-${msg.id.toString()}`}
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'flex-start',
                          }}
                        >
                          {/* Chat icon */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={isMe ? 'var(--gf-accent)' : '#4a7ab5'}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            style={{ flexShrink: 0, marginTop: 2 }}
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
                              <span
                                style={{
                                  fontWeight: 700,
                                  fontSize: 'calc(10px * var(--chat-fs, 1))',
                                  color: isMe ? 'var(--gf-accent)' : '#4a7ab5',
                                  letterSpacing: '0.02em',
                                }}
                              >
                                {senderName}
                              </span>
                              <span
                                style={{
                                  fontSize: 'calc(9px * var(--chat-fs, 1))',
                                  color: 'rgba(232, 213, 163, 0.3)',
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {time}
                              </span>
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                padding: '3px 7px',
                                borderRadius: '8px 8px 8px 3px',
                                background: isMe
                                  ? 'rgba(var(--gf-accent-rgb), 0.10)'
                                  : 'rgba(255, 255, 255, 0.05)',
                                border: isMe
                                  ? '1px solid rgba(var(--gf-accent-rgb), 0.22)'
                                  : '1px solid rgba(255, 255, 255, 0.07)',
                                fontSize: 'calc(12px * var(--chat-fs, 1))',
                                color: 'var(--gf-text-bright)',
                                lineHeight: 1.4,
                                wordBreak: 'break-word',
                                maxWidth: '95%',
                              }}
                            >
                              {msg.text}
                            </div>
                          </div>
                        </div>
                      );
                    } else {
                      const action = entry.action;
                      const playerName =
                        playerNames[action.playerId.toString()] ??
                        `Player ${action.playerId}`;
                      const verb = formatActionType(action.actionType, action.payload, playerNames, action.playerId.toString(), myPlayerId.toString());
                      const time = formatTimestamp(action.timestamp.microsSinceUnixEpoch);
                      const turn = Number(action.turnNumber);

                      return (
                        <div
                          key={`action-${action.id.toString()}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            padding: '3px 6px',
                            borderLeft: '2px solid rgba(var(--gf-border-rgb), 0.25)',
                            opacity: 0.8,
                          }}
                        >
                          <span style={{ fontSize: 'calc(10px * var(--chat-fs, 1))', color: '#c8b882', lineHeight: 1.35 }}>
                            <strong style={{ color: 'var(--gf-text-bright)' }}>{playerName}</strong>{' '}
                            {verb}
                          </span>
                          <span
                            style={{
                              fontSize: 'calc(9px * var(--chat-fs, 1))',
                              color: 'rgba(232, 213, 163, 0.25)',
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            T{turn} · {action.phase} · {time}
                          </span>
                        </div>
                      );
                    }
                  });
                })()}
              </div>

              {/* Input row (same as chat tab) */}
              <div
                style={{
                  padding: '6px 8px',
                  borderTop: '1px solid rgba(var(--gf-border-rgb), 0.3)',
                  display: 'flex',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={chatDisabled ? "Spectators can't chat" : "Message..."}
                  enterKeyHint="send"
                  maxLength={500}
                  disabled={chatDisabled}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(var(--gf-border-rgb), 0.35)',
                    borderRadius: 4,
                    padding: '5px 8px',
                    color: 'var(--gf-text-bright)',
                    fontSize: 'calc(12px * var(--chat-fs, 1))',
                    fontFamily: 'inherit',
                    outline: 'none',
                    opacity: chatDisabled ? 0.5 : 1,
                    cursor: chatDisabled ? 'not-allowed' : 'text',
                  }}
                  aria-label="Chat message"
                />
                <button
                  onClick={handleSend}
                  disabled={chatDisabled || !inputText.trim()}
                  aria-label="Send message"
                  style={{
                    padding: '5px 8px',
                    background:
                      inputText.trim()
                        ? 'rgba(var(--gf-accent-rgb), 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${inputText.trim() ? 'rgba(var(--gf-accent-rgb), 0.5)' : 'rgba(var(--gf-border-rgb), 0.2)'}`,
                    borderRadius: 4,
                    color: inputText.trim() ? 'var(--gf-text-bright)' : 'rgba(232, 213, 163, 0.3)',
                    cursor: inputText.trim() ? 'pointer' : 'default',
                    fontSize: 'calc(10px * var(--chat-fs, 1))',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    flexShrink: 0,
                  }}
                >
                  Send
                </button>
              </div>
            </>
          )}

          {/* ---- Tab: Spectators ---- */}
          {activeTab === 'spectators' && showSpectatorsTab && (() => {
            const sectionLabelStyle: CSSProperties = {
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 'calc(10px * var(--chat-fs, 1))',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(232, 213, 163, 0.55)',
              marginBottom: 8,
            };
            const checkboxRowStyle: CSSProperties = {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 4,
              border: '1px solid rgba(var(--gf-border-rgb), 0.3)',
              background: 'rgba(var(--gf-accent-rgb), 0.04)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 'calc(11px * var(--chat-fs, 1))',
              letterSpacing: '0.04em',
              color: 'var(--gf-text-bright)',
              transition: 'background 0.15s, border-color 0.15s',
            };
            const checkboxStyle: CSSProperties = {
              accentColor: 'var(--gf-accent)',
              width: 14,
              height: 14,
              cursor: 'pointer',
              flexShrink: 0,
            };
            const dividerStyle: CSSProperties = {
              height: 1,
              background: 'rgba(var(--gf-border-rgb), 0.3)',
              margin: '4px 0',
            };
            const watchersList = spectators!.filter(
              s => s.identity.toHexString() !== myIdentityHex,
            );
            return (
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '14px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                <div>
                  <div style={sectionLabelStyle}>Sharing</div>
                  <label style={checkboxRowStyle}>
                    <input
                      type="checkbox"
                      checked={!!shareHandWithSpectators}
                      onChange={(e) => onSetShareHand?.(e.target.checked)}
                      style={checkboxStyle}
                    />
                    <span>Share my hand with spectators</span>
                  </label>
                </div>

                <div style={dividerStyle} />

                <div>
                  <div style={sectionLabelStyle}>Access</div>
                  <label style={checkboxRowStyle}>
                    <input
                      type="checkbox"
                      checked={isGamePublic === false}
                      onChange={(e) => onSetGamePrivate?.(!e.target.checked)}
                      style={checkboxStyle}
                    />
                    <span>Private game (no new spectators)</span>
                  </label>
                </div>

                <div style={dividerStyle} />

                <div>
                  <div style={sectionLabelStyle}>
                    Watching ({watchersList.length})
                  </div>
                  {watchersList.length === 0 ? (
                    <p
                      style={{
                        fontFamily: 'var(--font-cinzel), Georgia, serif',
                        fontSize: 'calc(11px * var(--chat-fs, 1))',
                        color: 'rgba(232, 213, 163, 0.3)',
                        fontStyle: 'italic',
                        margin: 0,
                        textAlign: 'center',
                        padding: '12px 0',
                      }}
                    >
                      No spectators yet
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {watchersList.map(s => (
                        <div
                          key={s.id.toString()}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '6px 8px',
                            borderRadius: 4,
                            border: '1px solid rgba(var(--gf-border-rgb), 0.3)',
                            background: 'rgba(var(--gf-accent-rgb), 0.04)',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-cinzel), Georgia, serif',
                              fontSize: 'calc(11px * var(--chat-fs, 1))',
                              letterSpacing: '0.03em',
                              color: 'var(--gf-text-bright)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                              flex: 1,
                              marginRight: 8,
                            }}
                          >
                            {s.displayName}
                          </span>
                          <button
                            onClick={() => onKickSpectator?.(s.id)}
                            style={{
                              background: 'transparent',
                              color: 'rgba(220, 120, 120, 0.75)',
                              border: '1px solid rgba(180, 60, 60, 0.5)',
                              borderRadius: 4,
                              padding: '3px 10px',
                              cursor: 'pointer',
                              fontFamily: 'var(--font-cinzel), Georgia, serif',
                              fontSize: 'calc(10px * var(--chat-fs, 1))',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              flexShrink: 0,
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
                            Kick
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
    </LogCardTapContext.Provider>
  );
}
