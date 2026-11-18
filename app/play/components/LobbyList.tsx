'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type { Game, Player, Spectator } from '@/lib/spacetimedb/module_bindings/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Loader2 } from 'lucide-react';
import { normalizeDeckFormat } from '@/lib/deck-format';

interface LobbyListProps {
  selectedDeckId: string | null;
  selectedDeckFormat: string | null;
  joiningCode: string | null;
  onJoinGame: (code: string) => void;
  onWatchGame: (code: string) => void;
}

export function LobbyList({ selectedDeckId, selectedDeckFormat, joiningCode, onJoinGame, onWatchGame }: LobbyListProps) {
  // Follow existing codebase pattern: useSpacetimeDB() returns a context object,
  // not the connection directly. Use .getConnection() to get the actual DbConnection.
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;

  // Note: subscribeApplied is unreliable when the subscription returns no rows
  // (it may never flip to true). Don't gate rendering on it.
  const [games] = useTable(tables.Game) as [Game[], boolean];
  const [spectators] = useTable(tables.Spectator) as [Spectator[], boolean];
  // Only games with at least one connected player should be advertised. The
  // predicate lives on the hook (not just the subscription SQL) so a player
  // whose isConnected flips false drops from this view immediately, regardless
  // of what other subscriptions keep cached. This is what stops abandoned games
  // (host left, ghost connection, reaper not yet run) from lingering as
  // watchable "LIVE" zombies in the lobby.
  const [livePlayers] = useTable(
    tables.Player.where((p) => p.isConnected.eq(true)),
  ) as [Player[], boolean];
  const [now, setNow] = useState(Date.now());
  const [watchingCode, setWatchingCode] = useState<string | null>(null);
  const didSubscribe = useRef(false);

  // Subscribe to public waiting + playing games (so live games show up too),
  // plus spectators for live counts. Re-subscribe when connection changes
  // (e.g., after tab regains focus and WebSocket reconnects).
  useEffect(() => {
    if (!conn) {
      didSubscribe.current = false;
      return;
    }
    if (didSubscribe.current) return;
    didSubscribe.current = true;
    try {
      conn.subscriptionBuilder().subscribe([
        "SELECT * FROM game WHERE is_public = true AND status = 'waiting'",
        "SELECT * FROM game WHERE is_public = true AND status = 'pregame'",
        "SELECT * FROM game WHERE is_public = true AND status = 'playing'",
        "SELECT * FROM spectator",
      ]);
    } catch (e) {
      console.error('Lobby subscription failed:', e);
    }
  }, [conn]);

  // Update relative timestamps every 15 seconds + force refresh on tab focus
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Games with a live (connected) player. A game whose players have all
  // dropped leaves this set within a few seconds (the server flips isConnected
  // on websocket close), so it stops being listed long before the much slower
  // status -> 'finished' reaper would have hidden it.
  const liveGameIds = useMemo(
    () => new Set((livePlayers || []).map((p) => p.gameId)),
    [livePlayers],
  );

  // Client-side filter as safety net (subscription already filters server-side)
  // Sort oldest first. Games arrive live, so a new one appends at the bottom
  // instead of pushing every Join/Watch button down under the pointer, and the
  // game that has waited longest sits on top.
  const openGames = (games || [])
    .filter(
      (g) =>
        (g.status === 'waiting' || g.status === 'pregame' || g.status === 'playing') &&
        g.isPublic &&
        liveGameIds.has(g.id),
    )
    .sort((a, b) => {
      const aTime = Number(a.createdAt.microsSinceUnixEpoch);
      const bTime = Number(b.createdAt.microsSinceUnixEpoch);
      return aTime - bTime;
    });

  // Build a map of gameId -> spectator count for the watching indicator
  const spectatorCounts = useMemo(() => {
    const counts = new Map<bigint, number>();
    for (const s of spectators || []) {
      counts.set(s.gameId, (counts.get(s.gameId) ?? 0) + 1);
    }
    return counts;
  }, [spectators]);

  if (!conn) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Connecting to lobby...
      </div>
    );
  }

  if (openGames.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
          No games right now.
        </p>
      </div>
    );
  }

  const selectedFormat = selectedDeckId
    ? normalizeDeckFormat(selectedDeckFormat)
    : null;

  return (
    <div className="flex flex-col gap-2">
      {openGames.map((game) => {
        const createdAt = new Date(
          Number(game.createdAt.microsSinceUnixEpoch / BigInt(1000))
        );
        const minutesAgo = Math.max(
          0,
          Math.floor((now - createdAt.getTime()) / 60_000)
        );
        const timeLabel =
          minutesAgo < 1 ? 'Just now' : `${minutesAgo} min ago`;

        const gameFormat = normalizeDeckFormat(game.format);
        const isPlaying = game.status === 'playing' || game.status === 'pregame';
        const formatMismatch =
          !isPlaying && selectedFormat !== null && selectedFormat !== gameFormat;
        const joinDisabled =
          !selectedDeckId || joiningCode !== null || formatMismatch;
        const watchDisabled = watchingCode !== null;
        const watcherCount = spectatorCounts.get(game.id) ?? 0;

        return (
          <div
            key={game.code}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">
                  {game.createdByName || 'Unknown'}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {gameFormat}
                </span>
                {isPlaying && (
                  <Badge
                    variant="destructive"
                    className="shrink-0 gap-1 px-1.5 py-0 text-[10px] leading-4 tracking-wide"
                  >
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                    LIVE
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  · {timeLabel}
                </span>
                {isPlaying && watcherCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    · <Eye className="h-3 w-3" /> {watcherCount} watching
                  </span>
                )}
              </div>
              {game.lobbyMessage && (
                <p className="text-xs text-muted-foreground truncate">
                  {game.lobbyMessage}
                </p>
              )}
              {formatMismatch && (
                <p className="text-xs text-muted-foreground">
                  Select a {gameFormat} deck to join
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!isPlaying && (
                <Button
                  size="sm"
                  onClick={() => onJoinGame(game.code)}
                  disabled={joinDisabled}
                  title={
                    formatMismatch
                      ? `This game is ${gameFormat}. Your selected deck is ${selectedFormat}.`
                      : undefined
                  }
                >
                  {joiningCode === game.code ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Join'
                  )}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setWatchingCode(game.code);
                  onWatchGame(game.code);
                }}
                disabled={watchDisabled}
              >
                {watchingCode === game.code ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Watch'
                )}
              </Button>
            </div>
          </div>
        );
      })}
      {!selectedDeckId && (
        <p className="text-xs text-muted-foreground text-center mt-1">
          Select a deck to join — or watch any live game
        </p>
      )}
    </div>
  );
}
