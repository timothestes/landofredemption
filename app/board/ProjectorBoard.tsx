"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { BsPinAngleFill } from "react-icons/bs";
import { cn } from "@/lib/utils";
import { createClient } from "@/utils/supabase/client";
import { parseTournamentName } from "@/utils/tournament/displayName";
import { fetchActiveBoardData, type BoardTournament } from "./boardData";
import { BoardPanel } from "./BoardPanel";
import { useWakeLock } from "./useWakeLock";

const HIDDEN_KEY = "board:hidden-tournament-ids";
const THEMES = ["light", "dark", "jayden"] as const;

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-[repeat(auto-fit,minmax(20rem,1fr))]";
}

export function ProjectorBoard() {
  const [tournaments, setTournaments] = useState<BoardTournament[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showControls, setShowControls] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  useWakeLock();

  // Avoid hydration mismatch when highlighting the active theme.
  useEffect(() => setMounted(true), []);

  // Restore hidden set from localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      if (raw) setHidden(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  const refetch = useCallback(async () => {
    const data = await fetchActiveBoardData();
    setTournaments(data);
    setHasLoaded(true);
  }, []);

  // Initial fetch + realtime: refetch the whole active set on any change.
  useEffect(() => {
    refetch();
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // postgres_changes on RLS-protected tables only delivers rows the socket's
      // JWT can SELECT. Apply the host's token before subscribing — otherwise the
      // connection uses the anon key and every event is filtered out (the channel
      // still reports SUBSCRIBED, so the failure is silent).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
        if (cancelled) return;
      }
      channel = supabase
        .channel("projector-board")
        .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => refetch())
        .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => refetch())
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refetch]);

  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  };

  const visible = tournaments.filter((t) => !hidden.includes(t.id));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background p-4 text-foreground">
      {!hasLoaded ? (
        <div className="flex h-full w-full items-center justify-center">
          <p className="font-cinzel text-3xl text-muted-foreground sm:text-4xl">
            Loading…
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center">
          <p className="font-cinzel text-3xl text-muted-foreground sm:text-4xl">
            No active tournaments
          </p>
        </div>
      ) : (
        <div className={cn("grid h-full w-full auto-rows-fr gap-4", gridClassFor(visible.length))}>
          {visible.map((t) => (
            <BoardPanel key={t.id} tournament={t} />
          ))}
        </div>
      )}

      {/* Hide/show + theme control — unobtrusive, host-facing only. */}
      <div className="absolute right-3 top-3">
        <button
          onClick={() => setShowControls((s) => !s)}
          aria-label="Board settings"
          className="rounded-md border border-border bg-card p-1.5 text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <BsPinAngleFill className="h-3.5 w-3.5" />
        </button>
        {showControls && (
          <div className="absolute right-0 top-full mt-1 max-h-[60vh] w-64 overflow-auto rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg">
            {tournaments.length === 0 ? (
              <p className="p-2 text-muted-foreground">No tournaments</p>
            ) : (
              tournaments.map((t) => (
                <label key={t.id} className="flex items-center gap-2 p-1 text-foreground">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(t.id)}
                    onChange={() => toggleHidden(t.id)}
                  />
                  {/* The same words as the panel it shows or hides; a date does not fit in this width. */}
                  <span className="truncate" title={t.name}>
                    {parseTournamentName(t.name).title}
                  </span>
                </label>
              ))
            )}

            <div className="mt-1 border-t border-border pt-1">
              <p className="px-1 py-0.5 text-xs text-muted-foreground">Theme</p>
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "flex w-full items-center rounded px-2 py-1 text-left capitalize hover:bg-accent hover:text-accent-foreground",
                    mounted && theme === t
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
