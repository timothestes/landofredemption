'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSpacetimeConnection } from '@/app/play/hooks/useSpacetimeConnection';
import { SpacetimeConnectionResetWrapper } from '@/app/play/components/SpacetimeConnectionResetWrapper';
import ReconnectOnResume from '@/app/play/components/ReconnectOnResume';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { isCompactTouchViewport } from '@/app/play/lib/orientationGate';
import { useSpectatorGameState } from '@/app/play/hooks/useGameState';
import { SpectatorPregameView, SpectatorPregameCeremonyOverlay, GameCodeHeader } from '@/app/play/components/PregameScreen';
import { CardPreviewProvider } from '@/app/goldfish/state/CardPreviewContext';
import { EmoteOverlay } from '@/app/shared/components/EmoteOverlay';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type { ForgeGame } from '@/lib/spacetimedb/module_bindings/types';
import { authorizeForgeSeat, getForgePlayResolver } from '@/app/forge/lib/playDecks';
import type { ForgeResolverMap } from '@/app/play/utils/forgeResolver';
import { showGameToast, GameToastContainer } from '@/app/shared/components/GameToast';
import { useMultiplayerImagePreloader } from '@/app/play/hooks/useMultiplayerImagePreloader';
import { buildPrioritizedImageUrls } from '@/app/play/lib/multiplayerImageUrls';
import TurnIndicator from '@/app/play/components/TurnIndicator';
import { useGameTimer } from '../../hooks/useGameTimer';
import RightPanel from '@/app/play/components/RightPanel';
import { useChatScale } from '@/app/shared/hooks/useChatScale';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import TopNav from '@/components/top-nav';
import { DebugOverlay } from '@/app/play/components/DebugOverlay';
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';

