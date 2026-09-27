"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TrophyIcon } from "@/components/trophy-icon";
import { useRoundCountdown } from "@/components/ui/useRoundCountdown";
import { normalizeTournamentFormat } from "@/lib/formats";
import {
  buildLiveStandings,
  buildPairings,
  clockOffsetMs,
  findParticipants,
  formatAgo,
  pairingFor,
  roundPhase,
  tableLabel,
  type PublicParticipant,
  type PublicRoundView,
} from "@/lib/tournament/liveRound";
import { getPublicRoundView } from "./actions";

const POLL_MS = 10_000;
const storageKey = (code: string) => `live-round-name:${code}`;

type Tab = "pairings" | "standings";

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

// Podium tints mirror the public results page (app/tournaments/results/[id]).
// Only applied once the event has ended — a mid-event podium is a guess.
function podiumSurface(place: number): string {
  if (place === 1) return "bg-yellow-50 dark:bg-yellow-900/20";
  if (place === 2) return "bg-muted/60 dark:bg-muted/30";
  if (place === 3) return "bg-orange-50 dark:bg-orange-900/15";
  return "";
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function PlayerLine({
  player,
  score,
  won,
  lost,
  highlight,
}: {
  player: PublicParticipant | null;
  score: number | null;
  won: boolean;
  lost: boolean;
  highlight: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={`truncate text-sm ${
          won ? "font-semibold text-foreground" : lost ? "text-muted-foreground" : "text-foreground"
        } ${highlight ? "underline decoration-primary/60 underline-offset-4" : ""}`}
      >
        {player?.name ?? "—"}
      </span>
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {score ?? ""}
      </span>
    </div>
  );
}

export default function LiveRoundClient({
  code,
  initialView,
  pendingName,
}: {
  code: string;
  /** Null when the event exists but hasn't started; the page 404s otherwise. */
  initialView: PublicRoundView | null;
  pendingName: string | null;
}) {
  const [view, setView] = useState<PublicRoundView | null>(initialView);
  // Server clock minus this phone's clock. Every countdown adds it back so a
  // phone that's five minutes slow still shows the host's timer.
  const [offsetMs, setOffsetMs] = useState(() =>
    initialView ? clockOffsetMs(initialView.server_now, Date.now()) : 0,
  );
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("pairings");
  const [query, setQuery] = useState("");
  const seqRef = useRef(0);
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    const seq = ++seqRef.current;
    try {
      const res = await getPublicRoundView(code);
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setRefreshFailed(true);
        return;
      }
      const localNow = Date.now();
      if (res.view) {
        setView(res.view);
        setOffsetMs(clockOffsetMs(res.view.server_now, localNow));
      }
      // A null after we already had a view means the host removed the join
      // code mid-event. Keep the last round on screen rather than flipping
      // back to "hasn't started".
      setFetchedAt(localNow);
      setRefreshFailed(false);
    } catch {
      if (seq === seqRef.current) setRefreshFailed(true);
    } finally {
      inflightRef.current = false;
    }
  }, [code]);

  // Poll only while the tab is visible; refetch the moment it comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onWake = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [refresh]);

  // One-second tick for "Updated Xs ago".
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Remember the player's name per event so a reload lands on their table.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(code));
      if (saved) setQuery(saved);
    } catch {
      // Private mode / blocked storage: the input still works, it just forgets.
    }
  }, [code]);

  const updateQuery = (next: string) => {
    setQuery(next);
    try {
      if (next.trim()) localStorage.setItem(storageKey(code), next);
      else localStorage.removeItem(storageKey(code));
    } catch {
      // ignore
    }
  };

  const tournament = view?.tournament ?? null;
  const phase = view ? roundPhase(view) : null;
  const roundNumber =
    !tournament || !phase
      ? 0
      : phase.kind === "ended"
        ? (tournament.current_round ?? tournament.n_rounds ?? 0)
        : phase.round;

  const pairings = useMemo(
    () => (view ? buildPairings(view, roundNumber) : { matches: [], byes: [] }),
    [view, roundNumber],
  );
  const standings = useMemo(() => (view ? buildLiveStandings(view) : []), [view]);
  const candidates = useMemo(
    () => (view ? findParticipants(query, view.participants) : []),
    [view, query],
  );
  const me = candidates.length === 1 ? candidates[0] : null;
  const myPairing = me ? pairingFor(pairings, me.id) : null;
  const myStanding = me ? (standings.find((r) => r.participant.id === me.id) ?? null) : null;
  const dropped = view?.participants.filter((p) => p.dropped_out) ?? [];
  const seatsMode = tournament?.numbering_mode === "seats";
  const ended = phase?.kind === "ended";

  const roundLength = tournament?.round_length ?? 0;
  const countdown = useRoundCountdown(
    phase?.kind === "running" ? phase.startedAt : null,
    roundLength,
    offsetMs,
  );
  const showCountdown = phase?.kind === "running" && roundLength > 0;

  const agoLabel = refreshFailed
    ? "Couldn't refresh — retrying"
    : `Updated ${formatAgo(Math.max(0, (nowMs - fetchedAt) / 1000))}`;

  // ─── Not started ────────────────────────────────────────────────────
  if (!view || !tournament || !phase) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Live pairings &amp; standings
        </p>
        {pendingName && (
          <h1 className="mt-1 font-cinzel text-2xl font-bold text-foreground">{pendingName}</h1>
        )}
        <div className="mt-6 rounded-lg bg-card p-5">
          <p className="font-medium text-foreground">This event hasn&apos;t started yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pairings, the round timer and standings will appear here as soon as the host starts
            round 1. Keep this page open — it updates on its own.
          </p>
        </div>
        <p className="mt-3 text-xs text-muted-foreground" suppressHydrationWarning>
          {agoLabel}
        </p>
      </main>
    );
  }

  const roundLabel = ended
    ? "Final"
    : `Round ${roundNumber}${tournament.n_rounds ? ` of ${tournament.n_rounds}` : ""}`;

  const statusText =
    phase.kind === "ended"
      ? "The event has ended."
      : phase.kind === "waiting"
        ? "Pairings are posted — waiting for the host to start the round."
        : phase.kind === "complete"
          ? "Round complete — waiting for the next round."
          : countdown.isExpired
            ? "Time is up — finish your game."
            : "In progress";

  const countdownClass = countdown.isWarning
    ? "text-destructive"
    : countdown.isUrgent
      ? "text-amber-600 dark:text-amber-400"
      : "text-foreground";

  const format = normalizeTournamentFormat(tournament.deck_format);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6">
      {/* ─── Header ─── */}
      <header>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live
          </p>
          <p className="text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>
            {agoLabel}
          </p>
        </div>
        <h1 className="mt-1 font-cinzel text-xl font-bold leading-tight text-foreground sm:text-2xl">
          {tournament.name}
        </h1>
        {(tournament.category || format) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {tournament.category && <Chip>{tournament.category}</Chip>}
            {format && <Chip>{format}</Chip>}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {roundLabel}
            </p>
            <p className="mt-0.5 text-sm text-foreground">{statusText}</p>
          </div>
          {showCountdown && (
            <p
              className={`shrink-0 text-3xl font-semibold tabular-nums ${countdownClass}`}
              aria-live="off"
              suppressHydrationWarning
            >
              {countdown.isExpired ? "0:00" : countdown.timeString}
            </p>
          )}
        </div>

        {ended && tournament.results_published && (
          <Button asChild variant="success" className="mt-3 w-full sm:w-auto">
            <Link href={`/tournaments/results/${tournament.id}`}>Official results</Link>
          </Button>
        )}
      </header>

      {/* ─── Find your name (sticky under the top nav) ─── */}
      <div className="sticky top-16 z-20 -mx-4 mt-5 bg-background/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            placeholder="Find your name"
            aria-label="Find your name"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md bg-muted/70 px-3 py-2.5 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => updateQuery("")}
              aria-label="Clear"
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-lg leading-none text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ─── Pinned player ─── */}
      {me && myPairing && (
        <section
          aria-label="Your pairing"
          className="mt-2 rounded-lg bg-primary/10 p-4 dark:bg-primary/15"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">You</p>
          <p className="truncate font-medium text-foreground">{me.name}</p>

          {myPairing.kind === "match" && (
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {tableLabel(myPairing.tableNumber, seatsMode)}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  vs <span className="text-foreground">{myPairing.opponent?.name ?? "—"}</span>
                </p>
              </div>
              <div className="shrink-0 text-right">
                {myPairing.result === "pending" ? (
                  <p className="text-sm text-muted-foreground">No result yet</p>
                ) : (
                  <>
                    <p className="text-xl font-semibold tabular-nums text-foreground">
                      {myPairing.myScore}–{myPairing.theirScore}
                    </p>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {myPairing.result === "won" ? "Won" : myPairing.result === "lost" ? "Lost" : "Tie"}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
          {myPairing.kind === "bye" && (
            <p className="mt-3 text-sm text-foreground">
              Bye this round — no opponent, 3 match points.
            </p>
          )}
          {myPairing.kind === "none" && (
            <p className="mt-3 text-sm text-muted-foreground">
              {me.dropped_out ? "Dropped from the event." : "Not paired this round."}
            </p>
          )}

          {myStanding && (
            <p className="mt-3 text-sm tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{ordinal(myStanding.place)}</span>
              {" · "}
              {myStanding.mp} MP · {signed(myStanding.diff)} diff · {myStanding.wins}-
              {myStanding.losses}-{myStanding.ties}
            </p>
          )}
        </section>
      )}
      {query.trim() && candidates.length > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {candidates.length} players match — keep typing.
        </p>
      )}
      {query.trim() && candidates.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No player named &ldquo;{query.trim()}&rdquo; in this event.
        </p>
      )}

      {/* ─── Tabs ─── */}
      <div
        role="tablist"
        aria-label="View"
        className="mb-4 mt-5 flex w-full gap-1 rounded-lg bg-muted/50 p-1 sm:inline-flex sm:w-auto"
      >
        {(
          [
            ["pairings", "Pairings"],
            ["standings", "Standings"],
          ] as const
        ).map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`min-h-[40px] flex-1 rounded-md px-4 py-2 text-center text-sm transition-colors sm:flex-none ${
                active
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ─── Pairings ─── */}
      {tab === "pairings" && (
        <section aria-label={`Round ${roundNumber} pairings`}>
          {pairings.matches.length === 0 && pairings.byes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pairings posted for this round yet.</p>
          ) : (
            <div className="overflow-hidden rounded-lg bg-card">
              <div className="grid grid-cols-[3.5rem_1fr] gap-x-3 bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{seatsMode ? "Seats" : "Table"}</span>
                <span className="flex justify-between">
                  <span>Players</span>
                  <span>Souls</span>
                </span>
              </div>
              <ul>
                {pairings.matches.map((match, i) => {
                  const mine = !!me && (match.p1?.id === me.id || match.p2?.id === me.id);
                  const decided = match.outcome !== "pending" && match.outcome !== "tie";
                  return (
                    <li
                      key={match.id}
                      className={`grid grid-cols-[3.5rem_1fr] gap-x-3 px-3 py-2.5 ${
                        mine ? "bg-primary/10 dark:bg-primary/15" : i % 2 ? "bg-muted/20" : ""
                      }`}
                    >
                      <div className="self-center text-base font-semibold tabular-nums text-foreground">
                        {seatsMode
                          ? `${2 * match.tableNumber - 1}·${2 * match.tableNumber}`
                          : match.tableNumber}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <PlayerLine
                          player={match.p1}
                          score={match.score1}
                          won={match.outcome === "p1"}
                          lost={decided && match.outcome === "p2"}
                          highlight={!!me && match.p1?.id === me.id}
                        />
                        <PlayerLine
                          player={match.p2}
                          score={match.score2}
                          won={match.outcome === "p2"}
                          lost={decided && match.outcome === "p1"}
                          highlight={!!me && match.p2?.id === me.id}
                        />
                      </div>
                    </li>
                  );
                })}
                {pairings.byes.map((bye) => {
                  const mine = !!me && bye.participant?.id === me.id;
                  return (
                    <li
                      key={bye.id}
                      className={`grid grid-cols-[3.5rem_1fr] gap-x-3 px-3 py-2.5 ${
                        mine ? "bg-primary/10 dark:bg-primary/15" : "bg-muted/30"
                      }`}
                    >
                      <div className="self-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Bye
                      </div>
                      <div className="truncate text-sm text-foreground">
                        {bye.participant?.name ?? "—"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ─── Standings ─── */}
      {tab === "standings" && (
        <section aria-label="Standings">
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No standings yet.</p>
          ) : (
            <>
              {/* Phone: stacked rows. Same columns as the host's Standings tab. */}
              <ul className="space-y-1.5 sm:hidden">
                {standings.map((row) => {
                  const mine = me?.id === row.participant.id;
                  return (
                    <li
                      key={row.participant.id}
                      className={`rounded-lg px-3 py-2.5 ${
                        mine ? "bg-primary/10 dark:bg-primary/15" : `bg-card ${ended ? podiumSurface(row.place) : ""}`
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-7 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {row.place}
                        </span>
                        {ended && row.place <= 3 && (
                          <TrophyIcon place={row.place} className="h-4 w-4 shrink-0" />
                        )}
                        <span className="truncate text-sm text-foreground">{row.participant.name}</span>
                        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {row.mp} <span className="font-normal text-muted-foreground">MP</span>
                        </span>
                      </div>
                      <div className="mt-0.5 pl-9 text-xs tabular-nums text-muted-foreground">
                        {row.wins}-{row.losses}-{row.ties} · {signed(row.diff)} diff
                        {row.byes > 0 && ` · ${row.byes} bye${row.byes === 1 ? "" : "s"}`}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="hidden overflow-hidden rounded-lg bg-card sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">Rank</th>
                      <th className="px-4 py-2.5 text-left">Player</th>
                      <th className="px-4 py-2.5 text-center">W-L-T</th>
                      <th className="px-4 py-2.5 text-center">MP</th>
                      <th className="px-4 py-2.5 text-center">Diff</th>
                      <th className="px-4 py-2.5 text-center">Byes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row) => {
                      const mine = me?.id === row.participant.id;
                      return (
                        <tr
                          key={row.participant.id}
                          className={
                            mine ? "bg-primary/10 dark:bg-primary/15" : ended ? podiumSurface(row.place) : ""
                          }
                        >
                          <td className="px-4 py-2.5 font-semibold tabular-nums text-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              {ended && row.place <= 3 && (
                                <TrophyIcon place={row.place} className="h-4 w-4 shrink-0" />
                              )}
                              {row.place}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-foreground">{row.participant.name}</td>
                          <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">
                            {row.wins}-{row.losses}-{row.ties}
                          </td>
                          <td className="px-4 py-2.5 text-center font-semibold tabular-nums text-foreground">
                            {row.mp}
                          </td>
                          <td className="px-4 py-2.5 text-center tabular-nums text-foreground">
                            {signed(row.diff)}
                          </td>
                          <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">
                            {row.byes}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {dropped.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Dropped: {dropped.map((p) => p.name ?? "—").join(", ")}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
