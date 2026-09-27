"use client";

import { Card, Pagination } from "flowbite-react";
import { Dispatch, Fragment, ReactNode, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { recomputeTotalsFromHistory } from "../../lib/tournament/results";
import { gameScoreForMatch, differentialForMatch } from "../../lib/tournament/standingsScoring";
import {
  forfeitMatchWrite,
  forfeitSideForDrops,
  forfeitSideOf,
  matchOutcomeColumns,
} from "../../lib/tournament/dropForfeit";
import { buildStateFromSupabase } from "../../utils/tournament/stateAdapter";
import { reassignRoundTables } from "../../utils/tournament/reassignTables";
import MatchEditModal from "./match-edit";
import RepairPairingModal from "./RepairPairingModal";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Printer, Search, X } from "lucide-react";
import { printTournamentPairings, printMatchSlips } from "../../utils/printUtils";
import { printFinalStandingsFor } from "./StandingsTable";
import { Button } from "./button";
import ToastNotification from "./toast-notification";
import ConfirmationDialog from "./confirmation-dialog";
import InfoHint, { MP_ROUND_HINT, DIFF_ROUND_HINT } from "./InfoHint";
import { ScoreCell, SaveIndicator } from "./ScoreCell";
import { useScoreGrid } from "./useScoreGrid";
import { ScoreShortcutsButton, ScoreShortcutsDialog } from "./ScoreShortcutsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

/** Set once the host dismisses the "type scores straight into the table" hint. */
const KEYBOARD_HINT_DISMISSED_KEY = "rtt.scoreGrid.hintDismissed";