// Konva requires browser APIs — lazy-load to avoid SSR issues
const MultiplayerCanvas = dynamic(
  () => import('@/app/play/components/MultiplayerCanvas'),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------
interface SpectatorClientProps {
  code: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Outer component — owns the connection builder and wraps the provider
// ---------------------------------------------------------------------------
export function SpectatorClient({ code, displayName }: SpectatorClientProps) {
  const { createBuilder, isConnected } = useSpacetimeConnection();

  // Mirror the player shell: the reset wrapper + ReconnectOnResume give the
  // spectator the same backgrounded-tab survival (visibility resume → ping →
  // reconnect with backoff). Without them a phone that locks its screen came
  // back to a silently frozen board.
  return (
    <SpacetimeConnectionResetWrapper createBuilder={createBuilder}>
      <ReconnectOnResume />
      <CardPreviewProvider storageKey="multiplayer-loupe-visible" defaultVisible>
        <SpectatorInner code={code} isConnected={isConnected} displayName={displayName} />
      </CardPreviewProvider>
    </SpacetimeConnectionResetWrapper>
  );
}

// ---------------------------------------------------------------------------
// Inner component — must live inside SpacetimeProvider to use SpacetimeDB hooks
// ---------------------------------------------------------------------------
type LifecycleState = 'joining' | 'watching' | 'error';

interface SpectatorInnerProps {
  code: string;
  isConnected: boolean;
  displayName: string;
}

function SpectatorInner({ code, isConnected, displayName }: SpectatorInnerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const isActive = spacetimeCtx?.isActive ?? false;
  const myIdentityHex: string | undefined = spacetimeCtx?.identity?.toHexString?.();
  const router = useRouter();

  const [lifecycle, setLifecycle] = useState<LifecycleState>('joining');

  // Same viewport measurement the player shell uses. Without an explicit
  // compactLayout prop the canvas falls back to container-height sniffing,
  // which left portrait phone spectators on the desktop profile (microfilm
  // strip) — the exact drift the player side fixed in wave 4.
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
  const compactTouchShell = isCompactTouchViewport(shellViewport.w, shellViewport.h, shellInputMode);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [phase1Applied, setPhase1Applied] = useState(false);
  const [joined, setJoined] = useState(false);
  const [forgeResolver, setForgeResolver] = useState<ForgeResolverMap | null>(null);
  // Game-over banner dismissal — spectators may keep reviewing the final board.
  const [resultDismissed, setResultDismissed] = useState(false);
  const didSubscribe = useRef(false);
  const didCallReducer = useRef(false);
  const wasWatching = useRef(false);
  // One-shot guard for the toast-then-redirect exits below: the effects re-run
  // on live data while the redirect timer is pending.
  const leavingRef = useRef(false);

  // Phase 1: Seed subscriptions for tables that don't auto-subscribe via
  // typed .where() queries (Game and CardCounter). Mirrors the player
  // client's phase-1 SQL subscription pattern in app/play/[code]/client.tsx.
  // Without this, `useTable(tables.Game)` returns empty rows and we can
  // never find the game by code.
  useEffect(() => {
    if ((!isConnected && !isActive) || !conn || didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder()
        .onApplied(() => setPhase1Applied(true))
        .subscribe([
          `SELECT * FROM game WHERE code = '${code}'`,
          `SELECT * FROM card_counter`,
          `SELECT * FROM forge_game`,
        ]);
    } catch (e) {
      console.error('Failed to subscribe (spectator phase 1):', e);
    }
  }, [isConnected, isActive, conn, code]);

  // Leave as spectator on unmount
  useEffect(() => {
    return () => {
      if (gameId !== null && conn) {
        conn.reducers.leaveAsSpectator({ gameId });
      }
    };
  }, [gameId, conn]);

  // Derive gameId and lifecycle from live game data
  const resolvedGameId = gameId ?? BigInt(0);
  const gameState = useSpectatorGameState(resolvedGameId, forgeResolver);

  // Forge marker rows — fed by the phase-1 `forge_game` subscription above.
  // A matching row means this is a private Forge playtest game whose
  // spectators must be authorized members.
  const [allForgeGames] = useTable(tables.ForgeGame) as [ForgeGame[], boolean];
  const isForgeGame = gameId !== null && allForgeGames.some((f) => f.gameId === gameId);

  // Board backdrop — Forge playtest games get a distinct background.
  const gameBackground = `url(/gameplay/${isForgeGame ? 'forge_background' : 'cave_background'}.png)`;

  // Resolve gameId by scanning the unfiltered `allGames` subscription — the
  // filtered `game` field is keyed by gameId, which we don't have yet.
  // Prefer non-finished rows in case the code was reused.
  useEffect(() => {
    const allGames = gameState.allGames ?? [];
    const game =
      allGames.find((g: any) => g.code === code && g.status !== 'finished') ??
      allGames.find((g: any) => g.code === code);
    if (!game) return;

    if (gameId === null) {
      setGameId(game.id);
    }

    // Only show the spectate view once the server has accepted our join —
    // subscription data alone must never grant a working view (a rejected
    // joinAsSpectator, e.g. a non-member on a Forge game, stays on 'error').
    if (!joined) return;

    // Spectators stay in 'watching' for the entire game including after
    // it finishes — the canvas keeps rendering the final board state so
    // viewers can review what happened.
    setLifecycle((prev) => (prev === 'error' ? prev : 'watching'));
  }, [gameState.allGames, code, gameId, joined]);

  // Join once the initial game subscription has applied. Forge playtest
  // games are members-only: mint a seat authorization for our connection
  // identity first (requireForge server action), and treat failure as
  // terminal. Non-forge games join directly; a bad code falls through to
  // the reducer, which rejects with 'No game found with that code'.
  useEffect(() => {
    if (!conn || !phase1Applied || didCallReducer.current) return;
    const allGames = gameState.allGames ?? [];
    const game =
      allGames.find((g: any) => g.code === code && g.status !== 'finished') ??
      allGames.find((g: any) => g.code === code);
    const gameIsForge = game ? allForgeGames.some((f) => f.gameId === game.id) : false;
    if (gameIsForge && !myIdentityHex) return; // wait for our identity, then re-run
    didCallReducer.current = true;

    const fail = (message: string) => {
      setErrorMessage(message);
      setLifecycle('error');
    };
    // joinAsSpectator returns a Promise that rejects asynchronously on
    // server-side SenderError. A synchronous try/catch won't catch those
    // rejections — attach .catch() instead.
    const join = () =>
      conn.reducers.joinAsSpectator({ code, displayName })
        .then(() => setJoined(true))
        .catch((e: unknown) => {
          fail(e instanceof Error ? e.message : 'Failed to join as spectator');
        });

    if (gameIsForge) {
      void (async () => {
        const auth = await authorizeForgeSeat({ code, identityHex: myIdentityHex as string })
          .catch(() => ({ ok: false as const, error: 'Could not authorize spectating — try again.' }));
        if (auth.ok === false) {
          fail(auth.error || 'Only Forge playtesters can spectate this game.');
          return;
        }
        join();
      })();
    } else {
      join();
    }
  }, [conn, phase1Applied, gameState.allGames, allForgeGames, myIdentityHex, code, displayName]);

  // Forge resolver — loads the viewer's RLS-granted card text/art map so a
  // member spectator sees granted card faces. Fails closed to an empty map
  // (opaque cards); non-members never reach the board at all.
  useEffect(() => {
    if (!isForgeGame || forgeResolver !== null) return;
    let cancelled = false;
    getForgePlayResolver()
      .then((entries) => {
        if (!cancelled) setForgeResolver(new Map(entries.map((e) => [e.cardId, e])));
      })
      .catch(() => {
        if (!cancelled) setForgeResolver(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [isForgeGame, forgeResolver]);

  // Detect kick: once we're watching, if our Spectator row disappears, redirect.
  useEffect(() => {
    if (lifecycle !== 'watching' || !gameId || !myIdentityHex) return;
    const isStillSpectator = gameState.spectators.some(
      (s: any) => s.identity?.toHexString?.() === myIdentityHex,
    );
    if (isStillSpectator) {
      wasWatching.current = true;
      return;
    }
    if (wasWatching.current && !leavingRef.current) {
      leavingRef.current = true;
      // Toast BEFORE navigating, and give it time to be read — the lobby page
      // mounts its own tree after replace(), so a toast fired here never
      // survives the navigation and the spectator was ejected with no
      // explanation at all.
      showGameToast('You were removed from this game');
      // replace, not push — a push leaves the dead spectate URL in history, and
      // the Android back button ping-pongs: back → remount → re-detect → push.
      window.setTimeout(() => router.replace('/play'), 1600);
    }
  }, [gameState.spectators, lifecycle, gameId, myIdentityHex, router]);

  // Detect host-abandoned lobby: when the host leaves a waiting/pregame game,
  // the server flips status to 'finished' (immediately for waiting, after the
  // 30s DisconnectTimeout for pregame). Without this redirect the spectator
  // would render the canvas over an empty game — TurnIndicator + cave with no
  // play to watch. playingStartedAtMicros stays 0n until the game actually
  // enters 'playing', so finished + 0n distinguishes abandonment from a real
  // game whose final board is worth reviewing.
  useEffect(() => {
    if (lifecycle !== 'watching') return;
    const game = gameState.game;
    if (!game || game.status !== 'finished') return;
    if ((game.playingStartedAtMicros ?? 0n) > 0n) return;
    if (leavingRef.current) return;
    leavingRef.current = true;
    showGameToast('Host left the lobby');
    // replace, not push — see the kicked-spectator redirect above. Delayed so
    // the toast is actually readable before the page goes away.
    window.setTimeout(() => router.replace('/play'), 1600);
  }, [gameState.game, lifecycle, router]);

  // Image preloader — mirrors player client but without the myDeckImageUrls
  // since spectators don't have a personal deck.
  const allImageUrls = useMemo(() => {
    return buildPrioritizedImageUrls(
      gameState.myCards,
      gameState.opponentCards,
      gameState.sharedCards ?? {},
      forgeResolver,
    );
  }, [gameState.myCards, gameState.opponentCards, gameState.sharedCards, forgeResolver]);

  const { getImage } = useMultiplayerImagePreloader(allImageUrls);

  // Chat/log font scale
  const { chatScale } = useChatScale();

  // Card preview — needed for unread tracking
  const { isLoupeVisible, toggleLoupe } = useCardPreview();

  // Tab toggles the preview pane (matches player-side hotkey in useGameHotkeys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      toggleLoupe();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleLoupe]);

  // Unread chat count — increments while panel is collapsed.
  // The player shell fixed both of these bugs; this shell kept its own copy and
  // was missed. (1) System rows (senderId 0n — "X started spectating", privacy
  // toggles) are not chat and must not light the badge; they render in the Log
  // tab. (2) Baselining at 0 counted the whole backlog as unread the moment the
  // subscription landed, and this component remounts on every reconnect — so a
  // flaky phone re-flagged the entire game history each time.
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const prevChatCountRef = useRef(0);
  const [chatSyncSettled, setChatSyncSettled] = useState(false);
  useEffect(() => {
    if (!gameState.isChatReady) return;
    const t = setTimeout(() => setChatSyncSettled(true), 1500);
    return () => clearTimeout(t);
  }, [gameState.isChatReady]);
  useEffect(() => {
    const current = gameState.chatMessages.reduce(
      (n, m) => (m.senderId !== 0n ? n + 1 : n),
      0,
    );
    const prev = prevChatCountRef.current;
    prevChatCountRef.current = current;
    if (!chatSyncSettled || current <= prev) return;
    if (isLoupeVisible) return;
    setUnreadChatCount((n) => n + (current - prev));
  }, [gameState.chatMessages, chatSyncSettled, isLoupeVisible]);

  // Clear unread when panel opens
  useEffect(() => {
    if (isLoupeVisible) {
      setUnreadChatCount(0);
    }
  }, [isLoupeVisible]);

  // Player name map for ChatPanel
  const playerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (gameState.myPlayer) map[gameState.myPlayer.id.toString()] = gameState.myPlayer.displayName;
    if (gameState.opponentPlayer) map[gameState.opponentPlayer.id.toString()] = gameState.opponentPlayer.displayName;
    return map;
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Build paragon entries for the ParagonDrawer overlay (0-2 entries).
  // Neither seat is the viewer, so both entries keep their real names.
  const paragonEntries = useMemo(() => {
    const players: Array<{ id: string; displayName: string; paragonName: string | null; isSelf: boolean }> = [];
    for (const p of [gameState.myPlayer, gameState.opponentPlayer]) {
      if (!p) continue;
      players.push({
        id: String(p.id),
        displayName: p.displayName,
        paragonName: p.paragon || null,
        isSelf: false,
      });
    }
    return buildParagonEntries({ players });
  }, [gameState.myPlayer, gameState.opponentPlayer]);

  // Game timer — anchored to server-recorded playingStartedAtMicros so
  // elapsed time survives navigating away and back. Matches player client.
  const gameTimer = useGameTimer(
    gameState.game?.playingStartedAtMicros ?? null,
    gameState.game?.pauseStartedAtMicros ?? 0n,
    gameState.game?.totalPausedMicros ?? 0n,
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (lifecycle === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">Error</p>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage ?? 'An unexpected error occurred.'}</p>
          <a
            href="/play"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to lobby
          </a>
        </div>
      </div>
    );
  }

  if (lifecycle === 'joining' || (!isConnected && !isActive)) {
    return (
      <>
        <TopNav />
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
          <div
            className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
            style={{ backgroundImage: gameBackground, backgroundPosition: 'center 70%' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
          />
          <div className="relative z-10 text-center">
            <p className="font-cinzel text-xl tracking-wide text-amber-200/90 mb-6">
              Joining as spectator…
            </p>
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-amber-200/50 border-t-transparent mx-auto" />
          </div>
          <DebugOverlay
            tone="amber"
            text={`code: ${code} · gameId: ${gameId === null ? 'none' : String(gameId)} · phase: ${lifecycle} · conn: ${isConnected ? 'live' : (isActive ? 'reconnecting' : 'down')}`}
          />
        </div>
      </>
    );
  }

  // lifecycle === 'watching' — render based on game.status
  const game = (gameState.allGames ?? []).find(
    (g: any) => g.code === code && g.status !== 'finished',
  ) ?? (gameState.allGames ?? []).find((g: any) => g.code === code);
  const status = game?.status;

  // REG Pre-Game Phase steps 2 and 3 run with status === 'playing', so the
  // board branch below already covers them; this only re-labels the header.
  const pregamePhase = gameState.game?.pregamePhase;
  const pregameStep: 'stars' | 'souls' | undefined =
    pregamePhase === 'stars' ? 'stars'
    : pregamePhase === 'souls' ? 'souls'
    : undefined;

  // Same Redeemed Soul rule as the players' own header and the canvas badges
  // — a raw zone length counted Guardian of Your Souls and dropped the Liner
  // double value, so watchers saw a different score than the players.
  const myScore = gameState.soulsRescued.me;
  const opponentScore = gameState.soulsRescued.opponent;

  // Game ended after real play (host-abandoned lobbies redirect above instead).
  // Players each get their own Victory/Defeat overlay; without this the
  // watcher's board just silently stopped moving.
  const gameFinishedAfterPlay =
    gameState.game?.status === 'finished' && (gameState.game?.playingStartedAtMicros ?? 0n) > 0n;

  if (gameId !== null && game && status === 'waiting') {
    return (
      <>
        <TopNav />
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black px-4">
          <div
            className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
            style={{ backgroundImage: gameBackground, backgroundPosition: 'center 70%' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
          />
          <div className="relative z-10 rounded-xl border border-amber-200/10 bg-black/60 backdrop-blur-sm p-6 sm:p-8 text-center max-w-md w-full">
            <div className="text-left mb-4">
              <button
                onClick={() => router.push('/play')}
                className="inline-flex items-center gap-1 text-xs text-amber-200/40 hover:text-amber-200/60 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Back to lobby
              </button>
            </div>

            <GameCodeHeader code={code} />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-[#c4955a]/30 bg-black/40 p-3 text-left">
                <p className="text-xs font-cinzel text-[#c4955a] truncate">
                  {gameState.myPlayer?.displayName ?? game.createdByName ?? 'Host'}
                </p>
                <p className="text-[10px] text-[#c4955a]/50 mt-1 font-cinzel tracking-wide">Ready</p>
              </div>
              <div className="rounded-lg border border-[#4a7ab5]/30 bg-black/40 p-3 text-left">
                <p className="text-xs font-cinzel text-[#4a7ab5]/60">Waiting</p>
                <div className="mt-2 flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4a7ab5]/50" />
                </div>
              </div>
            </div>

            {game.lobbyMessage && (
              <p className="mt-4 text-sm text-amber-200/60 italic">"{game.lobbyMessage}"</p>
            )}

            <p className="mt-5 text-[11px] uppercase tracking-[0.2em] text-amber-200/70 font-cinzel">
              Spectating
            </p>
          </div>
          <GameToastContainer />
        </div>
        <DebugOverlay
          tone="amber"
          text={`code: ${code} · gameId: ${gameId === null ? 'none' : String(gameId)} · phase: ${lifecycle}/${status} · conn: ${isConnected ? 'live' : (isActive ? 'reconnecting' : 'down')} · players: ${(gameState.allPlayers ?? []).length}/2 · spectators: ${gameState.spectators.length}`}
        />
      </>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100dvh',
        backgroundImage: gameBackground,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {gameId === null || !game ? (
          <>
            <div className="relative flex h-full items-center justify-center">
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
              />
              <div className="relative z-10 text-center">
                <p className="font-cinzel text-xl tracking-wide text-amber-200/90 mb-6">
                  Loading game state…
                </p>
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-amber-200/50 border-t-transparent mx-auto" />
              </div>
            </div>
            <DebugOverlay
              tone="amber"
              text={`code: ${code} · gameId: ${gameId === null ? 'none' : String(gameId)} · phase: ${lifecycle} · conn: ${isConnected ? 'live' : (isActive ? 'reconnecting' : 'down')} · games seen: ${(gameState.allGames ?? []).length}`}
            />

            <EmoteOverlay emotes={gameState.emotes} myPlayerId={null} />
          </>
        ) : status === 'pregame' && game.pregamePhase !== 'rolling' && game.pregamePhase !== 'choosing' && game.pregamePhase !== 'revealing' ? (
          // Pre-deal stage (deck selection / ready-up). No hands dealt yet,
          // so the canvas would be empty — show the simple status card.
          <div className="flex h-full items-center justify-center px-4">
            <SpectatorPregameView game={game} />
          </div>
        ) : (
          // status === 'playing' / 'finished', or pregame ceremony phase.
          // Render the full board so spectators see zones and hands; the
          // ceremony overlay floats on top during rolling/choosing/revealing.
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ flexShrink: 0, height: 48 }}>
                <TurnIndicator
                  readOnly
                  isFinished={gameState.game?.status === 'finished'}
                  game={gameState.game}
                  myPlayer={gameState.myPlayer}
                  opponentPlayer={gameState.opponentPlayer}
                  opponentConnectionStatus={gameState.opponentConnectionStatus}
                  isMyTurn={false}
                  pregameStep={pregameStep}
                  onSetPhase={() => {}}
                  onEndTurn={() => {}}
                  myScore={myScore}
                  opponentScore={opponentScore}
                  timerDisplay={gameTimer.formatted}
                  timerVisible={gameTimer.isTimerVisible}
                  holdPhase={gameState.holdPhase}
                  holdDeadlineMicros={gameState.holdDeadlineMicros}
                  onRequestHandReveal={
                    gameId !== null && conn
                      ? () => conn.reducers.requestSpectatorHandReveal({ gameId })
                      : undefined
                  }
                />
              </div>
              {/* Who is playing, what the score is, and whose turn it is — the
                  three things someone opens a stream to find out. The shared
                  bar drops all of it at phone widths, so in portrait a
                  spectator saw only "T1" and a phase chip. */}
              {compactTouchShell && (
                <div
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '3px 8px',
                    background: 'rgba(13, 9, 5, 0.92)',
                    borderBottom: '1px solid var(--gf-border, rgba(107,78,39,0.4))',
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    color: 'rgba(232, 213, 163, 0.85)',
                    minWidth: 0,
                  }}
                >
                  {[
                    { p: gameState.myPlayer, score: myScore },
                    { p: gameState.opponentPlayer, score: opponentScore },
                  ].map((side, i) => {
                    // `currentTurn` is a SEAT number (0/1), not a player id.
                    const isActiveTurn =
                      side.p != null && gameState.game?.currentTurn === side.p.seat;
                    return (
                      <span
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          minWidth: 0,
                          flex: '0 1 auto',
                        }}
                      >
                        {i === 1 && <span style={{ opacity: 0.4, marginRight: 4 }}>vs</span>}
                        {/* The turn marker has to survive name truncation. */}
                        {isActiveTurn && <span style={{ color: 'var(--gf-accent, #c4955a)' }}>▶</span>}
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 92,
                            fontWeight: isActiveTurn ? 700 : 400,
                            color: isActiveTurn ? '#e8d5a3' : 'inherit',
                          }}
                        >
                          {side.p?.displayName ?? (i === 0 ? 'Player 1' : 'Player 2')}
                        </span>
                        <span style={{ color: '#e8d5a3', fontWeight: 700 }}>{side.score}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <MultiplayerCanvas
                  gameId={gameId}
                  viewerKind="spectator"
                  getImage={getImage}
                  forgeResolver={forgeResolver}
                  compactLayout={compactTouchShell}
                />
                {status === 'pregame' && (
                  <SpectatorPregameCeremonyOverlay
                    game={game}
                    seat0Player={(gameState as any).seat0Player}
                    seat1Player={(gameState as any).seat1Player}
                  />
                )}
                {/* Emotes render for spectators too — they were only wired
                    into the pre-board loading branch before. */}
                <EmoteOverlay emotes={gameState.emotes} myPlayerId={null} />
                {/* showGameToast needs a mounted container on THIS page —
                    kick/host-left toasts fired into the void without one. */}
                <GameToastContainer />
                {gameFinishedAfterPlay && !resultDismissed && (
                  <SpectatorGameOverBanner
                    gameActions={gameState.gameActions}
                    seat0={gameState.myPlayer}
                    seat1={gameState.opponentPlayer}
                    seat0Score={myScore}
                    seat1Score={opponentScore}
                    onDismiss={() => setResultDismissed(true)}
                  />
                )}
              </div>
            </div>
            <RightPanel
              chatMessages={gameState.chatMessages}
              gameActions={gameState.gameActions}
              myPlayerId={BigInt(0)}
              onSendChat={gameState.sendChat}
              playerNames={playerNameMap}
              chatScale={chatScale}
              unreadChatCount={unreadChatCount}
              chatDisabled
            />
            {/* Paragon drawer — self-hides when paragons list is empty. Rendered
                as a DOM sibling to the Konva canvas, not inside. */}
            <ParagonDrawer paragons={paragonEntries} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game-over banner — players each get a Victory/Defeat overlay from
// GameOverOverlay, but the watcher's board just silently stopped moving.
// Outcome comes from the action log the same way GameOverOverlay derives it,
// phrased for a third party.
// ---------------------------------------------------------------------------
function deriveSpectatorResult(
  gameActions: any[],
  seat0: any,
  seat1: any,
): { headline: string; detail: string } {
  const nameOf = (id: unknown) =>
    seat0 && id === seat0.id ? seat0.displayName
    : seat1 && id === seat1.id ? seat1.displayName
    : 'A player';
  const winnerOver = (loserId: unknown) =>
    seat0 && loserId === seat0.id ? (seat1?.displayName ?? 'Their opponent')
    : seat1 && loserId === seat1.id ? (seat0?.displayName ?? 'Their opponent')
    : 'Their opponent';
  for (let i = gameActions.length - 1; i >= 0; i--) {
    const action = gameActions[i];
    const actionType: string = (action.actionType ?? '').toUpperCase();
    const actorId = action.playerId ?? action.actorId;
    if (actionType === 'WIN') {
      return { headline: `${nameOf(actorId)} wins`, detail: '' };
    }
    if (actionType === 'RESIGN') {
      return { headline: `${winnerOver(actorId)} wins`, detail: `${nameOf(actorId)} resigned` };
    }
    if (actionType === 'TIMEOUT') {
      return { headline: 'Game over', detail: 'A player disconnected' };
    }
  }
  return { headline: 'Game over', detail: '' };
}

function SpectatorGameOverBanner({
  gameActions,
  seat0,
  seat1,
  seat0Score,
  seat1Score,
  onDismiss,
}: {
  gameActions: any[];
  seat0: any;
  seat1: any;
  seat0Score: number;
  seat1Score: number;
  onDismiss: () => void;
}) {
  const { headline, detail } = deriveSpectatorResult(gameActions, seat0, seat1);
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center px-4"
      style={{ background: 'rgba(0, 0, 0, 0.55)' }}
    >
      <div className="w-full max-w-sm rounded-xl border border-amber-200/15 bg-black/85 px-6 py-7 text-center backdrop-blur-sm">
        <p className="font-cinzel text-[11px] uppercase tracking-[0.25em] text-amber-200/50">
          Game over
        </p>
        <p className="mt-3 font-cinzel text-xl text-amber-200/95">{headline}</p>
        {detail && <p className="mt-1 text-sm text-amber-200/55">{detail}</p>}
        <p className="mt-2 text-xs text-amber-200/40">
          Souls rescued · {seat0?.displayName ?? 'Player 1'} {seat0Score} — {seat1Score}{' '}
          {seat1?.displayName ?? 'Player 2'}
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <a
            href="/play"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to lobby
          </a>
          <button
            onClick={onDismiss}
            className="inline-flex min-h-[44px] items-center rounded-md border border-amber-200/25 px-4 py-2 text-sm text-amber-200/80 hover:bg-amber-200/10"
          >
            Review the board
          </button>
        </div>
      </div>
    </div>
  );
}
