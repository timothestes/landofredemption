'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeConnectionResetWrapper } from '@/app/play/components/SpacetimeConnectionResetWrapper';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { shouldGateForPortrait, isCompactTouchViewport } from '@/app/play/lib/orientationGate';
import { RotateDevicePrompt } from '@/app/play/components/RotateDevicePrompt';
import ReconnectOnResume from '@/app/play/components/ReconnectOnResume';
import { useGameState } from '@/app/play/hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';
import GameOverOverlay, { deriveEndReason } from '@/app/play/components/GameOverOverlay';
import TurnIndicator from '@/app/play/components/TurnIndicator';
import PauseConsentToast from '@/app/play/components/PauseConsentToast';
import SpectatorHandRequestBanner from '@/app/play/components/SpectatorHandRequestBanner';
import RightPanel from '@/app/play/components/RightPanel';
import { CardPreviewProvider, useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import TopNav from '@/components/top-nav';
import { GameToolbar } from '@/app/shared/components/GameToolbar';
import { EmoteOverlay } from '@/app/shared/components/EmoteOverlay';
import { useGameHotkeys } from '@/app/shared/hooks/useGameHotkeys';
import { GameToastContainer, showGameToast } from '@/app/shared/components/GameToast';
import { CardChoicePromptContainer } from '@/app/shared/components/CardChoicePrompt';
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';
import type { GameActions } from '@/app/shared/types/gameActions';
import WaitingRoomGoldfish from '../components/WaitingRoomGoldfish';
import { SpreadHandProvider, useSpreadHand } from '../contexts/SpreadHandContext';
import { convertToGoldfishDeck, type GameCardData } from '../utils/convertToGoldfishDeck';
import PregameScreen, { PregameCeremonyOverlay, OpponentJoinedToast } from '../components/PregameScreen';
import { ImageLoadingGate } from '../components/ImageLoadingGate';
import { DebugOverlay } from '../components/DebugOverlay';
import { useMultiplayerImagePreloader } from '@/app/play/hooks/useMultiplayerImagePreloader';
import { buildPrioritizedImageUrls, buildCriticalImageUrls } from '@/app/play/lib/multiplayerImageUrls';
import { DeckPickerModal } from '../components/DeckPickerModal';
import { ForgeDeckPickerModal } from '@/app/forge/play/games/ForgeDeckPicker';
import { getRandomLoadingMessage } from '@/app/shared/constants/loadingMessages';
import { ArrowLeft } from 'lucide-react';
import { loadDeckForGame } from '../actions';
import { useUndoStack } from '../hooks/useUndoStack';
import { shouldClearUndoStack } from '../hooks/undoStackCore';
import { useGameTimer } from '../hooks/useGameTimer';
import { useChatScale } from '@/app/shared/hooks/useChatScale';
import { normalizeDeckFormat } from '@/lib/deck-format';
import { finishedGameToReuseOnCreate } from '@/app/play/lib/gameEntryDecision';
import { loadForgeDeckForGame, getForgePlayResolver, authorizeForgeSeat } from '@/app/forge/lib/playDecks';
import { mergeForgeDeckData, resolveCardImageUrl, forgeRenderWarmUrls, type ForgeResolverMap } from '@/app/play/utils/forgeResolver';
import { warmForgeRenders } from '@/app/play/utils/warmForgeRenders';

// Konva requires browser APIs — lazy-load to avoid SSR issues
const MultiplayerCanvas = dynamic(
  () => import('@/app/play/components/MultiplayerCanvas'),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Session storage key for lobby-provided game params
// ---------------------------------------------------------------------------
const SESSION_KEY_PREFIX = 'stdb_game_params_';

interface GameParams {
  role: 'create' | 'join';
  deckId: string;
  displayName: string;
  supabaseUserId: string;
  format?: string;
  deckName?: string;
  paragon?: string | null;
  isPublic?: boolean;
  lobbyMessage?: string;
  isForge?: boolean;
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------
interface GameClientProps {
  code: string;
}

// ---------------------------------------------------------------------------
// ForgeSwapErrorDialog — shown when a forge switch-deck load fails (deck no
// longer shared, network). Styled to match the amber confirm dialogs below.
// ---------------------------------------------------------------------------
function ForgeSwapErrorDialog({ error, onClose }: { error: string | null; onClose: () => void }) {
  if (!error) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: 'rgba(14, 10, 6, 0.97)',
        border: '1px solid rgba(107, 78, 39, 0.3)',
        borderRadius: 8,
        padding: '20px 28px',
        maxWidth: 340,
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
      }}>
        <p style={{
          fontFamily: 'Georgia, serif',
          color: '#e8d5a3',
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          {error}
        </p>
        <button
          onClick={onClose}
          style={{
            marginTop: 18,
            padding: '7px 18px',
            background: 'rgba(196, 149, 90, 0.15)',
            border: '1px solid rgba(196, 149, 90, 0.45)',
            borderRadius: 4,
            color: '#e8d5a3',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'Georgia, serif',
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer component — owns the connection builder and wraps the provider
// ---------------------------------------------------------------------------
export function GameClient({ code }: GameClientProps) {
  const { createBuilder, isConnected } = useSpacetimeConnection();

  return (
    <SpacetimeConnectionResetWrapper createBuilder={createBuilder}>
      <ReconnectOnResume />
      <CardPreviewProvider storageKey="multiplayer-loupe-visible" defaultVisible>
        <SpreadHandProvider>
          <GameInner code={code} isConnected={isConnected} />
        </SpreadHandProvider>
      </CardPreviewProvider>
    </SpacetimeConnectionResetWrapper>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'creating' | 'joining' | 'waiting' | 'pregame' | 'playing' | 'finished' | 'error';

// WaitingScreen and CopyButton removed — now handled by unified PregameScreen

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------

interface GameInnerProps {
  code: string;
  isConnected: boolean;
}

function GameInner({ code, isConnected }: GameInnerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const isActive = spacetimeCtx?.isActive ?? false;
  const router = useRouter();

  const [lifecycle, setLifecycle] = useState<LifecycleState>('creating');
  const [loadingMessage, setLoadingMessage] = useState('Loading...');

  useEffect(() => {
    const stored = sessionStorage.getItem('stdb_loading_message');
    if (stored) {
      sessionStorage.removeItem('stdb_loading_message');
      setLoadingMessage(stored);
    } else {
      setLoadingMessage(getRandomLoadingMessage());
    }
  }, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorFromPregame, setErrorFromPregame] = useState(false);
  const [formatMismatch, setFormatMismatch] = useState<{ host: string; joiner: string } | null>(null);
  const [isSelfJoin, setIsSelfJoin] = useState(false);
  const [isPracticing, setIsPracticing] = useState(false);
  // WS-3 §3: transient "{name} joined" toast for the host when the opponent's
  // join yanks them out of the waiting room (or practice) into the ceremony.
  const JOINED_TOAST_MS = 2500;
  const [justJoinedToast, setJustJoinedToast] = useState<string | null>(null);
  // Guards against a visual flash: once the user chooses to leave, we freeze the
  // render on a transition overlay so that subsequent SpacetimeDB state updates
  // (which re-derive `lifecycle` and can fall through to the game canvas) can't
  // briefly reveal the territory zones before router.push unmounts us.
  const [isLeaving, setIsLeaving] = useState(false);
  const [playAgainTriggered, setPlayAgainTriggered] = useState(false);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const didCallReducer = useRef(false);
  const didSubscribe = useRef(false);

  // Deck reload state
  const [showReloadDeckPicker, setShowReloadDeckPicker] = useState(false);
  const [reloadDeckConfirm, setReloadDeckConfirm] = useState<{ deckId: string; deckName: string; deckData: string; paragon: string } | null>(null);

  // End Turn guard (spec §8) — state only here; the wrapped handler is
  // defined below once `gameState` exists (see requestEndTurn).
  const [showBattleEndTurnConfirm, setShowBattleEndTurnConfirm] = useState(false);

  // Practice-mode deck swap state — separate from in-game reload because the
  // pregame swap calls a different reducer (pregame_change_deck) that updates
  // pendingDeckData rather than dealing a fresh hand.
  const [showPracticeDeckPicker, setShowPracticeDeckPicker] = useState(false);
  const [practiceDeckConfirm, setPracticeDeckConfirm] = useState<{ deckId: string; deckName: string; deckData: string; paragon: string; format: string } | null>(null);

  // Forge switch-deck failure (deck no longer shared, network) — the picker has
  // already closed by the time the server action resolves, so surface it in a
  // dedicated dialog rather than failing silently.
  const [forgeSwapError, setForgeSwapError] = useState<string | null>(null);

  // Image preload gate — keeps the board obscured until the tier-1 (visible)
  // card images have loaded, so slow-wifi users aren't dropped into a board
  // full of generic card backs. Capped at IMAGE_GATE_TIMEOUT_MS so a truly
  // offline user is never held hostage.
  //
  // The preloader is deliberately hoisted to this component (rather than
  // MultiplayerCanvas) because MultiplayerCanvas is remounted across
  // lifecycle transitions (ceremony → awaiting-start → playing). Hoisting
  // keeps the image cache alive across those transitions — otherwise each
  // remount fires duplicate requests and the browser aborts the originals.
  const IMAGE_GATE_TIMEOUT_MS = 8_000;
  const [imagesGateOpen, setImagesGateOpen] = useState(false);
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Card preview hook — must be called before any early returns (Rules of Hooks)
  const { isLoupeVisible, toggleLoupe, previewCard, isPreviewFlipped } = useCardPreview();
  const { isSpreadHand, toggleSpreadHand } = useSpreadHand();

  // Client-side undo stack for multiplayer reverse actions
  const undoStack = useUndoStack();

  // Chat/log font scale — shared between ChatPanel and the gear-menu slider
  const {
    chatScale,
    setChatScale,
    resetChatScale,
    MIN_SCALE: CHAT_MIN_SCALE,
    MAX_SCALE: CHAT_MAX_SCALE,
    STEP: CHAT_STEP,
  } = useChatScale();

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  // Phase 1: Subscribe to game table filtered by code so we can discover the
  // numeric gameId. This avoids sequential scans on unfiltered SELECT * queries.
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        `SELECT * FROM game WHERE code = '${code}'`,
      ]);
    } catch (e) {
      console.error('Failed to subscribe (phase 1):', e);
    }
  }, [isConnected, isActive, conn, code]);

  // Phase 2 subscription block was removed: each `useTable(...)` call in
  // `useGameState` now scopes its own server subscription via the typed query
  // builder (`tables.X.where(r => r.gameId.eq(gameId))`), which both pushes
  // the WHERE clause to the server AND filters callbacks at the React layer.
  // The phase-2 raw-SQL subscriptions had become strict duplicates.

  // Presence heartbeat — reassert isConnected and cancel any pending
  // DisconnectTimeout whenever the WebSocket is live on this page. The server
  // no longer blanket-revives on clientConnected, so orphan lobbies die 30s
  // after the creator navigates away.
  useEffect(() => {
    if (!conn || gameId === null || !isConnected) return;
    try {
      conn.reducers.registerPresence({ gameId });
    } catch (e) {
      console.error('Failed to register presence:', e);
    }
  }, [conn, gameId, isConnected]);

  // Read session storage params set by the lobby page. Made mutable so a
  // practice-mode deck swap can update gameParams.deckId/deckName/paragon
  // without losing the rest of the session context.
  const [gameParams, setGameParams] = useState<GameParams | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${code}`);
      return raw ? (JSON.parse(raw) as GameParams) : null;
    } catch {
      return null;
    }
  });

  // Deck data is loaded here (post-navigation) so the cave loading screen
  // appears immediately on click. Serialized once and reused for the reducer
  // call + goldfish practice-while-waiting.
  const [deckData, setDeckData] = useState<string | null>(null);
  const [deckLoadError, setDeckLoadError] = useState<string | null>(null);

  // Forge state — declared before `gameState`/`isForge` so the deck-load
  // effect below (which branches on gameParams.isForge) and useGameState
  // (which accepts the resolver) both have it available.
  const [forgeResolver, setForgeResolver] = useState<ForgeResolverMap | null>(null);
  const [forgeDeckMeta, setForgeDeckMeta] = useState<{ paragon: string; format: string } | null>(null);

  useEffect(() => {
    if (!gameParams || deckData !== null) return;
    let cancelled = false;
    if (gameParams.isForge) {
      loadForgeDeckForGame(gameParams.deckId)
        .then((r) => {
          if (cancelled) return;
          if (r.ok === false) { setDeckLoadError(r.error); return; }
          // The sanitized paragon/format from the server action are authoritative
          // for the reducer args (never gameParams.paragon on the forge path).
          setForgeDeckMeta({ paragon: r.deck.paragon, format: r.deck.format || 'Type 1' });
          setDeckData(JSON.stringify(r.deckData));
        })
        .catch((err) => {
          if (cancelled) return;
          setDeckLoadError(err instanceof Error ? err.message : 'Failed to load deck.');
        });
    } else {
      loadDeckForGame(gameParams.deckId)
        .then((result) => {
          if (cancelled) return;
          setDeckData(JSON.stringify(result.deckData));
        })
        .catch((err) => {
          if (cancelled) return;
          setDeckLoadError(err instanceof Error ? err.message : 'Failed to load deck.');
        });
    }
    return () => { cancelled = true; };
  }, [gameParams, deckData]);

  useEffect(() => {
    if (!deckLoadError) return;
    setErrorMessage(deckLoadError);
    setLifecycle('error');
  }, [deckLoadError]);

  // Must be declared before the reducer effect so isGamesReady is available
  // in the dependency array (which is evaluated during render).
  const gameState = useGameState(gameId ?? BigInt(0), forgeResolver);

  // End Turn guard (spec §8): TurnIndicator's onEndTurn, GameToolbar's
  // onEndTurn, and the Enter-key hotkey (onAdvancePhase below) all dispatch
  // gameState.endTurn from here, so the confirm lives at this shared level
  // rather than inside any one caller — neither TurnIndicator nor
  // GameToolbar has its own End Turn confirm idiom (TurnIndicator's
  // showConcedeConfirm is local to Concede only). Reuses the
  // reloadDeckConfirm modal's visual idiom, rendered near it below.
  const requestEndTurn = useCallback(() => {
    if (gameState.game?.battleState === 'awaiting-soul') {
      setShowBattleEndTurnConfirm(true);
    } else {
      gameState.endTurn();
    }
  }, [gameState.game?.battleState, gameState.endTurn]);

  const isForge = gameParams?.isForge === true || gameState.isForgeGame;

  // Board backdrop — Forge playtest games get a distinct background.
  const gameBackground = `url(/gameplay/${isForge ? 'forge_background' : 'cave_background'}.png)`;

  // ---- Touch shell ----
  const shellInputMode = useInputMode();
  const [shellViewport, setShellViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => setShellViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
  // Remembered per game, per tab: a phone that reloads mid-match (backgrounded
  // tab discarded, accidental pull-to-refresh, a genuine drop) re-mounted this
  // component and re-armed the gate, so a player who had already chosen to play
  // in portrait got the rotate wall again — while the opponent's clock kept
  // running behind it. The choice belongs to the game, not the mount.
  const portraitGateKey = `portrait_gate_ok_${code}`;
  const [portraitGateDismissed, setPortraitGateDismissed] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(portraitGateKey) === '1') setPortraitGateDismissed(true);
    } catch {
      // Storage unavailable — the gate simply behaves as before.
    }
  }, [portraitGateKey]);
  const dismissPortraitGate = useCallback(() => {
    setPortraitGateDismissed(true);
    try {
      sessionStorage.setItem(portraitGateKey, '1');
    } catch {
      // Non-fatal: the dismissal still holds for this mount.
    }
  }, [portraitGateKey]);
  const gateForPortrait =
    !portraitGateDismissed &&
    shouldGateForPortrait(shellViewport.w, shellViewport.h, shellInputMode);
  // Compact touch shell = short landscape phones AND phone portrait behind
  // "Continue anyway". Drives both the overlaid turn bar and (via the
  // compactLayout prop) the canvas's TOUCH_PROFILE, from the SAME viewport
  // measurement — the canvas previously re-derived it from containerHeight,
  // leaving a 500-548px drift band, and portrait fell through to the desktop
  // profile entirely. iPad keeps the standard profile and its own bar row.
  const compactTouchShell = isCompactTouchViewport(shellViewport.w, shellViewport.h, shellInputMode);
  // The bar overlays the canvas only where the compact layout profile's top
  // gutter pushes the board content clear of it (in portrait the camera's
  // insetTop does the same job). On taller touch viewports (iPad) there is no
  // gutter, so an overlaid bar sat on the opponent's hand and LoB — give the
  // bar its own row there like desktop; those viewports have height to spare.
  const overlayTurnBar = compactTouchShell;

  // Where "Back to lobby" / exit / stale-game redirects land. Forge games
  // return to the Forge play lobby; everyone else to the public play lobby.
  const lobbyPath = isForge ? '/forge/play' : '/play';

  // Forge resolver fetch — loads the viewer's RLS-granted card text/art map
  // once we know this is a forge game. Fetched once and cached in state.
  useEffect(() => {
    if (!isForge || forgeResolver !== null) return;
    let cancelled = false;
    getForgePlayResolver()
      .then((entries) => {
        if (cancelled) return;
        setForgeResolver(new Map(entries.map((e) => [e.cardId, e])));
      })
      .catch(() => { if (!cancelled) setForgeResolver(new Map()); });
    return () => { cancelled = true; };
  }, [isForge, forgeResolver]);

  // Warm the server's rendered-card cache for this player's own Forge deck once the deck and the
  // resolver are both loaded. The initial load and pregame swaps both land in deckData. The image
  // preloader gives up on a URL after two retries; this way it finds the cards already rendered.
  useEffect(() => {
    if (!isForge || !forgeResolver || !deckData) return;
    try {
      warmForgeRenders(forgeRenderWarmUrls(JSON.parse(deckData), forgeResolver));
    } catch {
      // deckData that does not parse has nothing to warm
    }
  }, [isForge, forgeResolver, deckData]);

  // Forge switch-deck selection handlers. Both go through loadForgeDeckForGame
  // so the deckData that reaches a reducer is always the sanitized server-action
  // output (leak spine) — never client-assembled. The already-fetched
  // forgeResolver covers any deck the viewer can load (it's grant-scoped, not
  // per-deck), so no resolver refresh is needed after a swap.
  const handleForgeReloadSelect = useCallback(async (deckId: string) => {
    setShowReloadDeckPicker(false);
    try {
      const r = await loadForgeDeckForGame(deckId);
      if (r.ok === false) { setForgeSwapError(r.error); return; }
      warmForgeRenders(forgeRenderWarmUrls(r.deckData, forgeResolver));
      setReloadDeckConfirm({ deckId: r.deck.id, deckName: r.deck.name, deckData: JSON.stringify(r.deckData), paragon: r.deck.paragon });
    } catch {
      setForgeSwapError('Failed to load deck.');
    }
  }, [forgeResolver]);

  const handleForgePracticeSelect = useCallback(async (deckId: string) => {
    setShowPracticeDeckPicker(false);
    if (!gameParams || deckId === gameParams.deckId) return;
    try {
      const r = await loadForgeDeckForGame(deckId);
      if (r.ok === false) { setForgeSwapError(r.error); return; }
      warmForgeRenders(forgeRenderWarmUrls(r.deckData, forgeResolver));
      setPracticeDeckConfirm({
        deckId: r.deck.id,
        deckName: r.deck.name,
        deckData: JSON.stringify(r.deckData),
        paragon: r.deck.paragon,
        format: r.deck.format || gameParams.format || 'Type 1',
      });
    } catch {
      setForgeSwapError('Failed to load deck.');
    }
  }, [gameParams, forgeResolver]);

  // ---- Image preload — hoisted from MultiplayerCanvas so the cache survives
  // the canvas remounts that happen at every lifecycle transition.
  //
  // Warm-up URLs come from the host's loaded deckData (available while
  // waiting for an opponent). They're appended as the lowest-priority tier
  // so real visible-card URLs from gameState will load ahead of them once
  // the game starts dealing cards.
  const myDeckImageUrls = useMemo(() => {
    if (!deckData) return [];
    try {
      const cards = JSON.parse(deckData) as GameCardData[];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const card of cards) {
        if (!card.cardImgFile) continue;
        const url = resolveCardImageUrl(card.cardImgFile, forgeResolver);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      }
      return out;
    } catch {
      return [];
    }
  }, [deckData, forgeResolver]);

  const allImageUrls = useMemo(() => {
    const visible = buildPrioritizedImageUrls(gameState.myCards, gameState.opponentCards, gameState.sharedCards, forgeResolver);
    if (myDeckImageUrls.length === 0) return visible;
    // Dedup — visible (higher priority) wins.
    const seen = new Set(visible);
    const out = visible.slice();
    for (const url of myDeckImageUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }, [gameState.myCards, gameState.opponentCards, gameState.sharedCards, myDeckImageUrls, forgeResolver]);

  const criticalImageUrls = useMemo(
    () => buildCriticalImageUrls(gameState.myCards, gameState.opponentCards, gameState.sharedCards, forgeResolver),
    [gameState.myCards, gameState.opponentCards, gameState.sharedCards, forgeResolver],
  );
  const { getImage, areUrlsLoaded, progress: imageLoadProgress } = useMultiplayerImagePreloader(allImageUrls);
  const criticalReady = criticalImageUrls.length > 0 && areUrlsLoaded(criticalImageUrls);
  useEffect(() => {
    if (criticalReady) setImagesGateOpen(true);
  }, [criticalReady]);
  // Safety timer — never hold a truly-offline user hostage.
  useEffect(() => {
    if (imagesGateOpen) return;
    if (gateTimerRef.current !== null) return;
    if (gameId === null) return;
    gateTimerRef.current = setTimeout(() => setImagesGateOpen(true), IMAGE_GATE_TIMEOUT_MS);
    return () => {
      if (gateTimerRef.current) {
        clearTimeout(gateTimerRef.current);
        gateTimerRef.current = null;
      }
    };
  }, [imagesGateOpen, gameId]);

  // Game timer — anchored to server-recorded playingStartedAtMicros so elapsed
  // time survives navigating away and back to the game. Server-authoritative
  // pause fields (mutually-agreed pause feature) are folded in so both players
  // see the same elapsed time when paused.
  const gameTimer = useGameTimer(
    gameState.game?.playingStartedAtMicros ?? null,
    gameState.game?.pauseStartedAtMicros ?? 0n,
    gameState.game?.totalPausedMicros ?? 0n,
    // The compact touch shell hides the readout by layout, but the 1 Hz tick
    // still re-rendered GameInner — and with it the whole Konva canvas — every
    // second for the life of the game. Skip the interval where it can't show.
    { tickEnabled: !compactTouchShell },
  );

  // ---- Mutually-agreed pause callbacks (passed to TurnIndicator + ConsentToast) ----
  const handleRequestPause = useCallback(() => {
    if (!conn || gameId === null) return;
    try {
      conn.reducers.requestPause({ gameId });
    } catch (e) {
      console.error('Failed to request pause:', e);
    }
  }, [conn, gameId]);

  const handleRequestResume = useCallback(() => {
    if (!conn || gameId === null) return;
    try {
      conn.reducers.requestResume({ gameId });
    } catch (e) {
      console.error('Failed to request resume:', e);
    }
  }, [conn, gameId]);

  const handleCancelPauseRequest = useCallback(() => {
    if (!conn || gameId === null) return;
    try {
      conn.reducers.cancelPauseRequest({ gameId });
    } catch (e) {
      console.error('Failed to cancel pause request:', e);
    }
  }, [conn, gameId]);

  const handleRespondToPause = useCallback((accepted: boolean) => {
    if (!conn || gameId === null) return;
    try {
      conn.reducers.respondToPause({ gameId, accepted });
    } catch (e) {
      console.error('Failed to respond to pause:', e);
    }
  }, [conn, gameId]);

  const handleRespondToResume = useCallback((accepted: boolean) => {
    if (!conn || gameId === null) return;
    try {
      conn.reducers.respondToResume({ gameId, accepted });
    } catch (e) {
      console.error('Failed to respond to resume:', e);
    }
  }, [conn, gameId]);

  // Track unread chat messages at this level so the count survives ChatPanel
  // unmounting when the right panel collapses.
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  // The counter used to start at 0, so the entire existing history counted as
  // unread the moment the subscription landed — and this component remounts on
  // every reconnect, so a flaky phone connection re-flagged every message in
  // the game, every time. `isChatReady` alone isn't enough to fix it: the flag
  // flips true one render BEFORE the backlog rows arrive (measured), so it
  // would still baseline at 0 and then count the whole history. Instead, keep
  // re-baselining until the sync has visibly settled.
  const prevChatCountRef = useRef(0);
  const [chatSyncSettled, setChatSyncSettled] = useState(false);
  useEffect(() => {
    if (!gameState.isChatReady) return;
    const t = setTimeout(() => setChatSyncSettled(true), 1500);
    return () => clearTimeout(t);
  }, [gameState.isChatReady]);
  useEffect(() => {
    // Only player-to-player messages. senderId 0n is the system sentinel
    // ("X started spectating", privacy toggles); those render in the Log tab,
    // so counting them lit the "new chat" badge for things that were not chat.
    const messages = gameState.chatMessages;
    const current = messages.reduce((n, m) => (m.senderId !== 0n ? n + 1 : n), 0);
    const prev = prevChatCountRef.current;
    prevChatCountRef.current = current;
    if (!chatSyncSettled || current <= prev) return;
    if (isLoupeVisible) return;
    setUnreadChatCount((n) => n + (current - prev));
    // A badge on the collapsed rail is a 17px target at the screen edge; a
    // player looking at the board will not see it. Chat is how an opponent
    // says "wait, can we back that up?" — surface the newest one where every
    // other important event already surfaces.
    const newest = [...messages].reverse().find((m) => m.senderId !== 0n);
    const mine = gameState.myPlayer?.id;
    if (newest && (mine === undefined || newest.senderId !== mine)) {
      const who = newest.senderId === gameState.opponentPlayer?.id
        ? gameState.opponentPlayer.displayName
        : 'Spectator';
      const body = newest.text.length > 80 ? `${newest.text.slice(0, 80)}…` : newest.text;
      showGameToast(`💬 ${who}: ${body}`, 4000, { verbatim: true });
    }
  }, [gameState.chatMessages, chatSyncSettled, gameState.myPlayer, gameState.opponentPlayer, isLoupeVisible]);

  // Clear unread when panel opens
  useEffect(() => {
    if (isLoupeVisible) {
      setUnreadChatCount(0);
    }
  }, [isLoupeVisible]);

  // Undo handler — runs the top reverse and maps the result to a toast.
  const handleUndo = useCallback(() => {
    const r = undoStack.undo();
    switch (r.status) {
      case 'applied': showGameToast(`Undo: ${r.description}`); break;
      case 'empty':   showGameToast('Nothing to undo'); break;
      case 'refused': showGameToast("Nothing left to undo on the board"); break;
      case 'threw':
        console.warn('Undo threw', r.error);
        showGameToast("Couldn't undo — the action can't be reversed");
        break;
    }
  }, [undoStack]);

  // Clear the undo stack when the LOCAL player's turn ends (isMyTurn true→false),
  // not on every turnNumber change (that fires for both players and on reconnect
  // snapshots). Gate on a present, playing game so a reconnect that momentarily
  // drops `game` to undefined can't synthesize a false true→false edge.
  const prevIsMyTurnRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const hasGame = !!gameState.game;
    const isMyTurn = gameState.isMyTurn;
    if (lifecycle === 'playing' && hasGame && shouldClearUndoStack(prevIsMyTurnRef.current, isMyTurn)) {
      undoStack.clear();
    }
    if (lifecycle === 'playing' && hasGame) prevIsMyTurnRef.current = isMyTurn;
  }, [gameState.isMyTurn, gameState.game, lifecycle, undoStack]);

  // Clear undo stack when leaving the playing state
  useEffect(() => {
    if (lifecycle !== 'playing') {
      undoStack.clear();
    }
  }, [lifecycle, undoStack]);

  // Keyboard shortcuts — active only during a live game.
  const hotkeysActions = useMemo<GameActions>(() => ({
    drawCard: () => gameState.drawCard(),
    shuffleDeck: () => gameState.shuffleDeck(),
    moveCard: () => {},
    moveCardsBatch: () => {},
    flipCard: () => {},
    meekCard: () => {},
    unmeekCard: () => {},
    addCounter: () => {},
    removeCounter: () => {},
    shuffleCardIntoDeck: () => {},
    setNote: () => {},
    exchangeCards: () => {},
    drawMultiple: () => {},
    moveCardToTopOfDeck: () => {},
    moveCardToBottomOfDeck: () => {},
    randomHandToZone: () => {},
    randomReserveToZone: () => {},
    reloadDeck: () => {},
  }), [gameState]);

  useGameHotkeys({
    actions: hotkeysActions,
    mode: 'multiplayer',
    isMyTurn: gameState.isMyTurn,
    enabled: lifecycle === 'playing',
    handSize: gameState.myCards['hand']?.length ?? 0,
    deckSize: gameState.myCards['deck']?.length ?? 0,
    onRollDice: () => gameState.rollDice(BigInt(20)),
    onToggleSpreadHand: toggleSpreadHand,
    onToggleLoupe: toggleLoupe,
    onAdvancePhase: requestEndTurn,
    onUndo: handleUndo,
  });

  // Once subscription data is ready, call the appropriate reducer once.
  // Gate on BOTH Game and Player subscriptions being applied. Game alone isn't
  // enough — the reconnect branch below reads `allPlayers` to decide whether
  // we're already joined, and a Player subscription that hasn't applied yet
  // makes that check return false. The joiner then falls through to joinGame,
  // which the server rejects on a 'playing'-status game with "No waiting game",
  // surfacing as the "Game is no longer available" lobby toast.
  useEffect(() => {
    console.log('[game-debug] reducer effect:', { isGamesReady: gameState.isGamesReady, isPlayersReady: gameState.isPlayersReady, hasConn: !!conn, didCall: didCallReducer.current, role: gameParams?.role, deckReady: deckData !== null });
    if (!gameState.isGamesReady || !gameState.isPlayersReady || !conn || didCallReducer.current) return;

    if (!gameParams) {
      console.log('[game-debug] no gameParams — showing error');
      didCallReducer.current = true;
      setErrorMessage('No game parameters found. Please return to the lobby.');
      setLifecycle('error');
      return;
    }

    // Wait for the post-navigation deck load to complete before calling the
    // reducer. The cave loading screen is already visible to the user.
    if (deckData === null) return;

    // Forge games authorize the seat by connected identity before calling the
    // reducer. Don't mark didCallReducer yet — this effect must re-run once
    // the SpacetimeDB connection resolves our identity (gameState.identityHex
    // is in the deps array below), otherwise we'd get stuck without ever
    // dispatching create/join.
    if (gameParams.isForge && !gameState.identityHex) return;

    didCallReducer.current = true;

    // Reconnect scenario: if the game already exists and we already have a
    // player row in it, skip the create/join call. Both fail otherwise:
    //   - createGame fails with "code already in use"
    //   - joinGame fails with "No waiting game found" (status is no longer 'waiting')
    // Filter out finished games — old games with the same code may still exist.
    const existingGame = (gameState.allGames || []).find(
      (g: any) => g.code === code && g.status !== 'finished'
    );
    if (existingGame) {
      const alreadyJoined = (gameState.allPlayers || []).some(
        (p: any) => p.gameId === existingGame.id
          && (p.identity as any)?.toHexString?.() === gameState.identityHex
      );
      if (gameParams.role === 'create' || alreadyJoined) {
        console.log('[game-debug] reconnect — reusing existing game:', String(existingGame.id), existingGame.status, 'role:', gameParams.role, 'alreadyJoined:', alreadyJoined);
        setGameId(existingGame.id);
        return; // lifecycle sync effect handles the rest
      }
    }

    // Guard against re-creating a duplicate after the game has already
    // finished. A connection-reset remount can replay the stale `role:'create'`
    // sessionStorage instruction; the reconnect lookup above ignores finished
    // games, so without this we'd call createGame again and spawn a duplicate
    // under the same code (the 'Z6NJ' incident). Reuse the finished row instead.
    const reuseFinishedId = finishedGameToReuseOnCreate(
      gameParams.role,
      (gameState.allGames || []) as any,
      code
    );
    if (reuseFinishedId !== null) {
      console.log('[game-debug] create replayed after finish — reusing finished game:', String(reuseFinishedId));
      setGameId(reuseFinishedId);
      return; // lifecycle sync effect shows the ended state
    }

    if (gameParams.isForge) {
      const identityHex = gameState.identityHex as string;
      setLifecycle(gameParams.role === 'create' ? 'creating' : 'joining');
      void (async () => {
        const auth = await authorizeForgeSeat({ code, identityHex });
        if (auth.ok === false) {
          setErrorMessage(auth.error);
          setLifecycle('error');
          return;
        }
        const args = {
          code,
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          paragon: forgeDeckMeta?.paragon ?? '',          // sanitized server-side; NEVER gameParams.paragon here
          format: forgeDeckMeta?.format ?? gameParams.format ?? 'Type 1',
          supabaseUserId: gameParams.supabaseUserId,
          deckData,
        };
        try {
          if (gameParams.role === 'create') {
            conn.reducers.createForgeGame(args);
            setLifecycle('waiting');
          } else {
            // Pre-flight: reject obvious format mismatch before calling the reducer,
            // mirroring the public join path — the server performs the authoritative
            // check (see spacetimedb/src/index.ts).
            const hostGame = (gameState.allGames || []).find(
              (g: any) => g.code === code && g.status === 'waiting'
            );
            if (hostGame) {
              const joinerFormat = normalizeDeckFormat(args.format);
              const hostFormat = normalizeDeckFormat(hostGame.format);
              if (joinerFormat !== hostFormat) {
                setFormatMismatch({ host: hostFormat, joiner: joinerFormat });
                setErrorMessage(
                  `This game is ${hostFormat}. Your selected deck is ${joinerFormat} — pick a ${hostFormat} deck to join.`
                );
                setLifecycle('error');
                return;
              }
            }
            conn.reducers.joinForgeGame(args)?.catch?.((e: unknown) => {
              setErrorMessage(e instanceof Error ? e.message : 'Could not join the game.');
              setLifecycle('error');
            });
          }
        } catch (e) {
          setErrorMessage(e instanceof Error ? e.message : 'Could not start the game.');
          setLifecycle('error');
        }
      })();
      return;
    }

    try {
      if (gameParams.role === 'create') {
        console.log('[game-debug] calling createGame reducer for code:', code);
        setLifecycle('creating');
        conn.reducers.createGame({
          code,
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          paragon: gameParams.paragon || '',
          format: gameParams.format ?? 'standard',
          supabaseUserId: gameParams.supabaseUserId,
          deckData,
          isPublic: gameParams.isPublic ?? true,
          lobbyMessage: gameParams.lobbyMessage ?? '',
        });
        // Transition to waiting — the game row will appear via subscription
        console.log('[game-debug] createGame called — setting lifecycle to waiting');
        setLifecycle('waiting');
      } else {
        setLifecycle('joining');

        // Pre-flight: reject obvious format mismatch before calling the reducer
        // so the user gets a crisp error instead of a generic SenderError toast.
        // The server performs the authoritative check (see spacetimedb/src/index.ts).
        const hostGame = (gameState.allGames || []).find(
          (g: any) => g.code === code && g.status === 'waiting'
        );
        if (hostGame) {
          const joinerFormat = normalizeDeckFormat(gameParams.format ?? 'Type 1');
          const hostFormat = normalizeDeckFormat(hostGame.format);
          if (joinerFormat !== hostFormat) {
            setFormatMismatch({ host: hostFormat, joiner: joinerFormat });
            setErrorMessage(
              `This game is ${hostFormat}. Your selected deck is ${joinerFormat} — pick a ${hostFormat} deck to join.`
            );
            setLifecycle('error');
            return;
          }
        }

        // joinGame returns a Promise that rejects with SenderError on server-side
        // validation failures. Without an explicit .catch(), the rejection becomes
        // an unhandled error and trips Next.js's runtime error overlay.
        conn.reducers.joinGame({
          code,
          deckId: gameParams.deckId,
          displayName: gameParams.displayName,
          paragon: gameParams.paragon || '',
          format: gameParams.format ?? 'Type 1',
          supabaseUserId: gameParams.supabaseUserId,
          deckData,
        }).catch((joinErr: unknown) => {
          const msg = joinErr instanceof Error ? joinErr.message : 'Failed to join game';
          if (msg.includes('cannot join your own game')) {
            setIsSelfJoin(true);
          } else if (msg.includes('No waiting game')) {
            setErrorMessage(`No game found with code "${code}". The game may have ended or the code may be incorrect.`);
          } else {
            setErrorMessage(msg);
          }
          setLifecycle('error');
        });
      }
    } catch (e: unknown) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to initialize game');
      setLifecycle('error');
    }
  }, [gameState.isGamesReady, gameState.isPlayersReady, conn, code, gameParams, deckData, gameState.identityHex, forgeDeckMeta]);

  // Also get raw game list to find our game by code before we know the ID
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const spacetimeCtxForGames = useSpacetimeDB() as any;

  useEffect(() => {
    if (gameId !== null) return; // Already discovered
    const { allGames } = gameState;
    if (!allGames) return;
    const gamesWithCode = allGames.filter((g: any) => g.code === code);
    if (gamesWithCode.length > 0) {
      console.log('[game-debug] discovery — all games with code:', gamesWithCode.map((g: any) => ({ id: String(g.id), status: g.status })));
    }
    // Prefer active games — old finished games with the same code may still exist
    const found = allGames.find((g: any) => g.code === code && g.status !== 'finished')
      ?? allGames.find((g: any) => g.code === code);
    if (found) {
      console.log('[game-debug] discovery — selected game:', String(found.id), 'status:', found.status);
      setGameId(found.id);
    }
  }, [gameState.allGames, code, gameId]);

  // Fast detection: once subscription data arrives and we're still 'joining',
  // check if a game with our code exists. If not, fail immediately.
  // Only look for non-finished games — finished games with the same code are stale.
  useEffect(() => {
    if (lifecycle !== 'joining') return;
    const { allGames } = gameState;
    if (!gameState.isGamesReady) return; // subscription not applied yet
    const found = allGames.find((g: any) => g.code === code && g.status !== 'finished');
    if (!found) {
      setErrorMessage(`No game found with code "${code}". The game may have ended or the code may be incorrect.`);
      setLifecycle('error');
    }
  }, [lifecycle, gameState.allGames, code]);

  // Fallback timeout — if subscription never arrives (network issues), fail after 5s
  useEffect(() => {
    if (lifecycle !== 'joining') return;
    const timeout = setTimeout(() => {
      setErrorMessage(`Could not connect to game "${code}". Please check your connection and try again.`);
      setLifecycle('error');
    }, 12000);
    return () => clearTimeout(timeout);
  }, [lifecycle, code]);

  // Sync lifecycle state from live game data
  useEffect(() => {
    const { game } = gameState;
    if (!game) return;

    console.log('[game-debug] lifecycle sync — game.status:', game.status, 'current lifecycle:', lifecycle, 'gameId:', String(game.id));

    if (game.status === 'waiting') {
      // Joiners should never render the "waiting" lobby — that state belongs
      // to the creator. The server's join_game reducer atomically transitions
      // status to 'pregame', so a joiner seeing 'waiting' means their join
      // hasn't committed yet. Keep them in the 'joining' loading screen.
      if (gameParams?.role === 'join') return;
      setLifecycle('waiting');
    } else if (game.status === 'pregame') {
      setLifecycle('pregame');
    } else if (game.status === 'playing') {
      setLifecycle('playing');
    } else if (game.status === 'finished' && lifecycle === 'pregame') {
      setErrorFromPregame(true);
      setErrorMessage('Opponent disconnected. Game cancelled.');
      setLifecycle('error');
      return;
    } else if (game.status === 'finished') {
      console.log('[game-debug] lifecycle sync — transitioning to FINISHED from', lifecycle);
      setLifecycle('finished');
    }
  }, [gameState.game, lifecycle]);

  // Pause/resume based on search modal state
  useEffect(() => {
    if (lifecycle !== 'playing') return;
    if (isSearchModalOpen) {
      gameTimer.pause();
    } else {
      gameTimer.resume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearchModalOpen, lifecycle]);

  // Clean up waiting-status games when the user navigates away (component unmount).
  // We intentionally do NOT use beforeunload — it fires on page refresh, which
  // would kill the game immediately. Instead, the server's 30-second disconnect
  // timeout (DisconnectTimeout) handles tab close / crashes, giving enough time
  // for page refreshes and WebSocket reconnections.
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // WS-3 §3: the host was in the waiting room (possibly practicing) and the
  // opponent's join moves the game straight into the roll ceremony — announce
  // it. Reading the opponent name via gameStateRef (not a dep) is deliberate:
  // gameState is a fresh object every render, and this must fire once per
  // lifecycle change only. Joiners (prev 'joining') initiated the join;
  // rematches (prev 'finished') and refreshes (prev 'creating') aren't a join.
  const prevLifecycleForToastRef = useRef<LifecycleState>('creating');
  useEffect(() => {
    const prev = prevLifecycleForToastRef.current;
    prevLifecycleForToastRef.current = lifecycle;
    if (lifecycle === 'pregame' && prev === 'waiting') {
      setIsPracticing(false);
      setJustJoinedToast(gameStateRef.current.opponentPlayer?.displayName || 'Opponent');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycle]);

  useEffect(() => {
    if (!justJoinedToast) return;
    const timer = setTimeout(() => setJustJoinedToast(null), JOINED_TOAST_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justJoinedToast]);

  // Track whether the page is being unloaded (refresh / tab close) so we can
  // skip the synchronous leave_game on unmount in that case. Refreshes fire
  // React's useEffect cleanup BEFORE the page tears down, and calling
  // leave_game would mark a waiting game 'finished' — kicking spectators
  // before the host's refresh completes. The server's 30-second
  // DisconnectTimeout handles refreshes/crashes; the unmount cleanup is only
  // needed for in-app navigation away.
  const isUnloadingRef = useRef(false);
  useEffect(() => {
    const onPageHide = () => { isUnloadingRef.current = true; };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, []);

  useEffect(() => {
    if (gameId === null) return;
    return () => {
      // SPA-navigation cleanup only — skip if the page itself is unloading
      // (refresh / tab close), since those fire this same cleanup but the
      // host is coming right back. Let the server's 30s timeout handle them.
      if (isUnloadingRef.current) return;
      if (lifecycleRef.current === 'waiting') {
        gameStateRef.current.leaveGame();
      }
    };
  }, [gameId]);

  // Build a player name map for ChatPanel
  const playerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
    if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
    return map;
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Build paragon entries for the ParagonDrawer overlay (0-2 entries).
  const paragonEntries = useMemo(() => {
    const players: Array<{ id: string; displayName: string; paragonName: string | null; isSelf: boolean }> = [];
    if (gameState.myPlayer) {
      players.push({
        id: String(gameState.myPlayer.id),
        displayName: gameState.myPlayer.displayName,
        paragonName: gameState.myPlayer.paragon || null,
        isSelf: true,
      });
    }
    if (gameState.opponentPlayer) {
      players.push({
        id: String(gameState.opponentPlayer.id),
        displayName: gameState.opponentPlayer.displayName,
        paragonName: gameState.opponentPlayer.paragon || null,
        isSelf: false,
      });
    }
    return buildParagonEntries({ players });
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Compute goldfish deck for practice-while-waiting
  const goldfishDeck = useMemo(() => {
    if (!gameParams || !deckData) return null;
    try {
      const cards = JSON.parse(deckData) as GameCardData[];
      if (cards.length === 0) return null;
      return convertToGoldfishDeck(
        mergeForgeDeckData(cards, forgeResolver),
        gameParams.deckId,
        gameParams.deckName || 'Practice Deck',
        gameParams.format || 'Type 1',
        gameParams.paragon
      );
    } catch {
      return null;
    }
  }, [gameParams, deckData, forgeResolver]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Auto-redirect to lobby when game is not found (stale lobby, expired, wrong code)
  // instead of stranding the user on a dead-end error page
  const isGameNotFound = lifecycle === 'error' && errorMessage?.includes('No game found');
  useEffect(() => {
    if (!isGameNotFound) return;
    // "No longer available" reads as "your friend's game just ended" — but the
    // overwhelmingly common cause is a mistyped code for a game that never
    // existed. Say what the player can actually act on.
    sessionStorage.setItem(
      'lobby_error',
      `No open game with the code "${code}". Codes are 4 characters — check it, or ask for a fresh invite link.`,
    );
    router.replace(lobbyPath);
  }, [isGameNotFound, code, router, lobbyPath]);

  // Auto-redirect back to the invite-style lobby on format mismatch so the user
  // can swap to a matching-format deck without clicking through the error screen.
  // Preserves the code via ?join=CODE so they stay in the join-this-game flow.
  const isFormatMismatch = lifecycle === 'error' && formatMismatch !== null;
  useEffect(() => {
    if (lifecycle !== 'error' || !formatMismatch) return;
    sessionStorage.setItem(
      'lobby_error',
      `This game is ${formatMismatch.host}. Your deck is ${formatMismatch.joiner} — pick a ${formatMismatch.host} deck and try again.`
    );
    // Clear the stale join params so the page can't auto-rejoin with the same deck.
    sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${code}`);
    router.replace(isForge ? lobbyPath : `/play?join=${code}`);
  }, [lifecycle, formatMismatch, code, router, isForge, lobbyPath]);

  if (isLeaving) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
        <div
          className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
          style={{ backgroundImage: gameBackground, backgroundPosition: 'center 70%' }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />
        <p className="relative z-10 font-cinzel text-sm tracking-wide text-amber-200/70">
          Returning to lobby...
        </p>
      </div>
    );
  }

  if (lifecycle === 'error') {
    if (isGameNotFound || isFormatMismatch) {
      // Show brief loading state while redirecting
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Returning to lobby...</p>
        </div>
      );
    }
    if (errorFromPregame) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-black">
          <div
            className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
            style={{ backgroundImage: gameBackground, backgroundPosition: 'center 70%' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
          />
          <div className="relative z-10 rounded-xl border border-red-500/20 bg-black/60 backdrop-blur-sm p-8 text-center max-w-sm mx-4">
            <div className="mb-4 flex justify-center">
              <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
            </div>
            <p className="text-base font-semibold font-cinzel text-amber-200/90 mb-2">Game Cancelled</p>
            <p className="text-sm text-amber-200/50">
              {errorMessage ?? 'An unexpected error occurred.'}
            </p>
            <a
              href={lobbyPath}
              className="mt-6 inline-block rounded border border-[#c4955a]/45 bg-[#c4955a]/15 px-5 py-2.5 font-cinzel text-xs font-bold uppercase tracking-wider text-amber-200/90 hover:bg-[#c4955a]/25 transition-colors"
            >
              Back to Lobby
            </a>
          </div>
        </div>
      );
    }
    const title = isSelfJoin ? "You're hosting this game" : 'Connection Error';
    const body = isSelfJoin
      ? 'Share the code with an opponent so they can join.'
      : (errorMessage ?? 'An unexpected error occurred.');
    return (
      <>
      <TopNav />
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center px-4">
        <div className="rounded-lg border border-border bg-card/95 backdrop-blur-sm p-8 text-center max-w-sm">
          <div className="mb-4 flex justify-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>
          <p className="text-lg font-semibold font-cinzel mb-2">{title}</p>
          <p className="text-sm text-muted-foreground">{body}</p>
          <a
            href={lobbyPath}
            className="mt-6 inline-block rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            Back to Lobby
          </a>
        </div>
      </div>
      </>
    );
  }

  if (lifecycle === 'creating' || lifecycle === 'joining' || (!isConnected && !isActive)) {
    return (
      <>
      <TopNav />
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black">
        {/* Cave background */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40"
          style={{ backgroundImage: gameBackground, backgroundPosition: 'center 70%' }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
        />
        <div className="relative z-10 text-center">
          <p className="font-cinzel text-xl tracking-wide text-amber-200/90 mb-6">
            {lifecycle === 'joining' && isConnected ? 'Connected — starting game…' : loadingMessage}
          </p>
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-amber-200/50 border-t-transparent mx-auto" />
        </div>
        <DebugOverlay
          tone="amber"
          text={`code: ${code} · gameId: ${gameId === null ? 'none' : String(gameId)} · phase: ${lifecycle} · conn: ${isConnected ? 'live' : (isActive ? 'reconnecting' : 'down')} · games: ${gameState.isGamesReady ? 'ready' : 'loading'} · players: ${gameState.isPlayersReady ? 'ready' : 'loading'} · deck: ${deckData ? 'loaded' : 'loading'}`}
        />
      </div>
      </>
    );
  }

  // Determine if we're in a ceremony phase (rolling/choosing/revealing) where
  // the game board should be visible behind the overlay.
  // Once the local player has acknowledged during 'revealing', dismiss the overlay
  // immediately instead of waiting for the server round-trip from the other player.
  const pregamePhase = gameState.game?.pregamePhase;
  const myAckedRevealing = (() => {
    if (pregamePhase !== 'revealing' || !gameState.game || !gameState.myPlayer) return false;
    const isSeat0 = gameState.myPlayer.seat.toString() === '0';
    return isSeat0 ? gameState.game.pregameReady0 : gameState.game.pregameReady1;
  })();
  const isCeremonyPhase = lifecycle === 'pregame' &&
    (pregamePhase === 'rolling' || pregamePhase === 'choosing' || (pregamePhase === 'revealing' && !myAckedRevealing));

  // After the local player acknowledges during 'revealing', the ceremony overlay
  // is dismissed but the server hasn't transitioned game.status to 'playing' yet
  // (waiting for the opponent's ack). Show the game board without any overlay
  // during this brief gap to avoid flashing the lobby/dice screen.
  // Also covers the one-frame window where the server has already transitioned
  // to 'playing' (both acks received) but the lifecycle useEffect hasn't fired
  // yet — without this, the PregameScreen (with TopNav) briefly renders.
  const isAwaitingGameStart = lifecycle === 'pregame' && (
    (myAckedRevealing && pregamePhase === 'revealing') ||
    gameState.game?.status === 'playing'
  );

  // REG Pre-Game Phase steps 2 and 3. These run with status === 'playing', so
  // they render through the playing branch below (which mounts GameToolbar —
  // Search Deck / Draw / Shuffle / Undo, all of which the phase needs), not
  // through the ceremony or awaiting-start branches above.
  const pregameStep: 'stars' | 'souls' | undefined =
    pregamePhase === 'stars' ? 'stars'
    : pregamePhase === 'souls' ? 'souls'
    : undefined;

  // Whether we've requested a rematch and are waiting for the opponent's response
  const rematchPending = (() => {
    const reqBy = gameState.game?.rematchRequestedBy ?? '';
    if (!reqBy) return false;
    const mySeat = gameState.myPlayer ? String(gameState.myPlayer.seat) : '';
    return reqBy === mySeat && !(gameState.game?.rematchResponse);
  })();

  if ((lifecycle === 'waiting' || lifecycle === 'pregame') && !isCeremonyPhase && !isAwaitingGameStart) {
    if (isPracticing && goldfishDeck) {
      return (
        <div className="fixed inset-0 bg-background">
          {/* Floating banner */}
          <div className="fixed top-0 inset-x-0 z-50 h-12 flex items-center justify-between px-4 bg-background/90 backdrop-blur-sm border-b border-border">
            <button
              onClick={() => setIsPracticing(false)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Exit Practice
            </button>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold tracking-wider">{code}</span>
              <span className="text-sm text-muted-foreground">Waiting for opponent</span>
              <span className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
          <div className="pt-12">
            <WaitingRoomGoldfish
              deck={goldfishDeck}
              username={gameParams?.displayName}
              onLoadDeck={() => setShowPracticeDeckPicker(true)}
            />
          </div>

          {/* Practice deck picker — opens from the gear menu in practice mode */}
          {isForge ? (
            <ForgeDeckPickerModal
              open={showPracticeDeckPicker}
              onOpenChange={setShowPracticeDeckPicker}
              onSelect={handleForgePracticeSelect}
              selectedDeckId={gameParams?.deckId}
            />
          ) : (
            <DeckPickerModal
              open={showPracticeDeckPicker}
              onOpenChange={setShowPracticeDeckPicker}
              onSelect={async (deck) => {
                setShowPracticeDeckPicker(false);
                if (!gameParams || deck.id === gameParams.deckId) return;
                try {
                  const result = await loadDeckForGame(deck.id);
                  setPracticeDeckConfirm({
                    deckId: deck.id,
                    deckName: deck.name,
                    deckData: JSON.stringify(result.deckData),
                    paragon: deck.paragon || '',
                    format: deck.format || gameParams.format || 'Type 1',
                  });
                } catch (err) {
                  console.error('Failed to load deck for practice swap:', err);
                }
              }}
              selectedDeckId={gameParams?.deckId}
            />
          )}
          <ForgeSwapErrorDialog error={forgeSwapError} onClose={() => setForgeSwapError(null)} />

          {practiceDeckConfirm && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}>
              <div style={{
                background: 'rgba(14, 10, 6, 0.97)',
                border: '1px solid rgba(107, 78, 39, 0.3)',
                borderRadius: 8,
                padding: '20px 28px',
                maxWidth: 340,
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
              }}>
                <p style={{
                  fontFamily: 'Georgia, serif',
                  color: '#e8d5a3',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  Change your game deck to <strong>{practiceDeckConfirm.deckName}</strong>?
                  <br />
                  <span style={{ fontSize: 11, color: 'rgba(196, 149, 90, 0.7)' }}>
                    Your practice game will reset and your opponent will see the new deck once they join.
                  </span>
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                  <button
                    onClick={() => setPracticeDeckConfirm(null)}
                    style={{
                      padding: '7px 18px',
                      background: 'transparent',
                      border: '1px solid rgba(107, 78, 39, 0.3)',
                      borderRadius: 4,
                      color: 'rgba(196, 149, 90, 0.6)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const next = practiceDeckConfirm;
                      setPracticeDeckConfirm(null);
                      // Tell SpacetimeDB about the new deck so it gets used when
                      // the actual game starts.
                      gameState.pregameChangeDeck(next.deckId, next.deckData, next.paragon);
                      // Update local state so practice rebuilds with new deck.
                      // Persist to sessionStorage so a refresh keeps the swap.
                      setGameParams((prev) => {
                        if (!prev) return prev;
                        const updated = {
                          ...prev,
                          deckId: next.deckId,
                          deckName: next.deckName,
                          paragon: next.paragon,
                        };
                        try {
                          sessionStorage.setItem(
                            `${SESSION_KEY_PREFIX}${code}`,
                            JSON.stringify(updated),
                          );
                        } catch {}
                        return updated;
                      });
                      setDeckData(next.deckData);
                    }}
                    style={{
                      padding: '7px 18px',
                      background: 'rgba(196, 149, 90, 0.15)',
                      border: '1px solid rgba(196, 149, 90, 0.45)',
                      borderRadius: 4,
                      color: '#e8d5a3',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Georgia, serif',
                      fontWeight: 600,
                    }}
                  >
                    Change deck
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <PregameScreen
        code={code}
        lifecycle={lifecycle}
        gameId={gameId}
        gameState={gameState}
        myDisplayName={gameParams?.displayName ?? ''}
        myDeckName={gameParams?.deckName}
        goldfishDeck={goldfishDeck}
        onPractice={() => setIsPracticing(true)}
        onBackToLobby={handleReturnToLobby}
        onUpdateMessage={gameId && conn ? (message: string) => {
          conn.reducers.updateLobbyMessage({ gameId, message });
        } : undefined}
        onTogglePublic={isForge ? undefined : gameId && conn ? (isPublic: boolean) => {
          conn.reducers.setGamePublic({ gameId, isPublic });
        } : undefined}
        isForge={isForge}
        onDeckChanged={(next) => {
          // Mirror the practice-swap bookkeeping: keep gameParams/sessionStorage
          // and the local deckData (which feeds practice goldfish + image
          // preload) in sync with what the server now has in pendingDeckData.
          setGameParams((prev) => {
            if (!prev) return prev;
            const updated = {
              ...prev,
              deckId: next.deckId,
              deckName: next.deckName,
              paragon: next.paragon,
            };
            try {
              sessionStorage.setItem(`${SESSION_KEY_PREFIX}${code}`, JSON.stringify(updated));
            } catch {}
            return updated;
          });
          setDeckData(next.deckData);
        }}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Return to lobby handler used by GameOverOverlay
  // ---------------------------------------------------------------------------
  function handleReturnToLobby() {
    setIsLeaving(true);
    gameState.leaveGame();
    router.push(lobbyPath);
  }

  // ---------------------------------------------------------------------------
  // Right panel — collapses entirely when preview is hidden
  // ---------------------------------------------------------------------------
  const rightPanel = (
    <RightPanel
      chatMessages={gameState.chatMessages}
      gameActions={gameState.gameActions}
      myPlayerId={gameState.myPlayer?.id ?? BigInt(0)}
      onSendChat={gameState.sendChat}
      playerNames={playerNameMap}
      chatScale={chatScale}
      unreadChatCount={unreadChatCount}
      spectators={gameState.spectators as Array<{ id: bigint; identity: { toHexString: () => string }; displayName: string }>}
      myIdentityHex={gameState.identityHex}
      shareHandWithSpectators={gameState.myPlayer?.shareHandWithSpectators}
      isGamePublic={gameState.game?.isPublic}
      onSetShareHand={(share) => { if (gameId !== null) conn?.reducers.setShareHandWithSpectators({ gameId, share }); }}
      onKickSpectator={(spectatorId) => { if (gameId !== null) conn?.reducers.kickSpectator({ gameId, spectatorId }); }}
      onSetGamePrivate={(isPublic) => { if (gameId !== null) conn?.reducers.setGamePrivate({ gameId, isPublic }); }}
    />
  );

  // Phone portrait is structurally broken (RightPanel's 280px floor leaves
  // ~113px of canvas), so gate it rather than render a 6x8px board. Placed
  // after every hook so hook order stays stable across renders — and BEFORE
  // every board-rendering branch (ceremony / awaiting-start / finished /
  // playing). It used to sit just above the 'playing' return, so a portrait
  // player watched the ceremony render fine and then had the rotate wall
  // slam in the moment status flipped to 'playing' — reading as a crash.
  if (gateForPortrait) {
    return (
      <RotateDevicePrompt
        onContinueAnyway={dismissPortraitGate}
        lobbyHref={lobbyPath}
      />
    );
  }

  // lifecycle === 'pregame' ceremony phases (rolling/choosing/revealing) —
  // show the game board with the roll/choose overlay on top so players
  // can see their dealt hand while deciding who goes first.
  if (isCeremonyPhase) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: gameBackground, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, height: 48 }}>
            <TurnIndicator
              lobbyPath={lobbyPath}
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              myScore={gameState.soulsRescued.me}
              opponentScore={gameState.soulsRescued.opponent}
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
              onRequestPause={handleRequestPause}
              onRequestResume={handleRequestResume}
              onCancelPauseRequest={handleCancelPauseRequest}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} getImage={getImage} chatScale={chatScale} setChatScale={setChatScale} resetChatScale={resetChatScale} minChatScale={CHAT_MIN_SCALE} maxChatScale={CHAT_MAX_SCALE} chatStep={CHAT_STEP} forgeResolver={forgeResolver} compactLayout={compactTouchShell} />
            )}
            <PregameCeremonyOverlay gameState={gameState} />
            {justJoinedToast && <OpponentJoinedToast name={justJoinedToast} />}
            {/* Suppress the load gate during the pregame ceremony — its 30s
                choose-first timer is server-anchored and ticks regardless of
                client preloading, so we don't want a full-screen loader
                covering the decision buttons and eating into the budget. */}
            <ImageLoadingGate open={!imagesGateOpen && !isCeremonyPhase} progress={imageLoadProgress} />
            <GameToastContainer />
            <PauseConsentToast
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              onRespondToPause={handleRespondToPause}
              onRespondToResume={handleRespondToResume}
            />
            <SpectatorHandRequestBanner gameId={gameId} myPlayer={gameState.myPlayer ?? null} />
            <CardChoicePromptContainer />
          </div>
        </div>
        {rightPanel}
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
      </div>
    );
  }

  // Transitional state: local player has acked the reveal but the server hasn't
  // transitioned to 'playing' yet. Show the game board cleanly (no overlay, no
  // toolbar) so there's no flash of the lobby screen.
  if (isAwaitingGameStart) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: gameBackground, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, height: 48 }}>
            <TurnIndicator
              lobbyPath={lobbyPath}
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              myScore={gameState.soulsRescued.me}
              opponentScore={gameState.soulsRescued.opponent}
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
              onRequestPause={handleRequestPause}
              onRequestResume={handleRequestResume}
              onCancelPauseRequest={handleCancelPauseRequest}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {gameId !== null && (
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} getImage={getImage} chatScale={chatScale} setChatScale={setChatScale} resetChatScale={resetChatScale} minChatScale={CHAT_MIN_SCALE} maxChatScale={CHAT_MAX_SCALE} chatStep={CHAT_STEP} forgeResolver={forgeResolver} compactLayout={compactTouchShell} />
            )}
            <ImageLoadingGate open={!imagesGateOpen} progress={imageLoadProgress} />
            <GameToastContainer />
            <PauseConsentToast
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              onRespondToPause={handleRespondToPause}
              onRespondToResume={handleRespondToResume}
            />
            <SpectatorHandRequestBanner gameId={gameId} myPlayer={gameState.myPlayer ?? null} />
            <CardChoicePromptContainer />
          </div>
        </div>
        {rightPanel}
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
      </div>
    );
  }

  // lifecycle === 'finished' — show canvas (frozen) with GameOverOverlay on top,
  // or render the overlay standalone if canvas data is unavailable.
  if (lifecycle === 'finished') {
    const { label: endLabel, winnerName } = deriveEndReason(gameState.gameActions, gameState.myPlayer);
    // "Opponent left" — either the 5-min disconnect timeout fired, or the
    // opponent has dropped presence (explicitly left to lobby, closed tab, etc.).
    // In either case, no rematch is possible — surface Back to Lobby instead.
    const opponentDisconnected =
      endLabel === 'Opponent disconnected' || gameState.opponentPlayer?.isConnected === false;

    // Show the overlay over the frozen canvas — always render canvas if gameId is known
    if (gameId !== null) {
      return (
        <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: gameBackground, backgroundSize: 'cover', backgroundPosition: 'center' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, height: 48 }}>
              <TurnIndicator
                lobbyPath={lobbyPath}
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                opponentConnectionStatus={gameState.opponentConnectionStatus}
                isMyTurn={false}
                onSetPhase={() => {}}
                onEndTurn={() => {}}
                isFinished
                winnerName={winnerName}
                onPlayAgain={opponentDisconnected ? undefined : () => setPlayAgainTriggered(true)}
                onBackToLobby={opponentDisconnected ? handleReturnToLobby : undefined}
                rematchPending={rematchPending}
                onCancelRematch={gameState.cancelRematch}
                myScore={gameState.soulsRescued.me}
                opponentScore={gameState.soulsRescued.opponent}
                timerDisplay={gameTimer.formatted}
                timerPaused={isSearchModalOpen}
                timerVisible={gameTimer.isTimerVisible}
                onRequestPause={handleRequestPause}
                onRequestResume={handleRequestResume}
                onCancelPauseRequest={handleCancelPauseRequest}
              />
            </div>
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} getImage={getImage} chatScale={chatScale} setChatScale={setChatScale} resetChatScale={resetChatScale} minChatScale={CHAT_MIN_SCALE} maxChatScale={CHAT_MAX_SCALE} chatStep={CHAT_STEP} forgeResolver={forgeResolver} compactLayout={compactTouchShell} />
              {/* Bottom toolbar — stays active for draw/shuffle, end turn disabled */}
              <GameToolbar
                actions={{
                  drawCard: () => gameState.drawCard(),
                  drawMultiple: (n) => gameState.drawMultiple(BigInt(n)),
                  moveCard: (id, zone, px, py) => gameState.moveCard(BigInt(id), zone, undefined, px, py),
                  moveCardsBatch: (ids, zone) => gameState.moveCardsBatch(JSON.stringify(ids), zone),
                  flipCard: (id) => gameState.flipCard(BigInt(id)),
                  meekCard: (id) => gameState.meekCard(BigInt(id)),
                  unmeekCard: (id) => gameState.unmeekCard(BigInt(id)),
                  addCounter: (id, c) => gameState.addCounter(BigInt(id), c),
                  removeCounter: (id, c) => gameState.removeCounter(BigInt(id), c),
                  shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
                  shuffleDeck: () => gameState.shuffleDeck(),
                  setNote: (id, t) => gameState.setNote(BigInt(id), t),
                  exchangeCards: (ids) => gameState.exchangeCards(JSON.stringify(ids)),
                  moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
                  moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
                  randomHandToZone: (count, toZone, deckPosition) => gameState.randomHandToZone(count, toZone, deckPosition),
                  randomReserveToZone: (count, toZone, deckPosition) => gameState.randomReserveToZone(count, toZone, deckPosition),
                  reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
                } satisfies GameActions}
                mode="multiplayer"
                isMyTurn={true}
                isFinished
                isSpreadHand={isSpreadHand}
                onToggleSpreadHand={toggleSpreadHand}
                deckCount={gameState.myCards['deck']?.length ?? 0}
                handCount={gameState.myCards['hand']?.length ?? 0}
                onRollDice={() => gameState.rollDice(BigInt(20))}
                onShowToast={showGameToast}
                onUndo={handleUndo}
                undoCount={undoStack.count}
                onEndTurn={() => {}}
              />
              <GameToastContainer />
              <PauseConsentToast
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                onRespondToPause={handleRespondToPause}
                onRespondToResume={handleRespondToResume}
              />
              <SpectatorHandRequestBanner gameId={gameId} myPlayer={gameState.myPlayer ?? null} />
              <CardChoicePromptContainer />
              <GameOverOverlay
                game={gameState.game}
                myPlayer={gameState.myPlayer}
                opponentPlayer={gameState.opponentPlayer}
                gameActions={gameState.gameActions}
                gameState={gameState}
                playAgainTriggered={playAgainTriggered}
                onPlayAgainHandled={() => setPlayAgainTriggered(false)}
                isForge={isForge}
                myDeckId={gameParams?.deckId}
              />
            </div>
          </div>
          {rightPanel}

          {/* Paragon drawer — self-hides when paragons list is empty. Rendered
              at the top level so it's a DOM sibling to the Konva canvas. */}
          <ParagonDrawer paragons={paragonEntries} />

          {/* Deck reload picker (available after game ends for rematch/practice) */}
          {isForge ? (
            <ForgeDeckPickerModal
              open={showReloadDeckPicker}
              onOpenChange={setShowReloadDeckPicker}
              onSelect={handleForgeReloadSelect}
            />
          ) : (
            <DeckPickerModal
              open={showReloadDeckPicker}
              onOpenChange={(open) => setShowReloadDeckPicker(open)}
              onSelect={async (deck) => {
                const result = await loadDeckForGame(deck.id);
                setShowReloadDeckPicker(false);
                setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: JSON.stringify(result.deckData), paragon: deck.paragon || '' });
              }}
            />
          )}
          <ForgeSwapErrorDialog error={forgeSwapError} onClose={() => setForgeSwapError(null)} />

          {/* Deck reload confirmation dialog */}
          {reloadDeckConfirm && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}>
              <div style={{
                background: 'rgba(14, 10, 6, 0.97)',
                border: '1px solid rgba(107, 78, 39, 0.3)',
                borderRadius: 8,
                padding: '20px 28px',
                maxWidth: 320,
                width: '100%',
                textAlign: 'center',
                boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
              }}>
                <p style={{
                  fontFamily: 'Georgia, serif',
                  color: '#e8d5a3',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}>
                  Clear all cards and load a new deck?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
                  <button
                    onClick={() => setReloadDeckConfirm(null)}
                    style={{
                      padding: '7px 18px',
                      background: 'transparent',
                      border: '1px solid rgba(107, 78, 39, 0.3)',
                      borderRadius: 4,
                      color: 'rgba(196, 149, 90, 0.6)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Georgia, serif',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      gameState.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData, reloadDeckConfirm.paragon);
                      setReloadDeckConfirm(null);
                    }}
                    style={{
                      padding: '7px 18px',
                      background: 'rgba(196, 149, 90, 0.15)',
                      border: '1px solid rgba(196, 149, 90, 0.45)',
                      borderRadius: 4,
                      color: '#e8d5a3',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily: 'Georgia, serif',
                      fontWeight: 600,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Load Deck
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
    // Fallback — canvas not ready
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100dvh', backgroundImage: gameBackground, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, height: 48 }}>
            <TurnIndicator
              lobbyPath={lobbyPath}
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              opponentConnectionStatus={gameState.opponentConnectionStatus}
              isMyTurn={false}
              onSetPhase={() => {}}
              onEndTurn={() => {}}
              isFinished
              winnerName={winnerName}
              onPlayAgain={opponentDisconnected ? undefined : () => setPlayAgainTriggered(true)}
              onBackToLobby={opponentDisconnected ? handleReturnToLobby : undefined}
              rematchPending={rematchPending}
              onCancelRematch={gameState.cancelRematch}
              myScore={gameState.soulsRescued.me}
              opponentScore={gameState.soulsRescued.opponent}
              timerDisplay={gameTimer.formatted}
              timerPaused={isSearchModalOpen}
              timerVisible={gameTimer.isTimerVisible}
              onRequestPause={handleRequestPause}
              onRequestResume={handleRequestResume}
              onCancelPauseRequest={handleCancelPauseRequest}
            />
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <GameOverOverlay
              game={gameState.game}
              myPlayer={gameState.myPlayer}
              opponentPlayer={gameState.opponentPlayer}
              gameActions={gameState.gameActions}
              gameState={gameState}
              isForge={isForge}
              myDeckId={gameParams?.deckId}
            />
          </div>
        </div>
        {rightPanel}
        {/* Paragon drawer — self-hides when paragons list is empty. */}
        <ParagonDrawer paragons={paragonEntries} />
      </div>
    );
  }

  // lifecycle === 'playing' — two-column layout: canvas + right panel (preview + chat)
  return (
    <div style={{
      display: 'flex', width: '100vw', height: '100dvh',
      backgroundImage: gameBackground, backgroundSize: 'cover', backgroundPosition: 'center',
      // Keep the board clear of the landscape notch on a phone.
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    }}>
      {/* Turn bar + Canvas + Toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* On compact touch the turn bar overlays the board instead of
            consuming a fixed 48px row (the compact layout profile's top
            gutter keeps board content clear of it). Scale is derived from
            container height, so giving those 48px back to the canvas is a
            ~14% board gain on a phone. Non-compact touch keeps the bar in
            its own row — no gutter exists to duck under it there. */}
        <div style={overlayTurnBar
          ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingTop: 'env(safe-area-inset-top)' }
          : { flexShrink: 0, height: 48 }}>
          <TurnIndicator
            lobbyPath={lobbyPath}
            game={gameState.game}
            myPlayer={gameState.myPlayer}
            opponentPlayer={gameState.opponentPlayer}
            opponentConnectionStatus={gameState.opponentConnectionStatus}
            isMyTurn={gameState.isMyTurn}
            pregameStep={pregameStep}
            onSetPhase={gameState.setPhase}
            onEndTurn={requestEndTurn}
            onConcede={gameState.resignGame}
            onRequestPriority={() => gameState.requestZoneSearch('action-priority')}
            hasPendingPriority={gameState.zoneSearchRequests.some(
              (r: any) => r.zone === 'action-priority' && r.status === 'pending' && r.requesterId === gameState.myPlayer?.id
            )}
            myScore={gameState.soulsRescued.me}
            opponentScore={gameState.soulsRescued.opponent}
            disconnectTimeoutFired={gameState.disconnectTimeoutFired}
            onClaimVictory={gameState.claimTimeoutVictory}
            timerDisplay={gameTimer.formatted}
            timerPaused={isSearchModalOpen}
            timerVisible={gameTimer.isTimerVisible}
            onRequestPause={handleRequestPause}
            onRequestResume={handleRequestResume}
            onCancelPauseRequest={handleCancelPauseRequest}
            myStops={gameState.myStops}
            holdPhase={gameState.holdPhase}
            holdDeadlineMicros={gameState.holdDeadlineMicros}
            onToggleStop={gameState.setTurnStop}
          />
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {gameId !== null && (
            <MultiplayerCanvas gameId={gameId} onLoadDeck={() => setShowReloadDeckPicker(true)} undoStack={undoStack} onSearchModalChange={setIsSearchModalOpen} isTimerVisible={gameTimer.isTimerVisible} onToggleTimer={gameTimer.toggleTimerVisibility} getImage={getImage} chatScale={chatScale} setChatScale={setChatScale} resetChatScale={resetChatScale} minChatScale={CHAT_MIN_SCALE} maxChatScale={CHAT_MAX_SCALE} chatStep={CHAT_STEP} forgeResolver={forgeResolver} compactLayout={compactTouchShell} />
          )}
          <ImageLoadingGate open={!imagesGateOpen} progress={imageLoadProgress} />
          {/* Quick action toolbar — floating above hand area */}
          <GameToolbar
            actions={{
              drawCard: () => gameState.drawCard(),
              drawMultiple: (n) => gameState.drawMultiple(BigInt(n)),
              moveCard: (id, zone, px, py) => gameState.moveCard(BigInt(id), zone, undefined, px, py),
              moveCardsBatch: (ids, zone) => gameState.moveCardsBatch(JSON.stringify(ids), zone),
              flipCard: (id) => gameState.flipCard(BigInt(id)),
              meekCard: (id) => gameState.meekCard(BigInt(id)),
              unmeekCard: (id) => gameState.unmeekCard(BigInt(id)),
              addCounter: (id, c) => gameState.addCounter(BigInt(id), c),
              removeCounter: (id, c) => gameState.removeCounter(BigInt(id), c),
              shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
              shuffleDeck: () => gameState.shuffleDeck(),
              setNote: (id, t) => gameState.setNote(BigInt(id), t),
              exchangeCards: (ids) => gameState.exchangeCards(JSON.stringify(ids)),
              moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
              moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
              randomHandToZone: (count, toZone, deckPosition) => gameState.randomHandToZone(count, toZone, deckPosition),
              randomReserveToZone: (count, toZone, deckPosition) => gameState.randomReserveToZone(count, toZone, deckPosition),
              reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
            } satisfies GameActions}
            mode="multiplayer"
            isMyTurn={gameState.isMyTurn}
            isTurnHeld={gameState.holdPhase !== ''}
            isSpreadHand={isSpreadHand}
            onToggleSpreadHand={toggleSpreadHand}
            deckCount={gameState.myCards['deck']?.length ?? 0}
            handCount={gameState.myCards['hand']?.length ?? 0}
            onRollDice={() => gameState.rollDice(BigInt(20))}
            onShowToast={showGameToast}
            onUndo={handleUndo}
            undoCount={undoStack.count}
            onEndTurn={requestEndTurn}
            onRequestPriority={() => gameState.requestZoneSearch('action-priority')}
            hasPendingPriority={gameState.zoneSearchRequests.some(
              (r: any) => r.zone === 'action-priority' && r.status === 'pending' && r.requesterId === gameState.myPlayer?.id
            )}
            onRequestInitiative={() => gameState.requestZoneSearch('initiative')}
            hasPendingInitiative={gameState.zoneSearchRequests.some(
              (r: any) => r.zone === 'initiative' && r.status === 'pending' && r.requesterId === gameState.myPlayer?.id
            )}
            onPassInitiative={() => {
              const pendingInit = gameState.zoneSearchRequests.find(
                (r: any) => r.zone === 'initiative' && r.status === 'pending' && r.targetPlayerId === gameState.myPlayer?.id
              );
              if (pendingInit) {
                gameState.approveZoneSearch(BigInt(pendingInit.id));
                showGameToast('Initiative granted');
                return;
              }
              gameState.passInitiative();
            }}
            onSendEmote={(kind) => gameState.sendEmote(kind)}
          />
          <EmoteOverlay emotes={gameState.emotes} myPlayerId={gameState.myPlayer?.id ?? null} />
          <GameToastContainer />
          <PauseConsentToast
            game={gameState.game}
            myPlayer={gameState.myPlayer}
            opponentPlayer={gameState.opponentPlayer}
            onRespondToPause={handleRespondToPause}
            onRespondToResume={handleRespondToResume}
          />
          <SpectatorHandRequestBanner gameId={gameId} myPlayer={gameState.myPlayer ?? null} />
          <CardChoicePromptContainer />
        </div>
      </div>

      {/* Right panel — preview on top, chat below */}
      {rightPanel}

      {/* Paragon drawer — self-hides when paragons list is empty. Rendered at
          the top level so it's a DOM sibling to the Konva canvas, not inside. */}
      <ParagonDrawer paragons={paragonEntries} />

      {/* Deck reload picker */}
      {isForge ? (
        <ForgeDeckPickerModal
          open={showReloadDeckPicker}
          onOpenChange={setShowReloadDeckPicker}
          onSelect={handleForgeReloadSelect}
        />
      ) : (
        <DeckPickerModal
          open={showReloadDeckPicker}
          onOpenChange={(open) => setShowReloadDeckPicker(open)}
          onSelect={async (deck) => {
            const result = await loadDeckForGame(deck.id);
            setShowReloadDeckPicker(false);
            setReloadDeckConfirm({ deckId: deck.id, deckName: deck.name, deckData: JSON.stringify(result.deckData), paragon: deck.paragon || '' });
          }}
        />
      )}
      <ForgeSwapErrorDialog error={forgeSwapError} onClose={() => setForgeSwapError(null)} />

      {/* Deck reload confirmation dialog */}
      {reloadDeckConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'rgba(14, 10, 6, 0.97)',
            border: '1px solid rgba(107, 78, 39, 0.3)',
            borderRadius: 8,
            padding: '20px 28px',
            maxWidth: 320,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
          }}>
            <p style={{
              fontFamily: 'Georgia, serif',
              color: '#e8d5a3',
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              Clear all cards and load a new deck?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button
                onClick={() => setReloadDeckConfirm(null)}
                style={{
                  padding: '7px 18px',
                  background: 'transparent',
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  borderRadius: 4,
                  color: 'rgba(196, 149, 90, 0.6)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  gameState.reloadDeck(reloadDeckConfirm.deckId, reloadDeckConfirm.deckData, reloadDeckConfirm.paragon);
                  setReloadDeckConfirm(null);
                }}
                style={{
                  padding: '7px 18px',
                  background: 'rgba(196, 149, 90, 0.15)',
                  border: '1px solid rgba(196, 149, 90, 0.45)',
                  borderRadius: 4,
                  color: '#e8d5a3',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                Load Deck
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End Turn during a pending soul surrender (spec §8) — the server's
          end_turn hook auto-returns as the ultimate fallback either way, but
          this stops an accidental End Turn from cutting off the pick. */}
      {showBattleEndTurnConfirm && (
        <div
          onClick={() => setShowBattleEndTurnConfirm(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'rgba(14, 10, 6, 0.97)',
              border: '1px solid rgba(107, 78, 39, 0.3)',
              borderRadius: 8,
              padding: '20px 28px',
              maxWidth: 320,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(196, 149, 90, 0.08)',
            }}
          >
            <p style={{
              fontFamily: 'Georgia, serif',
              color: '#e8d5a3',
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              A soul surrender is pending — end turn anyway?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button
                onClick={() => setShowBattleEndTurnConfirm(false)}
                style={{
                  padding: '7px 18px',
                  background: 'transparent',
                  border: '1px solid rgba(107, 78, 39, 0.3)',
                  borderRadius: 4,
                  color: 'rgba(196, 149, 90, 0.6)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowBattleEndTurnConfirm(false);
                  gameState.endTurn();
                }}
                style={{
                  padding: '7px 18px',
                  background: 'rgba(196, 149, 90, 0.15)',
                  border: '1px solid rgba(196, 149, 90, 0.45)',
                  borderRadius: 4,
                  color: '#e8d5a3',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                End Turn
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