const formatDateTime = (timestamp: string | null) => {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

/** Case- and accent-insensitive comparison key for the Find player box. */
const normalizeName = (name: string) =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * MP and differential each player EARNED in this single match — NOT the
 * cumulative running total. Cumulative numbers live on the Standings tab,
 * which is the source of truth. Returns null when the match is unscored.
 * Uses the canonical per-match formula (see standingsScoring.ts).
 */
const perRoundScores = (match: any, maxScore: number) => {
  if (match.player1_score === null || match.player2_score === null) return null;
  const sc = {
    player1_id: match.player1_id.id,
    player2_id: match.player2_id.id,
    player1_score: match.player1_score,
    player2_score: match.player2_score,
    player1_forfeit: match.player1_forfeit,
    player2_forfeit: match.player2_forfeit,
  };
  return {
    p1Mp: gameScoreForMatch(sc.player1_id, sc, maxScore),
    p2Mp: gameScoreForMatch(sc.player2_id, sc, maxScore),
    p1Diff: differentialForMatch(sc.player1_id, sc),
    p2Diff: differentialForMatch(sc.player2_id, sc),
  };
};

/** Result-column label for a forfeited match (its stored souls are 0–0). */
const forfeitLabel = (match: any): string | null => {
  const side = forfeitSideOf(match);
  if (!side) return null;
  if (side === "both") return "Double forfeit";
  return `Forfeit · ${side === "player1" ? match.player1_id.name : match.player2_id.name}`;
};

interface TournamentRoundsProps {
  tournamentId: string;
  isActive: boolean;
  onTournamentEnd?: () => void | Promise<void>;
  /** Fired only when ending the FINAL round completes the tournament (not on
   * every round end). Used to auto-switch to the Standings tab. */
  onTournamentEnded?: () => void;
  onRoundActiveChange?: (
    isActive: boolean,
    roundStartTime: string | null
  ) => void;
  roundInfo?: RoundInfo;
  setLatestRound: Dispatch<SetStateAction<any>>;
  createPairing: (round: number) => void;
  matchErrorIndex: any;
  setMatchErrorIndex: Dispatch<SetStateAction<any>>;
  activeTab: number;
  tournamentName?: string | null;
  isHost?: boolean;
  onRepairCompleted?: () => void;
  /** Bumped by the page after a re-pair RPC succeeds to force matches/byes
   * to re-fetch. The default deps ([currentPage, tournamentId]) don't change
   * when only the row contents change. */
  matchesRefreshNonce?: number;
  /** Called after End Round writes the next round's pairings so the page can
   * bump its pairingsRefreshNonce, forcing this component (and Standings) to
   * pick up the freshly-staged round on the next render. */
  onRoundEnded?: () => void | Promise<void>;
  /** Host admin menu (re-pair / end tournament). Rendered left-justified in
   * the round-control row. Lives in the page so its actions stay wired to the
   * page's dialog state; passed in as a node to avoid threading handlers. */
  adminMenu?: ReactNode;
  /** Fired after a result is entered/cleared so the page can refresh its
   * re-pair gating (scoredCurrentRoundMatches). Without this the page's gate
   * is stale and "Regenerate pairings" stays wrongly enabled. */
  onMatchesChanged?: () => void;
  /** Fired after a round is started. Starting a round makes that round's bye
   * score (Option C: byes count once their round has started), so the page
   * must refresh participants + bump the standings nonce to reflect it. */
  onRoundStarted?: () => void;
}

interface TournamentInfo {
  id: string | null;
  n_rounds: number | null;
  current_round: number | null;
  has_ended: boolean;
  max_score: number | null;
  starting_table_number: number | null;
  name: string | null;
  numbering_mode: string | null;
}

interface RoundInfo {
  started_at: string | null;
  ended_at: string | null;
}

interface ErrorState {
  message: string | null;
  type: "fetch" | "update" | null;
}

export default function TournamentRounds({
  tournamentId,
  isActive,
  onTournamentEnd,
  onTournamentEnded,
  onRoundActiveChange,
  setLatestRound,
  createPairing,
  matchErrorIndex,
  setMatchErrorIndex,
  activeTab,
  tournamentName,
  isHost = false,
  onRepairCompleted,
  matchesRefreshNonce,
  onRoundEnded,
  adminMenu,
  onMatchesChanged,
  onRoundStarted,
}: TournamentRoundsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>({
    id: null,
    n_rounds: null,
    current_round: null,
    has_ended: false,
    max_score: null,
    starting_table_number: 1,
    name: tournamentName || null,
    numbering_mode: null,
  });
  // Tracks whether we've completed the initial tournament fetch and synced
  // currentPage to tournamentInfo.current_round. Used as a render gate so the
  // panel never renders with currentPage=1 while the tournament's true
  // current_round is 2+ (which would flash "Round 1 of 3" with Round 1's dates
  // for one frame before the second fetch kicks in).
  const [hasInitialized, setHasInitialized] = useState(false);
  const client = createClient();
  const [error, setError] = useState<ErrorState>({ message: null, type: null });
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(tournamentInfo.current_round || 1);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [isRoundCompleted, setIsRoundCompleted] = useState(false);
  // Monotonic id for round-info fetches. fetchTournamentAndRoundInfo is async
  // and fires on both tab-activation and page navigation; without this guard an
  // out-of-order response for a *different* round can clobber isRoundCompleted/
  // roundInfo/isRoundActive — e.g. a completed round's is_completed=true landing
  // on the current round's view, surfacing the repair UI on a round that was
  // never completed. Only the latest request applies its results.
  const latestRoundFetch = useRef(0);
  /** Same guard for the matches/byes fetch — see fetchCurrentRoundData. */
  const latestMatchesFetch = useRef(0);
  const [roundInfo, setRoundInfo] = useState<RoundInfo>({
    started_at: null,
    ended_at: null,
  });
  const [matches, setMatches] = useState<any[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [byes, setByes] = useState<any[]>([]);
  const [matchEnding, setMatchEnding] = useState(false);
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [repairMode, setRepairMode] = useState(false);
  const [repairSourceMatch, setRepairSourceMatch] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    show: boolean;
    type: "success" | "error" | "warning" | "info";
  }>({ message: "", show: false, type: "warning" });
  const [endRoundConfirmOpen, setEndRoundConfirmOpen] = useState(false);

  interface MatchEditRow {
    id: string;
    old_player1_score: number;
    old_player2_score: number;
    new_player1_score: number;
    new_player2_score: number;
    edited_at: string;
    reason: string | null;
  }
  const [matchEditsByMatch, setMatchEditsByMatch] = useState<Record<string, MatchEditRow[]>>({});

  const showToast = useCallback(
    (
      message: string,
      type: "success" | "error" | "warning" | "info" = "warning"
    ) => {
      setToast({ message, show: true, type });
    },
    []
  );

  const fetchMatchEdits = useCallback(async () => {
    if (!tournamentInfo.id || !isHost) return;
    const { data } = await client
      .from("match_edits")
      .select("id, match_id, old_player1_score, old_player2_score, new_player1_score, new_player2_score, edited_at, reason")
      .eq("tournament_id", tournamentInfo.id)
      .order("edited_at", { ascending: false });
    const grouped: Record<string, MatchEditRow[]> = {};
    for (const e of (data ?? [])) {
      const row = e as any;
      (grouped[row.match_id] ??= []).push({
        id: row.id,
        old_player1_score: row.old_player1_score,
        old_player2_score: row.old_player2_score,
        new_player1_score: row.new_player1_score,
        new_player2_score: row.new_player2_score,
        edited_at: row.edited_at,
        reason: row.reason,
      });
    }
    setMatchEditsByMatch(grouped);
  }, [tournamentInfo.id, isHost]);

  useEffect(() => {
    fetchMatchEdits();
  }, [fetchMatchEdits]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isActive) {
      fetchTournamentAndRoundInfo();
    }
  }, [activeTab, isActive]);

  const fetchTournamentAndRoundInfo = useCallback(async () => {
    if (!tournamentId) return;

    const seq = ++latestRoundFetch.current;
    setIsLoading(true);
    setError({ message: null, type: null });
    // Clear stale round dates before the fetch resolves. Otherwise switching
    // tabs (or the initial currentPage=1 → current_round transition) flashes
    // the previous round's started_at/ended_at for a frame before the new
    // round's row arrives.
    setRoundInfo({ started_at: null, ended_at: null });

    try {
      const [tournamentResult, roundResult] = await Promise.all([
        client
          .from("tournaments")
          .select("id, n_rounds, current_round, has_ended, max_score, starting_table_number, name, numbering_mode")
          .eq("id", tournamentId)
          .single(),
        client
          .from("rounds")
          .select("started_at, ended_at, is_completed")
          .eq("tournament_id", tournamentId)
          .eq("round_number", currentPage)
          .maybeSingle()
      ]);

      // A newer fetch (page navigation / tab switch) superseded this one —
      // discard its results so we never apply a different round's state.
      if (seq !== latestRoundFetch.current) return;

      if (tournamentResult.error) throw tournamentResult.error;
      if (roundResult.error) throw roundResult.error;

      const tournamentData = tournamentResult.data;
      const roundData = roundResult.data;

      setTournamentInfo(tournamentData);
      setRoundInfo({
        started_at: roundData?.started_at || null,
        ended_at: roundData?.ended_at || null,
      });

      const shouldBeActive = !!(
        roundData &&
        !roundData.is_completed &&
        !tournamentData.has_ended &&
        roundData.started_at &&
        !roundData.ended_at
      );

      setIsRoundActive(shouldBeActive);
      setIsRoundCompleted(!!(roundData?.is_completed));
      
      if (shouldBeActive) {
        await fetchCurrentRoundData();
      }
    } catch (err) {
      if (seq !== latestRoundFetch.current) return;
      setError({
        message: "Failed to fetch tournament and round information",
        type: "fetch",
      });
      console.error("Error fetching data:", err);
    } finally {
      // Only the latest fetch owns the loading flag; a superseded one must not
      // flip it off while the current request is still in flight.
      if (seq === latestRoundFetch.current) setIsLoading(false);
    }
  }, [tournamentId, currentPage]);

  useEffect(() => {
    if (isActive) {
      onRoundActiveChange?.(isRoundActive, roundInfo.started_at);
    }
  }, [isRoundActive, isActive, onRoundActiveChange, roundInfo.started_at]);

  useEffect(() => {
    if (tournamentInfo.current_round && !hasInitialized) {
      // Keep isLoading true through the currentPage flip — without this, the
      // brief window between the first fetch finishing (with currentPage=1's
      // data) and the second fetch starting (for the correct current_round)
      // renders stale round data for one frame. The second fetch fires
      // automatically because fetchTournamentAndRoundInfo's deps include
      // currentPage.
      //
      // Only raise isLoading when currentPage will ACTUALLY change. At round 1,
      // current_round already equals currentPage (1), so setCurrentPage is a
      // no-op, no second fetch fires, and a spurious setIsLoading(true) here
      // would never be cleared — an infinite spinner right after starting.
      if (tournamentInfo.current_round !== currentPage) {
        setIsLoading(true);
        setCurrentPage(tournamentInfo.current_round);
      }
      setHasInitialized(true);
    }
  }, [tournamentInfo, hasInitialized]);

  useEffect(() => {
    if (isActive) {
      fetchTournamentAndRoundInfo();
    }
  }, [fetchTournamentAndRoundInfo, isActive, tournamentName]);

  const onPageChange = (page: number) => {
    if (page <= (tournamentInfo.current_round || 1)) {
      setCurrentPage(page);
      setMatchErrorIndex([]);
    }
  };

  const handleStartRound = async () => {
    try {
      const now = new Date().toISOString();
      // The rounds row is pre-created when pairings are generated (see
      // ensureRoundRow in pairingUtilsV2). Upsert handles legacy tournaments
      // started before that change.
      const { error: roundError } = await client.from("rounds").upsert(
        {
          tournament_id: tournamentId,
          round_number: currentPage,
          started_at: now,
        },
        { onConflict: "tournament_id,round_number" },
      );

      if (roundError) throw roundError;

      // A bye for this round only scores once the round has started (Option C).
      // Recompute now so the bye holder's match_points include their +3 the
      // moment the round goes live, keeping MP consistent with the W-L-T /
      // Byes columns (which gate on started rounds). Best-effort: a failure
      // here shouldn't block starting the round.
      const { error: recomputeError } = await client.rpc(
        "recompute_participant_totals",
        { p_tournament_id: tournamentId },
      );
      if (recomputeError) console.error("recompute on start round failed:", recomputeError);

      setRoundInfo({
        started_at: now,
        ended_at: null,
      });

      setIsRoundActive(true);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: now }));
      onRoundActiveChange?.(true, now);
      onRoundStarted?.();

      setMatchLoading(true);
    } catch (error) {
      console.error("Error starting round:", error);
    }
  };

  const fetchCurrentRoundData = async () => {
    // Sequence guard, mirroring fetchTournamentAndRoundInfo's. Entering a round
    // from the keyboard fires one refetch per saved match, so a dozen of these
    // can be in flight at once; without this the last RESPONSE wins rather than
    // the last REQUEST, and an early, mostly-unscored snapshot can clobber the
    // current one — which then makes End Round reject a fully-scored round.
    const seq = ++latestMatchesFetch.current;

    const { data, error } = await client
      .from("matches")
      .select(
        "id, match_order, table_number, player1_pin_overridden, player2_pin_overridden, player1_match_points, player2_match_points, differential, differential2, player1_id:participants!matches_player1_id_fkey(name,id,assigned_seat), player2_id:participants!matches_player2_id_fkey(name,id,assigned_seat), player1_score, player2_score, player1_forfeit, player2_forfeit"
      )
      .eq("tournament_id", tournamentId)
      .eq("round", currentPage)
      .order("table_number", { ascending: true, nullsFirst: true })
      .order("match_order", { ascending: true });

    if (seq !== latestMatchesFetch.current) return;
    if (error) console.log(error);
    setMatches(data || []);

    const { data: byeData, error: byeError } = await client
      .from("byes")
      .select("id, participant_id:participants(id, name), match_points, differential")
      .eq("tournament_id", tournamentId)
      .eq("round_number", currentPage)
      .order("id", { ascending: true });

    if (seq !== latestMatchesFetch.current) return;
    if (byeError) console.log(byeError);
    setByes(byeData);
  };

  // Used as the post-save callback for the score editors: refresh this
  // component's local match rows AND notify the page so its re-pair gating
  // (scoredCurrentRoundMatches) stays in sync. Deliberately NOT used by the
  // deps-effect below — the page bumps matchesRefreshNonce, and notifying from
  // a nonce-driven refetch would loop.
  const refreshMatchesAndNotify = async () => {
    await fetchCurrentRoundData();
    onMatchesChanged?.();
  };

  useEffect(() => {
    if (!tournamentId) return;
    fetchCurrentRoundData();
  }, [currentPage, tournamentId, matchesRefreshNonce]);

  const handleEndRound = useCallback(async () => {
    const client = createClient();

    let matchErrorIndexArr = [];

    // A player who dropped mid-round forfeits their unscored match. Scored
    // per algorithm.md via the shared helper (forfeiter 0 MP / −5, opponent
    // 3 MP / 0) — the same write the score modal's Forfeit button makes.
    for (const match of matches) {
      if (match.player1_score !== null && match.player2_score !== null) continue;
      const [{ data: p1Status }, { data: p2Status }] = await Promise.all([
        client.from("participants").select("dropped_out").eq("id", match.player1_id.id).single(),
        client.from("participants").select("dropped_out").eq("id", match.player2_id.id).single(),
      ]);
      const side = forfeitSideForDrops(!!p1Status?.dropped_out, !!p2Status?.dropped_out);
      if (side) {
        const write = forfeitMatchWrite(side, match.player1_id.id, match.player2_id.id);
        Object.assign(match, write);
        await client.from("matches").update(write).eq("id", match.id);
      }
    }

    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(matchErrorIndex);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      showToast("Please add scores to all matches.", "warning");
      return;
    }

    setMatchEnding(true);

    try {
      const now = new Date().toISOString();

      // Persist is_tie + winner_id on each match row so buildStateFromSupabase
      // can derive per-player outcomes. (player1_score / player2_score and the
      // per-row match_points + differential snapshots are already written by
      // the score-input UI in components/ui/match-edit.tsx — we don't touch
      // those denormalized snapshots here.)
      for (const match of matches) {
        // Forfeit-aware: a forfeit's 0–0 souls must not be written as a tie.
        const { error: matchUpdateError } = await client
          .from("matches")
          .update(matchOutcomeColumns(match, match.player1_id.id, match.player2_id.id))
          .eq("id", match.id);
        if (matchUpdateError) throw matchUpdateError;
      }

      // Recompute participant totals from full match + bye history.
      // This is the load-bearing fix for the double-count bug: totals are
      // always derived from history, never incremented. Editing a result and
      // re-running this yields the correct total regardless of prior writes.
      // Byes are accounted for via state.byes inside recomputeTotalsFromHistory,
      // so no separate bye participants update is needed.
      const state = await buildStateFromSupabase(client, tournamentId);
      if (state) {
        const affectedIds = new Set<string>();
        for (const m of matches) {
          if (m.player1_id?.id) affectedIds.add(m.player1_id.id);
          if (m.player2_id?.id) affectedIds.add(m.player2_id.id);
        }
        if (byes && byes.length > 0) {
          for (const bye of byes) {
            if (bye.participant_id?.id) affectedIds.add(bye.participant_id.id);
          }
        }
        for (const pid of affectedIds) {
          const totals = recomputeTotalsFromHistory(pid, state);
          const { error: participantUpdateError } = await client
            .from("participants")
            .update({
              match_points: totals.gameScore,
              differential: totals.lostSoulScore,
            })
            .eq("id", pid);
          if (participantUpdateError) console.log(participantUpdateError);
        }
      }

      const { error: roundError, data: roundData } = await client
        .from("rounds")
        .update({
          ended_at: now,
          is_completed: true,
        })
        .eq("tournament_id", tournamentId)
        .eq("round_number", currentPage);

      if (roundError) throw roundError;

      if (tournamentInfo.current_round === tournamentInfo.n_rounds) {
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            has_ended: true,
            ended_at: now,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;

        setTournamentInfo((prev) => ({
          ...prev,
          has_ended: true,
        }));

        // Tournament is now complete — surface the final results.
        onTournamentEnded?.();
      } else {
        await createPairing(currentPage + 1);

        // createPairing inserts the next round's bye row, but the
        // recomputeTotalsFromHistory loop above ran BEFORE that insert and so
        // didn't award the bye recipient their +3 MP. Call the recompute RPC
        // now so participants.match_points reflects the staged bye before any
        // Standings/Rounds reader fires. (RPC is host-only; handleEndRound
        // already runs only on the host's machine, so the auth check passes.)
        const { error: recomputeError } = await client.rpc(
          "recompute_participant_totals",
          { p_tournament_id: tournamentId },
        );
        if (recomputeError) console.log(recomputeError);

        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: (tournamentInfo.current_round || 0) + 1,
          })
          .eq("id", tournamentId);

        if (tournamentError) throw tournamentError;
      }

      // Refresh parent tournament state BEFORE updating local state so the
      // header pill (which reads from the parent's `tournament`) reflects the
      // new current_round / has_ended before we toggle our own round-active
      // flag and re-render. Awaiting the parent's refetch closes the desync
      // window that previously made the title-row badge lag the round panel.
      await onTournamentEnd?.();

      // Bump the page's pairings refresh nonce so Standings and any
      // sibling components that read matches/byes pick up the new round's
      // pairings + bye row. The local fetchCurrentRoundData useEffect handles
      // this component's own matches via the currentPage bump below, but
      // sibling state (e.g. page-level scoredCurrentRoundMatches feeding the
      // header menu) needs an explicit kick.
      await onRoundEnded?.();

      setRoundInfo((prev) => ({
        ...prev,
        ended_at: now,
      }));
      setIsRoundActive(false);
      setLatestRound((prev) => ({ round_number: currentPage, started_at: null }));
      setMatchEnding(false);

      if (currentPage < tournamentInfo.n_rounds) {
        setCurrentPage(currentPage + 1);
      }
    } catch (error) {
      console.error("Error ending round:", error);
      setMatchEnding(false);
    }
  }, [matches, tournamentInfo, byes]);

  const handleRepairClick = (match: any, isPlayer2 = false) => {
    if (repairMode) {
      if (repairSourceMatch.isBye) {
        handleSwapPlayerWithBye(match, isPlayer2, repairSourceMatch.byeId);
      } else {
        handleSwapPlayers(repairSourceMatch.match, match, repairSourceMatch.isPlayer2, isPlayer2);
      }
      setRepairMode(false);
      setRepairSourceMatch(null);
    } else {
      setRepairMode(true);
      setRepairSourceMatch({ match, isPlayer2 });
    }
  };

  const handleByeRepairClick = (bye: any) => {
    if (repairMode) {
      if (repairSourceMatch.isBye) {
        handleSwapPlayersWithBye(repairSourceMatch.byeId, bye.id);
      } else {
        handleSwapPlayerWithBye(repairSourceMatch.match, repairSourceMatch.isPlayer2, bye.id);
      }
      setRepairMode(false);
      setRepairSourceMatch(null);
    } else {
      setRepairMode(true);
      setRepairSourceMatch({ isBye: true, byeId: bye.id });
    }
  };

  const handleSwapPlayers = async (sourceMatch: any, targetMatch: any, isSourcePlayer2: boolean, isTargetPlayer2: boolean) => {
    setIsLoading(true);
    try {
      if (sourceMatch.id !== targetMatch.id) {
        const sourcePlayerId = isSourcePlayer2 ? sourceMatch.player2_id.id : sourceMatch.player1_id.id;
        const sourcePlayerMatchPoints = isSourcePlayer2 ? sourceMatch.player2_match_points : sourceMatch.player1_match_points;
        const sourceDifferential = isSourcePlayer2 ? sourceMatch.differential2 : sourceMatch.differential;
        
        const targetPlayerId = isTargetPlayer2 ? targetMatch.player2_id.id : targetMatch.player1_id.id;
        const targetPlayerMatchPoints = isTargetPlayer2 ? targetMatch.player2_match_points : targetMatch.player1_match_points;
        const targetDifferential = isTargetPlayer2 ? targetMatch.differential2 : targetMatch.differential;
        
        if (isSourcePlayer2) {
          await client.from("matches").update({
            player2_id: targetPlayerId,
            player2_match_points: targetPlayerMatchPoints,
            differential2: targetDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", sourceMatch.id);
        } else {
          await client.from("matches").update({
            player1_id: targetPlayerId,
            player1_match_points: targetPlayerMatchPoints,
            differential: targetDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", sourceMatch.id);
        }
        
        if (isTargetPlayer2) {
          await client.from("matches").update({
            player2_id: sourcePlayerId,
            player2_match_points: sourcePlayerMatchPoints,
            differential2: sourceDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", targetMatch.id);
        } else {
          await client.from("matches").update({
            player1_id: sourcePlayerId,
            player1_match_points: sourcePlayerMatchPoints,
            differential: sourceDifferential,
            player1_score: null,
            player2_score: null,
          }).eq("id", targetMatch.id);
        }
      } else {
        await client.from("matches").update({
          player1_id: sourceMatch.player2_id.id,
          player2_id: sourceMatch.player1_id.id,
          player1_match_points: sourceMatch.player2_match_points,
          player2_match_points: sourceMatch.player1_match_points,
          differential: sourceMatch.differential2,
          differential2: sourceMatch.differential,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      }

      await reassignRoundTables(client, tournamentId, currentPage);

      await fetchCurrentRoundData();

    } catch (error) {
      console.error("Error swapping players:", error);
      showToast("Error swapping players. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwapPlayersWithBye = async (sourceByeId: number, targetByeId: number) => {
    setIsLoading(true);
    try {
      const sourceBye = byes.find((bye) => bye.id === sourceByeId);
      const targetBye = byes.find((bye) => bye.id === targetByeId);

      if (!sourceBye || !targetBye) {
        throw new Error("Invalid bye IDs");
      }

      await Promise.all([
        client.from("byes").update({
          participant_id: targetBye.participant_id.id,
          match_points: targetBye.match_points,
          differential: targetBye.differential,
        }).eq("id", sourceByeId),

        client.from("byes").update({
          participant_id: sourceBye.participant_id.id,
          match_points: sourceBye.match_points,
          differential: sourceBye.differential,
        }).eq("id", targetByeId),
      ]);

      // Recompute participant totals from history so the swapped byes are
      // reflected in each participant's standings. Without this, participants
      // keep the bye contribution from their pre-swap assignment.
      const { error: recomputeError } = await client.rpc(
        "recompute_participant_totals",
        { p_tournament_id: tournamentId },
      );
      if (recomputeError) throw recomputeError;

      await fetchCurrentRoundData();
    } catch (error) {
      console.error("Error swapping players with bye:", error);
      showToast("Error swapping players with bye. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwapPlayerWithBye = async (sourceMatch: any, isSourcePlayer2: boolean, targetByeId: string) => {
    setIsLoading(true);
    try {
      const bye = byes.find((b) => b.id === targetByeId);
      if (!bye) throw new Error("Bye not found");

      const { data: tournament, error: tournamentError } = await client
        .from("tournaments")
        .select("bye_points, bye_differential")
        .eq("id", tournamentId)
        .single();

      if (tournamentError) throw tournamentError;

      const playerId = isSourcePlayer2 ? sourceMatch.player2_id.id : sourceMatch.player1_id.id;

      // Structural mutation 1: swap the match's player seat with the bye holder
      // and reset scores. Don't touch the per-match cumulative snapshots
      // (player*_match_points, differential, differential2) — they're stale
      // for unscored rows and the recompute below makes the participant row
      // the source of truth. When the match is later scored, match-edit will
      // compute fresh snapshots from participants.match_points.
      if (isSourcePlayer2) {
        await client.from("matches").update({
          player2_id: bye.participant_id.id,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      } else {
        await client.from("matches").update({
          player1_id: bye.participant_id.id,
          player1_score: null,
          player2_score: null,
        }).eq("id", sourceMatch.id);
      }

      // Structural mutation 2: reassign the bye to the swapped-in player.
      // Per-bye match_points/differential store the bye CONTRIBUTION, not
      // cumulative — match the regenerate_current_round_pairings convention.
      await client.from("byes").update({
        participant_id: playerId,
        match_points: tournament.bye_points,
        differential: tournament.bye_differential,
      }).eq("id", targetByeId);

      // Now derive participant totals from history. This is what was missing
      // before — the old code did incremental math against stale per-match
      // snapshots, which produced wrong totals when scores had been repaired
      // in earlier rounds.
      const { error: recomputeError } = await client.rpc(
        "recompute_participant_totals",
        { p_tournament_id: tournamentId },
      );
      if (recomputeError) throw recomputeError;

      await reassignRoundTables(client, tournamentId, currentPage);

      await fetchCurrentRoundData();
    } catch (error) {
      console.error("Error swapping player with bye:", error);
      showToast("Error swapping player with bye. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrintPairings = () => {
    printTournamentPairings(
      matches,
      byes,
      currentPage,
      tournamentInfo.starting_table_number || 1,
      tournamentName || tournamentInfo.name, // Use prop value first if available
      tournamentInfo.numbering_mode === "seats" ? "seats" : "tables",
    );
  };

  const handlePrintMatchSlips = () => {
    printMatchSlips(
      matches,
      currentPage,
      tournamentInfo.starting_table_number || 1,
      tournamentName || tournamentInfo.name,
      tournamentInfo.numbering_mode === "seats" ? "seats" : "tables",
    );
  };
  
  const [participants, setParticipants] = useState<any[]>([]);

  const fetchAllParticipants = async () => {
    try {
      const { data, error } = await client
        .from("participants")
        .select("id, name, match_points, differential, dropped_out")
        .eq("tournament_id", tournamentId)
        .order("match_points", { ascending: false })
        .order("differential", { ascending: false });
      
      if (error) throw error;
      setParticipants(data || []);
    } catch (error) {
      console.error("Error fetching participants:", error);
    }
  };

  const handlePrintFinalStandings = () => {
    printFinalStandingsFor(
      tournamentId,
      participants,
      tournamentName || tournamentInfo.name,
    );
  };
  
  // Update local tournament name from parent prop when it changes
  useEffect(() => {
    if (tournamentName !== undefined && tournamentName !== tournamentInfo.name) {
      setTournamentInfo(prev => ({
        ...prev,
        name: tournamentName
      }));
    }
  }, [tournamentName]);

  // Fetch all participants when the tournament has ended
  useEffect(() => {
    if (tournamentInfo.has_ended) {
      fetchAllParticipants();
    }
  }, [tournamentInfo.has_ended]);

  // Re-pairing is allowed on the current round until a result has actually been
  // recorded. Originally it was locked the moment the round started; we now keep
  // it open while every match is still unscored, so a host can fix pairings
  // after starting the round as long as no games have been entered yet.
  const noScoresEntered = !matches.some(
    (m) => m.player1_score !== null && m.player2_score !== null,
  );
  const canRepairCurrentRound =
    currentPage === tournamentInfo.current_round &&
    (!roundInfo.started_at || noScoresEntered);

  const isSeatsMode = tournamentInfo.numbering_mode === "seats";

  // ---- Keyboard score grid (desktop, live round, host only) ---------------
  // Inline score cells replace the read-only Result column so a host can enter
  // a whole round without touching the mouse. Re-pair mode takes the table
  // over for click-to-swap, so the grid stands down while it's active.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gridEnabled = isHost && isRoundActive && !repairMode;

  // Read in an effect, not in the initializer — localStorage isn't available
  // during SSR and reading it inline would hydrate-mismatch.
  const [showKeyboardHint, setShowKeyboardHint] = useState(false);
  useEffect(() => {
    setShowKeyboardHint(
      window.localStorage.getItem(KEYBOARD_HINT_DISMISSED_KEY) !== "1",
    );
  }, []);
  const dismissKeyboardHint = () => {
    window.localStorage.setItem(KEYBOARD_HINT_DISMISSED_KEY, "1");
    setShowKeyboardHint(false);
  };

  const scoreGrid = useScoreGrid({
    matches,
    maxScore: tournamentInfo.max_score ?? 5,
    // Stand down while the cheatsheet is up, so keys read as "I'm reading the
    // shortcuts" rather than being typed into the row behind the modal.
    enabled: gridEnabled && !shortcutsOpen,
    onSaved: (matchId) => {
      // Clear the "missing score" highlight for THIS row only. Clearing the
      // whole set would wipe the other rows End Round flagged, losing the
      // "which ones are still missing" affordance the highlight exists for.
      setMatchErrorIndex((prev) => {
        const row = matches.findIndex((m) => m.id === matchId);
        return row === -1 ? prev : prev.filter((i) => i !== row);
      });
      onMatchesChanged?.();
    },
    onOpenHelp: () => setShortcutsOpen(true),
  });

  /** Persisted table with legacy fallback to positional numbering. */
  const displayTable = (match: any, index: number): number =>
    match.table_number ?? index + (tournamentInfo.starting_table_number || 1);

  // ---- Find player ---------------------------------------------------------
  // Highlights matching rows rather than filtering them out: hiding rows would
  // break the score grid's row-index navigation and the End Round "missing
  // score" highlights, and the host wants the table number in view anyway.
  const [playerQuery, setPlayerQuery] = useState("");
  const findQuery = normalizeName(playerQuery.trim());
  const findActive = findQuery !== "";
  const nameHit = (name?: string | null) =>
    findActive && normalizeName(name ?? "").includes(findQuery);
  const matchHit = (match: any) =>
    nameHit(match.player1_id?.name) || nameHit(match.player2_id?.name);
  const anyFindHit =
    findActive &&
    (matches.some(matchHit) ||
      byes.some((bye) => nameHit(bye.participant_id?.name)));

  // Scroll the first hit into view as the host types. The desktop row and the
  // mobile card both carry data-find-key; only the one CSS keeps visible has
  // client rects, so scroll that one.
  useEffect(() => {
    if (!findActive) return;
    const firstMatch = matches.find(matchHit);
    const firstBye = byes.find((bye) => nameHit(bye.participant_id?.name));
    const key = firstMatch
      ? String(firstMatch.id)
      : firstBye
        ? `bye-${firstBye.id}`
        : null;
    if (key === null) return;
    const el = Array.from(
      document.querySelectorAll(`[data-find-key="${key}"]`),
    ).find((candidate) => candidate.getClientRects().length > 0);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Re-scrolling on matches/byes refetches would yank the page mid-round;
    // only the query should drive the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery]);

  /**
   * True when a player's static pin was not honored this round. Reads the
   * flag persisted at generation time (assignTables' overriddenPins), not a
   * live comparison against the current pin — a pin edited mid-round would
   * otherwise produce a false badge here (spec: "Overridden pins" §).
   */
  const pinOverridden = (match: any, side: 1 | 2): boolean =>
    side === 1 ? !!match.player1_pin_overridden : !!match.player2_pin_overridden;

  // In repair mode player names read as click-to-swap links — primary color
  // with an underline — without changing the row size. The selected source is
  // bold with a solid underline; the other selectable players get a dotted
  // underline that turns solid on hover.
  const swapTargetClass = (isSource: boolean) =>
    `underline underline-offset-4 transition-colors ${
      isSource
        ? "text-primary font-semibold decoration-solid"
        : "text-primary/90 decoration-dotted group-hover:text-primary group-hover:decoration-solid"
    }`;

  return (
    <>
    <ToastNotification
      message={toast.message}
      show={toast.show}
      type={toast.type}
      duration={3500}
      onClose={() => setToast((prev) => ({ ...prev, show: false }))}
    />
    <div className="w-full max-w-[800px] mx-auto">
      <Card theme={{ root: { base: "flex rounded-lg border border-border bg-card shadow-sm", children: "flex h-full flex-col justify-center gap-4 p-3 sm:p-6" } }}>
        {error.message && (
          <div className="p-4 mb-4 text-sm text-destructive rounded-lg bg-destructive/10">
            {error.message}
          </div>
        )}
        {isLoading || !hasInitialized ? (
          <div className="flex items-center justify-center p-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
          </div>
        ) : (
          <div className="mt-4 max-w-full">
            {tournamentInfo.n_rounds && (
              <>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
                  <div className="min-w-0 flex flex-col items-start gap-2">
                    {/* Wrench + Round label — anchors the panel so a host
                        scrolled past the page-level sticky header still sees
                        which round they're looking at. */}
                    <div className="flex items-center gap-3">
                      {adminMenu}
                      <h2 className="text-lg font-semibold text-foreground whitespace-nowrap">
                        Round {currentPage} of {tournamentInfo.n_rounds}
                      </h2>
                      {gridEnabled && (
                        <ScoreShortcutsButton onClick={() => setShortcutsOpen(true)} />
                      )}
                    </div>
                    {/* Status line — always one row so the panel header height
                        stays consistent across upcoming / live / completed
                        rounds (no layout jump when paging). */}
                    <p className="text-sm text-muted-foreground">
                      {roundInfo.started_at ? (
                        <>
                          Started <span className="text-foreground">{formatDateTime(roundInfo.started_at)}</span>
                          {roundInfo.ended_at && (
                            <>
                              {" · "}Ended <span className="text-foreground">{formatDateTime(roundInfo.ended_at)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="italic">Awaiting start</span>
                      )}
                    </p>
                    {/* One-time discovery hint. The grid is invisible until you
                        click a cell, so first-time hosts need a nudge; after
                        that it's noise, hence the localStorage dismissal. */}
                    {gridEnabled && showKeyboardHint && (
                      <p className="hidden md:flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                        <span>Type scores straight into the table</span>
                        <button
                          type="button"
                          onClick={() => setShortcutsOpen(true)}
                          className="text-foreground underline underline-offset-2 hover:text-primary"
                        >
                          See shortcuts
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={dismissKeyboardHint}
                          className="hover:text-foreground"
                        >
                          Dismiss
                        </button>
                      </p>
                    )}
                  </div>
                  {currentPage === tournamentInfo.current_round && (
                      // Round-control tiering: prints are outline (secondary),
                      // Start/End Round is the only solid button in the row
                      // (the primary action in this context). On mobile the
                      // prints wrap above the primary action via flex-wrap.
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        {tournamentInfo.has_ended ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrintFinalStandings}
                            className="gap-1.5"
                          >
                            <Printer className="w-4 h-4" aria-hidden="true" />
                            <span className="hidden sm:inline">Print Final Standings</span>
                            <span className="sm:hidden">Print</span>
                          </Button>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handlePrintPairings}
                                className="gap-1.5"
                              >
                                <Printer className="w-4 h-4" aria-hidden="true" />
                                <span className="hidden sm:inline">Print Pairings</span>
                                <span className="sm:hidden">Pairings</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handlePrintMatchSlips}
                                className="gap-1.5"
                              >
                                <Printer className="w-4 h-4" aria-hidden="true" />
                                <span className="hidden sm:inline">Print Match Slips</span>
                                <span className="sm:hidden">Slips</span>
                              </Button>
                            </div>
                            <Button
                              variant={isRoundActive ? "destructive" : "default"}
                              size="sm"
                              className="sm:ml-auto"
                              onClick={
                                isRoundActive
                                  ? () => setEndRoundConfirmOpen(true)
                                  : handleStartRound
                              }
                              disabled={matchEnding}
                            >
                              {matchEnding && isRoundActive ? (
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                                    aria-hidden="true"
                                  />
                                  Ending…
                                </span>
                              ) : isRoundActive ? (
                                "End Round"
                              ) : (
                                "Start Round"
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                </div>
                {(matches.length > 0 || byes.length > 0) && (
                  <div className="mb-3">
                    <div className="relative w-full sm:max-w-xs">
                      <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="text"
                        value={playerQuery}
                        onChange={(e) => setPlayerQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setPlayerQuery("");
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="Find player…"
                        aria-label="Find player"
                        className="w-full pl-9 pr-8 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                      {playerQuery !== "" && (
                        <button
                          type="button"
                          aria-label="Clear player search"
                          onClick={() => setPlayerQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {findActive && !anyFindHit && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        No players found in this round.
                      </p>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto max-w-full bg-card text-foreground">
                  {repairMode && (
                    <div className="bg-primary/10 border border-primary/30 text-foreground p-3 mb-4 rounded-lg text-center">
                      <p>
                        Re-pair Mode Active - <span className="font-semibold text-primary dark:text-yellow-300">Select another player</span> to swap with {
                          repairSourceMatch.isBye
                            ? byes.find(b => b.id === repairSourceMatch.byeId)?.participant_id.name
                            : (repairSourceMatch.isPlayer2
                              ? repairSourceMatch.match?.player2_id?.name
                              : repairSourceMatch.match?.player1_id?.name)
                        }
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Click any player or <button onClick={() => {setRepairMode(false); setRepairSourceMatch(null);}} className="text-primary hover:text-primary/80 underline">cancel</button>
                      </p>
                    </div>
                  )}
                  {matches && matches.length > 0 && <table className="hidden md:table min-w-full text-sm text-left text-muted-foreground border-2 border-border">
                    <thead className="sticky top-0 z-10 text-xs uppercase font-normal text-foreground bg-muted border-b-2 border-border rounded-t-lg">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-center">
                          {isSeatsMode ? "Seats" : "Table"}
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Player 1
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Result
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          Player 2
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          <span className="inline-flex items-center justify-center gap-1">
                            MP (P1 / P2) <InfoHint text={MP_ROUND_HINT} />
                          </span>
                        </th>
                        <th scope="col" className="px-4 py-2 text-center">
                          <span className="inline-flex items-center justify-center gap-1">
                            Diff (P1 / P2) <InfoHint text={DIFF_ROUND_HINT} />
                          </span>
                        </th>
                        <th scope="col" className="px-4 py-2 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.length > 0 &&
                        matches.map((match, index) => {
                          const repairEnabled = canRepairCurrentRound;
                          const hasResult =
                            match.player1_score !== null && match.player2_score !== null;
                          const perRound = perRoundScores(match, tournamentInfo.max_score ?? 5);
                          const isFindHit = findActive && matchHit(match);
                          const isFindDimmed = findActive && !isFindHit;
                          return (
                            <Fragment key={match.id}>
                              <tr
                                data-find-key={match.id}
                                className={`border-b border-border ${matchErrorIndex.includes(index) ? "bg-red-600/20" : isFindHit ? "bg-primary/10" : "bg-muted/50"}${isFindDimmed ? " opacity-40" : ""}`}
                              >
                                <td className={`px-4 py-2 text-center border-r ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {isSeatsMode
                                    ? `${2 * displayTable(match, index) - 1}·${2 * displayTable(match, index)}`
                                    : displayTable(match, index)}
                                </td>
                                <td
                                  className={`px-4 py-2 text-center border-r text-foreground ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"} ${
                                    repairMode ? "group cursor-pointer" : ""
                                  }`}
                                  onClick={repairMode ? () => handleRepairClick(match, false) : undefined}
                                  role={repairMode ? "button" : undefined}
                                  tabIndex={repairMode ? 0 : undefined}
                                >
                                  <span className="inline-flex items-center justify-center gap-1">
                                    {isSeatsMode && (
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {2 * displayTable(match, index) - 1}
                                      </span>
                                    )}
                                    {repairMode ? (
                                      <span className={swapTargetClass(repairSourceMatch?.match?.id === match.id && !repairSourceMatch?.isPlayer2 && !repairSourceMatch?.isBye)}>
                                        {match.player1_id.name}
                                      </span>
                                    ) : (
                                      <span>{match.player1_id.name}</span>
                                    )}
                                    {pinOverridden(match, 1) && (
                                      <span
                                        title="Static assignment couldn't be honored this round"
                                        className="text-amber-500 text-xs flex-shrink-0"
                                        aria-label="Static assignment couldn't be honored this round"
                                      >⚠</span>
                                    )}
                                  </span>
                                </td>
                                <td className={`px-4 py-2 text-center border-r tabular-nums ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {gridEnabled && !forfeitSideOf(match) ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      {([0, 1] as const).map((col) => (
                                        <ScoreCell
                                          key={col}
                                          ref={(el) => scoreGrid.registerInput(index, col, el)}
                                          value={scoreGrid.valueAt(index, col)}
                                          playerName={
                                            col === 0
                                              ? match.player1_id.name
                                              : match.player2_id.name
                                          }
                                          isCursor={scoreGrid.isCursor(index, col)}
                                          isRejected={scoreGrid.isRejected(index, col)}
                                          saveState={scoreGrid.saveState[match.id] ?? "idle"}
                                          onKeyDown={(e) =>
                                            scoreGrid.onKeyDown(e, { row: index, col })
                                          }
                                          onFocus={() =>
                                            scoreGrid.focusCell({ row: index, col })
                                          }
                                          // Clicking away mid-correction must not
                                          // strand the edit locally.
                                          onBlur={(e) => scoreGrid.onBlurCell(e, index)}
                                        />
                                      ))}
                                      <SaveIndicator
                                        state={scoreGrid.saveState[match.id] ?? "idle"}
                                        error={scoreGrid.saveError[match.id]}
                                      />
                                    </div>
                                  ) : hasResult ? (
                                    <span className="font-medium text-foreground">
                                      {forfeitLabel(match) ?? (
                                        <>{match.player1_score}&ndash;{match.player2_score}</>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">&mdash;</span>
                                  )}
                                </td>
                                <td
                                  className={`px-4 py-2 text-center border-r text-foreground ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"} ${
                                    repairMode ? "group cursor-pointer" : ""
                                  }`}
                                  onClick={repairMode ? () => handleRepairClick(match, true) : undefined}
                                  role={repairMode ? "button" : undefined}
                                  tabIndex={repairMode ? 0 : undefined}
                                >
                                  <span className="inline-flex items-center justify-center gap-1">
                                    {isSeatsMode && (
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {2 * displayTable(match, index)}
                                      </span>
                                    )}
                                    {repairMode ? (
                                      <span className={swapTargetClass(repairSourceMatch?.match?.id === match.id && repairSourceMatch?.isPlayer2 && !repairSourceMatch?.isBye)}>
                                        {match.player2_id.name}
                                      </span>
                                    ) : (
                                      <span>{match.player2_id.name}</span>
                                    )}
                                    {pinOverridden(match, 2) && (
                                      <span
                                        title="Static assignment couldn't be honored this round"
                                        className="text-amber-500 text-xs flex-shrink-0"
                                        aria-label="Static assignment couldn't be honored this round"
                                      >⚠</span>
                                    )}
                                  </span>
                                </td>
                                <td className={`px-4 py-2 text-center border-r tabular-nums ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {perRound ? `${perRound.p1Mp} / ${perRound.p2Mp}` : "N/A"}
                                </td>
                                <td className={`px-4 py-2 text-center border-r tabular-nums ${matchErrorIndex.includes(index) ? "border-red-400" : "border-border"}`}>
                                  {perRound ? `${perRound.p1Diff} / ${perRound.p2Diff}` : "N/A"}
                                </td>
                                <td className="px-2">
                                  <div className="flex items-center justify-end gap-1 flex-wrap">
                                    {/* On a completed round the edit pencil is
                                        disabled (scores can only be entered while
                                        the round is active) and the repair pencil
                                        below replaces it, so suppress the dead
                                        edit pencil to avoid two redundant icons. */}
                                    {!(isHost && isRoundCompleted) && (
                                      <MatchEditModal
                                        key={`${match.player1_score}-${match.player2_score}-${match.player1_forfeit}-${match.player2_forfeit}`}
                                        match={match}
                                        fetchCurrentRoundData={refreshMatchesAndNotify}
                                        setMatchErrorIndex={setMatchErrorIndex}
                                        isRoundActive={isRoundActive}
                                        index={index}
                                        tournament={tournamentInfo}
                                        mode="edit"
                                      />
                                    )}
                                    {/*
                                      Kebab collapses the previous stack of two
                                      ArrowUpDown buttons into a single overflow
                                      affordance. Rendering rule: if no swap is
                                      possible in this context (round started,
                                      not current round, or single-pair table)
                                      the kebab is omitted entirely — the pencil
                                      stands alone. Each item swaps this pair's
                                      P1 with the neighboring pair's P1; that
                                      re-pairs both matches in a single click.
                                    */}
                                    {repairEnabled && matches.length > 1 && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label="More actions"
                                            className="inline-flex items-center justify-center w-9 h-9 rounded-md text-foreground hover:bg-muted hover:text-primary"
                                          >
                                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56">
                                          <DropdownMenuItem
                                            disabled={index === 0}
                                            onSelect={() => {
                                              const above = matches[index - 1];
                                              if (above) {
                                                handleSwapPlayers(match, above, false, false);
                                              }
                                            }}
                                          >
                                            <ArrowUp className="h-4 w-4 mr-2" aria-hidden="true" />
                                            Swap with pair above
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={index === matches.length - 1}
                                            onSelect={() => {
                                              const below = matches[index + 1];
                                              if (below) {
                                                handleSwapPlayers(match, below, false, false);
                                              }
                                            }}
                                          >
                                            <ArrowDown className="h-4 w-4 mr-2" aria-hidden="true" />
                                            Swap with pair below
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onSelect={() => handleRepairClick(match, false)}
                                          >
                                            <ArrowUpDown className="h-4 w-4 mr-2" aria-hidden="true" />
                                            Swap with another pair…
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                    {isHost && isRoundCompleted && (
                                      <MatchEditModal
                                        key={`repair-${match.id}`}
                                        match={match}
                                        fetchCurrentRoundData={fetchCurrentRoundData}
                                        setMatchErrorIndex={setMatchErrorIndex}
                                        isRoundActive={false}
                                        index={index}
                                        tournament={tournamentInfo}
                                        mode="repair"
                                        showReason={currentPage !== tournamentInfo.current_round}
                                        onRepairSuccess={() => {
                                          showToast("Match updated.", "success");
                                          fetchMatchEdits();
                                          onRepairCompleted?.();
                                        }}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isHost && (matchEditsByMatch[match.id]?.length ?? 0) > 0 && (
                                <tr className={`border-b border-border bg-muted/30${isFindDimmed ? " opacity-40" : ""}`}>
                                  <td colSpan={7} className="px-4 py-1">
                                    <details className="text-xs">
                                      <summary className="cursor-pointer text-muted-foreground">
                                        Edit history ({matchEditsByMatch[match.id]!.length})
                                      </summary>
                                      <ul className="mt-1 ml-3 space-y-1">
                                        {matchEditsByMatch[match.id]!.map(e => (
                                          <li key={e.id} className="text-muted-foreground">
                                            {e.old_player1_score}-{e.old_player2_score} → {e.new_player1_score}-{e.new_player2_score}
                                            {" · "}{new Date(e.edited_at).toLocaleString()}
                                            {e.reason ? ` · ${e.reason}` : ""}
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>}

                  {/* Mobile pairing cards */}
                  {matches && matches.length > 0 && (
                    <div className="md:hidden space-y-2">
                      {matches.map((match, index) => {
                        const isError = matchErrorIndex.includes(index);
                        const isFindHit = findActive && matchHit(match);
                        const isFindDimmed = findActive && !isFindHit;
                        const tableNum = displayTable(match, index);
                        const tableLabel = isSeatsMode ? `Seats ${2 * tableNum - 1}·${2 * tableNum}` : `Table ${tableNum}`;
                        const repairEnabled = canRepairCurrentRound;
                        const perRound = perRoundScores(match, tournamentInfo.max_score ?? 5);
                        const isP1Selected =
                          repairMode &&
                          repairSourceMatch &&
                          !repairSourceMatch.isBye &&
                          repairSourceMatch.match?.id === match.id &&
                          !repairSourceMatch.isPlayer2;
                        const isP2Selected =
                          repairMode &&
                          repairSourceMatch &&
                          !repairSourceMatch.isBye &&
                          repairSourceMatch.match?.id === match.id &&
                          repairSourceMatch.isPlayer2;

                        const swapButtonClass = (selected: boolean) =>
                          `p-2 rounded-md flex items-center justify-center flex-shrink-0 ${
                            repairEnabled
                              ? selected
                                ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25"
                                : "text-primary hover:bg-muted"
                              : "text-muted-foreground cursor-not-allowed"
                          }`;

                        return (
                          <div
                            key={match.id}
                            data-find-key={match.id}
                            className={`rounded-lg border ${
                              isError
                                ? "border-red-500/60 bg-red-600/10"
                                : isFindHit
                                  ? "border-primary/40 bg-primary/10"
                                  : "border-border bg-card"
                            } p-3${isFindDimmed ? " opacity-40" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                                {tableLabel}
                              </span>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {/* See desktop note: hide the disabled edit
                                    pencil on completed rounds where the repair
                                    pencil replaces it. */}
                                {!(isHost && isRoundCompleted) && (
                                  <div className="w-10 h-10">
                                    <MatchEditModal
                                      key={`${match.player1_score}-${match.player2_score}-${match.player1_forfeit}-${match.player2_forfeit}`}
                                      match={match}
                                      fetchCurrentRoundData={refreshMatchesAndNotify}
                                      setMatchErrorIndex={setMatchErrorIndex}
                                      isRoundActive={isRoundActive}
                                      index={index}
                                      tournament={tournamentInfo}
                                      mode="edit"
                                    />
                                  </div>
                                )}
                                {isHost && isRoundCompleted && (
                                  <div className="w-11 h-11">
                                    <MatchEditModal
                                      key={`repair-${match.id}`}
                                      match={match}
                                      fetchCurrentRoundData={fetchCurrentRoundData}
                                      setMatchErrorIndex={setMatchErrorIndex}
                                      isRoundActive={false}
                                      index={index}
                                      tournament={tournamentInfo}
                                      mode="repair"
                                      showReason={currentPage !== tournamentInfo.current_round}
                                      onRepairSuccess={() => {
                                        showToast("Match updated.", "success");
                                        fetchMatchEdits();
                                        onRepairCompleted?.();
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground flex items-center gap-1">
                                    {isSeatsMode && (
                                      <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                                        {2 * displayTable(match, index) - 1}
                                      </span>
                                    )}
                                    <span className="truncate min-w-0">{match.player1_id.name}</span>
                                    {pinOverridden(match, 1) && (
                                      <span
                                        title="Static assignment couldn't be honored this round"
                                        className="text-amber-500 text-xs flex-shrink-0"
                                        aria-label="Static assignment couldn't be honored this round"
                                      >⚠</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    Match Pts {perRound ? perRound.p1Mp : "N/A"} · Diff {perRound ? perRound.p1Diff : "N/A"}
                                    {match.player1_forfeit ? " · Forfeit" : ""}
                                  </p>
                                </div>
                                <button
                                  title={
                                    repairEnabled
                                      ? "Re-pair pairing"
                                      : "Cannot re-pair once results have been entered"
                                  }
                                  className={swapButtonClass(!!isP1Selected)}
                                  onClick={() => repairEnabled && handleRepairClick(match, false)}
                                  disabled={!repairEnabled}
                                >
                                  <ArrowUpDown className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2 pt-2 border-t border-border">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground flex items-center gap-1">
                                    {isSeatsMode && (
                                      <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                                        {2 * displayTable(match, index)}
                                      </span>
                                    )}
                                    <span className="truncate min-w-0">{match.player2_id.name}</span>
                                    {pinOverridden(match, 2) && (
                                      <span
                                        title="Static assignment couldn't be honored this round"
                                        className="text-amber-500 text-xs flex-shrink-0"
                                        aria-label="Static assignment couldn't be honored this round"
                                      >⚠</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    Match Pts {perRound ? perRound.p2Mp : "N/A"} · Diff {perRound ? perRound.p2Diff : "N/A"}
                                    {match.player2_forfeit ? " · Forfeit" : ""}
                                  </p>
                                </div>
                                <button
                                  title={
                                    repairEnabled
                                      ? "Re-pair pairing"
                                      : "Cannot re-pair once results have been entered"
                                  }
                                  className={swapButtonClass(!!isP2Selected)}
                                  onClick={() => repairEnabled && handleRepairClick(match, true)}
                                  disabled={!repairEnabled}
                                >
                                  <ArrowUpDown className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            {isHost && (matchEditsByMatch[match.id]?.length ?? 0) > 0 && (
                              <details className="mt-2 text-xs">
                                <summary className="cursor-pointer text-muted-foreground">
                                  Edit history ({matchEditsByMatch[match.id]!.length})
                                </summary>
                                <ul className="mt-1 ml-3 space-y-1">
                                  {matchEditsByMatch[match.id]!.map(e => (
                                    <li key={e.id} className="text-muted-foreground">
                                      {e.old_player1_score}-{e.old_player2_score} → {e.new_player1_score}-{e.new_player2_score}
                                      {" · "}{new Date(e.edited_at).toLocaleString()}
                                      {e.reason ? ` · ${e.reason}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {byes && byes.length > 0 && <>
                  <h3 className="text-foreground text-lg font-semibold mt-7 mb-3 text-center">Game Byes</h3>

                  {/* Mobile bye cards */}
                  <div className="md:hidden space-y-2">
                    {byes.map((bye) => {
                      const repairEnabled = canRepairCurrentRound;
                      const isSelected =
                        repairMode &&
                        repairSourceMatch &&
                        repairSourceMatch.isBye &&
                        repairSourceMatch.byeId === bye.id;
                      const isFindHit = nameHit(bye.participant_id?.name);
                      const isFindDimmed = findActive && !isFindHit;
                      return (
                        <div
                          key={bye.id}
                          data-find-key={`bye-${bye.id}`}
                          className={`rounded-lg border ${
                            isFindHit ? "border-primary/40 bg-primary/10" : "border-border bg-card"
                          } p-3 flex items-center gap-3${isFindDimmed ? " opacity-40" : ""}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {bye.participant_id.name}
                            </p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              Match Pts {bye.match_points} · Diff {bye.differential} · Bye
                            </p>
                          </div>
                          <button
                            title={
                              repairEnabled
                                ? "Re-pair pairing"
                                : "Cannot re-pair once results have been entered"
                            }
                            className={`p-2 rounded-md flex items-center justify-center flex-shrink-0 ${
                              repairEnabled
                                ? isSelected
                                  ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25"
                                  : "text-primary hover:bg-muted"
                                : "text-muted-foreground cursor-not-allowed"
                            }`}
                            onClick={() => repairEnabled && handleByeRepairClick(bye)}
                            disabled={!repairEnabled}
                          >
                            <ArrowUpDown className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="hidden md:block overflow-x-auto max-w-full bg-card text-foreground">
                    <table className="min-w-full text-sm text-left text-muted-foreground border-2 border-border">
                      <thead className="text-xs uppercase font-normal text-foreground bg-muted border-b-2 border-border rounded-t-lg">
                        <tr>
                          <th scope="col" className="px-4 py-2 text-center">
                            {isSeatsMode ? "Seats" : "Table"}
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Name
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            Opponent
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            <span className="inline-flex items-center justify-center gap-1">
                              Match Points <InfoHint text={MP_ROUND_HINT} />
                            </span>
                          </th>
                          <th scope="col" className="px-4 py-2 text-center">
                            <span className="inline-flex items-center justify-center gap-1">
                              Differential <InfoHint text={DIFF_ROUND_HINT} />
                            </span>
                          </th>
                          <th scope="col" className="px-4 py-2 text-right">
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {byes.length > 0 &&
                          byes.map((bye, index) => (
                            <Fragment key={bye.id}>
                              <tr
                                data-find-key={`bye-${bye.id}`}
                                className={`border-b border-border ${nameHit(bye.participant_id?.name) ? "bg-primary/10" : "bg-muted/50"}${findActive && !nameHit(bye.participant_id?.name) ? " opacity-40" : ""}`}
                              >
                                <td className="px-4 py-2 text-center border-r border-border">
                                  N/A
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.participant_id.name}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  N/A
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.match_points}
                                </td>
                                <td className="px-4 py-2 text-center border-r border-border">
                                  {bye.differential}
                                </td>
                                <td className="px-2">
                                  <button
                                    title={currentPage === tournamentInfo.current_round ? (canRepairCurrentRound ? "Re-pair pairing" : "Cannot re-pair once results have been entered") : "Can only re-pair current round"}
                                    className={`p-2 rounded-md flex items-center justify-center ${
                                      canRepairCurrentRound
                                        ? repairMode && repairSourceMatch && repairSourceMatch.isBye && repairSourceMatch.byeId === bye.id
                                          ? "text-yellow-600 dark:text-yellow-400 bg-primary/15 hover:bg-primary/25 hover:text-yellow-700 dark:hover:text-yellow-300 cursor-pointer"
                                          : repairMode
                                            ? "text-primary hover:bg-muted hover:text-primary/80 cursor-pointer"
                                            : "text-primary hover:bg-muted hover:text-primary/80 cursor-pointer"
                                        : "text-muted-foreground cursor-not-allowed"
                                    }`}
                                    onClick={() => {
                                      if (canRepairCurrentRound) {
                                        handleByeRepairClick(bye);
                                      }
                                    }}
                                    disabled={!canRepairCurrentRound}
                                  >
                                    <ArrowUpDown className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>}

                <div className="flex overflow-x-auto sm:justify-center pb-3">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={tournamentInfo.current_round || 1}
                    onPageChange={onPageChange}
                    showIcons
                    theme={{
                      pages: {
                        base: "xs:mt-0 mt-2 inline-flex items-center -space-x-px",
                        showIcon: "inline-flex",
                        previous: {
                          base: "ml-0 rounded-l-lg border border-border bg-card px-3 py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          icon: "h-5 w-5",
                        },
                        next: {
                          base: "rounded-r-lg border border-border bg-card px-3 py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          icon: "h-5 w-5",
                        },
                        selector: {
                          base: "w-12 border border-border bg-card py-2 leading-tight text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
                          active: "bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 hover:text-primary",
                          disabled: "cursor-not-allowed opacity-50",
                        },
                      },
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )
        }
      </Card >
      
      {selectedMatch && (
        <RepairPairingModal
          isOpen={repairModalOpen}
          onClose={() => setRepairModalOpen(false)}
          match={selectedMatch}
          tournamentId={tournamentId}
          roundNumber={currentPage}
          fetchCurrentRoundData={fetchCurrentRoundData}
          isRoundActive={isRoundActive}
        />
      )}
      <ConfirmationDialog
        open={endRoundConfirmOpen}
        onOpenChange={setEndRoundConfirmOpen}
        onConfirm={handleEndRound}
        variant="destructive"
        title={`End Round ${currentPage}?`}
        description={
          // On the final round, there is no next round — the tournament
          // auto-finalises (see handleEndRound). Reflect that in the copy
          // rather than promising next-round pairings that won't come.
          tournamentInfo.n_rounds !== null &&
          currentPage === tournamentInfo.n_rounds
            ? "The tournament will be ended."
            : "New pairings will be generated for the next round."
        }
        confirmLabel="End round"
        cancelLabel="Cancel"
      />
      <ScoreShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        maxScore={tournamentInfo.max_score ?? 5}
      />
    </div >
    </>
  );
}
