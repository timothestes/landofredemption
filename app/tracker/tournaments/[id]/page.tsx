"use client";

import { Button } from "../../../../components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HiPencil } from "react-icons/hi";
import { Wrench, RefreshCw, Unlock, SquarePen, Play } from "lucide-react";
import CountdownTimer from "../../../../components/ui/CountdownTimer";
import RoundProgressBar from "../../../../components/ui/RoundProgressBar";
import EditParticipantModal from "../../../../components/ui/EditParticipantModal";
import EditTournamentNameModal from "../../../../components/ui/EditTournamentNameModal";
import TournamentStartModal from "../../../../components/ui/TournamentStartModal";
import TournamentTabs from "../../../../components/ui/TournamentTabs";
import QRJoinDialog from "../../../../components/ui/QRJoinDialog";
import LiveRoundDialog from "../../../../components/ui/LiveRoundDialog";
import Breadcrumb from "../../../../components/ui/breadcrumb";
import ToastNotification from "../../../../components/ui/toast-notification";
import { createClient } from "../../../../utils/supabase/client";
import { suggestNumberOfRounds } from "../../../../utils/tournamentUtils";
import { createPairing } from "../../../../utils/tournament/pairingUtilsV2";
import { buildStateFromSupabase } from "../../../../utils/tournament/stateAdapter";
import { isNameFrozen } from "../../../../utils/tournament/naming";
import { recomputeTotalsFromHistory } from "../../../../lib/tournament/results";
import {
  loadTournamentDecklistsAction,
  setResultsPublishedAction,
  publishTournamentDecklistsAction,
  type TournamentDecklistRow,
} from "../actions";
import PublishDecklistsSection from "../../../../components/ui/PublishDecklistsSection";
import { RegeneratePairingsButton } from "../../../../components/ui/RegeneratePairingsButton";
import { UnlockAndRepairDialog, type ScoredMatch } from "../../../../components/ui/UnlockAndRepairDialog";
import { RepairTournamentBanner } from "../../../../components/ui/RepairTournamentBanner";
import { RepairPastResultPicker, type PickerMatch } from "../../../../components/ui/RepairPastResultPicker";
import MatchEditModal from "../../../../components/ui/match-edit";
import { EndTournamentDialog } from "../../../../components/ui/EndTournamentDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../components/ui/dropdown-menu";

const supabase = createClient();

// How often the pre-start page re-reads the roster. Short enough that a player
// scanning the QR at the check-in table appears while the host is still looking
// at the screen; long enough to stay cheap for a tab left open all morning.
const CHECK_IN_POLL_MS = 8000;

export default function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [participants, setParticipants] = useState([]);
  const [tournament, setTournament] = useState<any>(null);
  const [currentParticipant, setCurrentParticipant] = useState<any>(null);
  const [newParticipantName, setNewParticipantName] = useState<string>("");
  const [newParticipantSeat, setNewParticipantSeat] = useState<string>("");
  const [isEditTournamentModalOpen, setIsEditTournamentModalOpen] =
    useState<boolean>(false);
  const [activeTab, setActiveTab] = useState(0);
  const [isEditParticipantModalOpen, setIsEditParticipantModalOpen] =
    useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState<string | null>(null);
  // Bumped per request so a slow response from an earlier fetch can't overwrite
  // the result of a later one — see fetchParticipants / fetchDecklists.
  const participantsSeqRef = useRef(0);
  const decklistsSeqRef = useRef(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [showStartModal, setShowStartModal] = useState(false);
  const [isRoundActive, setIsRoundActive] = useState(false);
  const [matchErrorIndex, setMatchErrorIndex] = useState<number[]>([])
  const [toast, setToast] = useState<{
    message: string;
    show: boolean;
    type?: "success" | "error" | "warning" | "info";
  }>({
    message: "",
    show: false,
    type: "success",
  });

  const [latestRound, setLatestRound] = useState<any>(null);
  const [scoredCurrentRoundMatches, setScoredCurrentRoundMatches] = useState<ScoredMatch[]>([]);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [showPairingNotice, setShowPairingNotice] = useState(true);
  const [decklists, setDecklists] = useState<TournamentDecklistRow[]>([]);
  const [usernames, setUsernames] = useState<Map<string, string>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [qrJoinDialogOpen, setQrJoinDialogOpen] = useState(false);
  const [liveRoundDialogOpen, setLiveRoundDialogOpen] = useState(false);

  // Confirmation dialogs
  const [endTournamentConfirmOpen, setEndTournamentConfirmOpen] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [tournamentNotFound, setTournamentNotFound] = useState(false);
  // Header overflow-menu controls the Re-pair dialog
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  // Bumped after re-pair RPC succeeds so TournamentRounds re-fetches matches.
  // Without this nonce, the matches table only re-fetches on currentPage /
  // tournamentId change, so the host sees stale pairings until they refresh.
  const [pairingsRefreshNonce, setPairingsRefreshNonce] = useState(0);

  // Picker state for "Edit a past result"
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRepairMatchId, setPickerRepairMatchId] = useState<string | null>(null);
  const [pickerRepairMatch, setPickerRepairMatch] = useState<any>(null);
  const [allCompletedMatches, setAllCompletedMatches] = useState<PickerMatch[]>([]);
  const [completedRoundNumbers, setCompletedRoundNumbers] = useState<number[]>([]);

  const showToast = (
    message: string,
    type: "success" | "error" | "warning" | "info" = "success"
  ) => {
    setToast({ message, show: true, type });
    const duration = type === "success" ? 2000 : 4500;
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), duration);
  };

  useEffect(() => {
    const unwrapParams = async () => {
      try {
        const resolvedParams = await params;
        setId(resolvedParams.id);
      } catch (error) {
        console.error("Error resolving params:", error);
      }
    };
    unwrapParams();
  }, [params]);

  // Update document title when tournament name changes
  useEffect(() => {
    if (tournament?.name) {
      document.title = `${tournament.name} - Land of Redemption`;
    } else {
      document.title = "Land of Redemption";
    }
  }, [tournament?.name]);

  const handleAddParticipant = async (name: string) => {
    if (!name.trim()) return;
    try {
      const { error } = await supabase
        .from("participants")
        .insert([{ name, tournament_id: id }]);
      if (error) throw error;
      fetchParticipants();
      showToast("Participant added successfully!", "success");
    } catch (error) {
      showToast("Error adding participant.", "error");
      console.error("Error adding participant:", error);
    } finally {
      setIsModalOpen(false);
    }
  };

  const fetchTournamentDetails = async () => {
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      if (!data) {
        setTournamentNotFound(true);
        return;
      }
      setTournament(data);
      setTournamentNotFound(false);
    } catch (error) {
      // Supabase returns a PGRST116 error code when .single() hits 0 rows.
      // Treat any fetch failure on a fresh load (no tournament loaded yet)
      // as a "not found" so the user gets a real error state instead of
      // an indefinite "Loading…" breadcrumb.
      console.error("Error fetching tournament details:", error);
      setTournamentNotFound(true);
    }
  };

  // useCallback so the check-in poller below can depend on a stable identity —
  // a fresh function each render would reset its interval before it ever fires.
  const fetchParticipants = useCallback(async () => {
    if (!id) return;
    // Reads now come from two places — host actions and the background poller —
    // so responses can land out of order. A slow poll issued BEFORE a delete
    // resolving AFTER it would resurrect the deleted row until the next tick.
    // Ignore any response that isn't from the newest request.
    const seq = ++participantsSeqRef.current;
    try {
      const { data, error } = await supabase
        .from("participants")
        .select("*")
        .eq("tournament_id", id)
        .order("match_points", { ascending: false });
      if (error) throw error;
      if (seq !== participantsSeqRef.current) return;
      // Skip the state write when nothing changed: a new array identity on
      // every tick re-fires the profiles lookup below, turning an idle page
      // into three requests every poll for data that never moved.
      setParticipants((prev) =>
        JSON.stringify(prev) === JSON.stringify(data) ? prev : data
      );
    } catch (error) {
      console.error("Error fetching participants:", error);
    } finally {
      if (seq === participantsSeqRef.current) setLoading(false);
    }
  }, [id]);

  // Batched profile lookup for the account-linkage badge (Task 9 Step 1) —
  // one query for every distinct user_id currently on the roster. Profiles
  // are publicly readable, so this runs on the regular client, not admin.
  useEffect(() => {
    const userIds = [...new Set(participants.map((p: any) => p.user_id).filter(Boolean))];
    if (userIds.length === 0) {
      setUsernames(new Map());
      return;
    }
    supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds)
      .then(({ data }) => {
        const map = new Map<string, string>();
        for (const p of data ?? []) {
          if (p.username) map.set(p.id, p.username);
        }
        setUsernames(map);
      });
  }, [participants]);

  const updateParticipant = async () => {
    if (!currentParticipant || !newParticipantName.trim()) return;
    const trimmedSeat = newParticipantSeat.trim();
    const seatNum = trimmedSeat === "" ? null : Number(trimmedSeat);
    if (seatNum !== null && (!Number.isInteger(seatNum) || seatNum < 1)) {
      showToast("Static assignment must be a positive whole number.", "error");
      return;
    }
    try {
      const { error } = await supabase
        .from("participants")
        .update({ name: newParticipantName, assigned_seat: seatNum })
        .eq("id", currentParticipant.id);
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          showToast(
            `${numberingMode === "seats" ? "Seat" : "Table"} ${seatNum} is already assigned to another player.`,
            "error",
          );
          return;
        }
        throw error;
      }
      fetchParticipants();
      setIsEditParticipantModalOpen(false);
      showToast("Participant updated successfully!", "success");
    } catch (error) {
      showToast("Error updating participant.", "error");
      console.error("Error updating participant:", error);
    }
  };

  const deleteParticipant = async (id: string) => {
    try {
      const { error } = await supabase
        .from("participants")
        .delete()
        .eq("id", id);
      if (error) throw error;
      fetchParticipants();
      showToast("Participant deleted successfully!", "success");
    } catch (error) {
      showToast("Error deleting participant.", "error");
      console.error("Error deleting participant:", error);
    }
  };

  const handleTournamentStatusToggle = async () => {
    if (!tournament) {
      showToast("Tournament is not available yet.", "error");
      return;
    }

    if (!tournament.has_started) {
      setShowStartModal(true);
      return;
    }

    // Destructive end-tournament path — confirm first.
    setEndTournamentConfirmOpen(true);
  };

  // Called after has_ended is committed, from either end path:
  //  - Manual end (performEndTournament, below) — honors the confirm
  //    dialog's checkbox. A single call there covers both of its internal
  //    branches (the round gets finalized via handleEndRound first when it
  //    wasn't already completed, but performEndTournament's own update always
  //    runs after, so hooking it once here is sufficient — no double-fire).
  //  - Auto end on the final round (TournamentRounds' "End Round" button —
  //    the common case; most tournaments end this way, not via the admin
  //    menu) — wired unconditionally with publish=true via the
  //    onTournamentAutoPublish callback threaded through TournamentTabs,
  //    since that path has no publish-choice dialog; the host's opt-out
  //    there is unpublishing afterward from the Publish section.
  // "No decklists to publish" is NORMAL for events without submissions —
  // treated as success for the toast, not a failure.
  const publishOnEnd = async (publish: boolean) => {
    if (!publish) return;
    const results = await setResultsPublishedAction(id, true);
    const decks = await publishTournamentDecklistsAction(
      id,
      tournament?.deck_format ?? "Other"
    );
    const deckFailure =
      decks.success === false && decks.error !== "No decklists to publish";
    if (results.success === false || deckFailure) {
      showToast("Ended, but publishing failed — use the Publish section.", "warning");
    } else {
      showToast("Tournament ended — results published.", "success");
    }
  };

  const performEndTournament = async (publish: boolean) => {
    if (!tournament) return;
    setTogglingStatus(true);

    const now = new Date().toISOString();
    if (latestRound && !latestRound?.is_completed) {
      const client = await createClient();

      const { data, error } = await client
        .from("matches")
        .select(
          "id, player1_match_points, player2_match_points, differential, differential2,  player1_id:participants!matches_player1_id_fkey(name,id), player2_id:participants!matches_player2_id_fkey(name,id), player2_id, player1_score, player2_score"
        )
        .eq("tournament_id", tournament.id)
        .eq("round", latestRound.round_number)
        .order("id", { ascending: true });

      if (error) throw error;

      const { data: byeData, error: byeError } = await client
        .from("byes")
        .select(
          "id, participant_id:participants(id, name), match_points, differential"
        )
        .eq("tournament_id", tournament.id)
        .eq("round_number", latestRound.round_number)
        .order("id", { ascending: true });

      if (byeError) throw byeError;

      await handleEndRound(data, setMatchErrorIndex, byeData, latestRound.round_number);
    }
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .update({
          has_ended: true,
          ended_at: now,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      setActiveTab(2); // jump to Standings — the tournament is now complete
      // Publishing never rolls back the end — it already committed above.
      await publishOnEnd(publish);
      if (!publish) showToast("Tournament ended successfully!", "success");
    } catch (error) {
      showToast("Error updating tournament status.", "error");
      console.error("Error updating tournament status:", error);
    } finally {
      setTogglingStatus(false);
    }
  };

  const handleEndRound = useCallback(async (matches: any[], setMatchErrorIndex: any, byes: any[], round: number) => {
    const client = createClient();

    let matchErrorIndexArr = [];

    const now = new Date().toISOString();

    // Auto-handle matches where a player has dropped mid-round
    for (const match of matches) {
      if (match.player1_score !== null && match.player2_score !== null) continue;
      const [{ data: p1Status }, { data: p2Status }] = await Promise.all([
        client.from("participants").select("dropped_out").eq("id", match.player1_id.id).single(),
        client.from("participants").select("dropped_out").eq("id", match.player2_id.id).single(),
      ]);
      if (p1Status?.dropped_out || p2Status?.dropped_out) {
        if (p1Status?.dropped_out && p2Status?.dropped_out) {
          match.player1_score = 0;
          match.player2_score = 0;
        } else if (p1Status?.dropped_out) {
          match.player1_score = 0;
          match.player2_score = tournament.max_score;
        } else {
          match.player1_score = tournament.max_score;
          match.player2_score = 0;
        }
        await client.from("matches").update({
          player1_score: match.player1_score,
          player2_score: match.player2_score,
        }).eq("id", match.id);
      }
    }

    // Checking if the user has not added the score
    matches.forEach((match, index) => {
      if (match.player1_score === null || match.player2_score === null) {
        setMatchErrorIndex((matchErrorIndex) => [...matchErrorIndex, index]);
        matchErrorIndexArr.push(index);
      }
    });

    if (matchErrorIndexArr.length > 0) {
      showToast("Please add scores to all matches.", "warning");
      return;
    }

    try {
      const now = new Date().toISOString();

      // Persist is_tie + winner_id on each match row so buildStateFromSupabase
      // can derive per-player outcomes. (player1_score / player2_score and the
      // per-row match_points + differential snapshots are already written by
      // the score-input UI in components/ui/match-edit.tsx — we don't touch
      // those denormalized snapshots here.)
      for (const match of matches) {
        let isTie = false;
        let winnerId: string | null = null;
        if (match.player1_score === match.player2_score) {
          isTie = true;
        } else if (match.player1_score > match.player2_score) {
          winnerId = match.player1_id.id;
        } else {
          winnerId = match.player2_id.id;
        }
        const { error: matchUpdateError } = await client
          .from("matches")
          .update({ is_tie: isTie, winner_id: winnerId })
          .eq("id", match.id);
        if (matchUpdateError) throw matchUpdateError;
      }

      // Recompute participant totals from full match + bye history.
      // This is the load-bearing fix for the double-count bug: totals are
      // always derived from history, never incremented. Editing a result and
      // re-running this yields the correct total regardless of prior writes.
      // Byes are accounted for via state.byes inside recomputeTotalsFromHistory,
      // so no separate bye participants update is needed.
      const state = await buildStateFromSupabase(client, tournament.id);
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

      // Update the database
      const { error: roundError, data: roundData } = await client
        .from("rounds")
        .update({
          ended_at: now,
          is_completed: true,
        })
        .eq("tournament_id", tournament.id)
        .eq("round_number", round);

      if (roundError) throw roundError;

      if (round === tournament.n_rounds) {
        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            has_ended: true,
            ended_at: now,
          })
          .eq("id", tournament.id);

        if (tournamentError) throw tournamentError;

        setTournament((prev) => ({
          ...prev,
          has_ended: true,
        }));

        fetchTournamentDetails();
      } else {
        // Creating the pairing for the next round
        await createPairingForRound(round + 1);

        // Same reason as handleEndRound in TournamentRounds: the recompute
        // a few lines above ran before the next round's bye was staged, so
        // the bye recipient's match_points lag by +3 until the next recompute
        // fires. Re-run it now to keep the standings invariant from breaking
        // transiently during round N+1.
        const { error: recomputeError } = await client.rpc(
          "recompute_participant_totals",
          { p_tournament_id: tournament.id },
        );
        if (recomputeError) console.log(recomputeError);

        const { error: tournamentError } = await client
          .from("tournaments")
          .update({
            current_round: (tournament.current_round || 0) + 1,
          })
          .eq("id", tournament.id);

        if (tournamentError) throw tournamentError;
      }

      // Update local state after successful database updates
      setIsRoundActive(false);
      setLatestRound((prev) => ({ ...prev, round_number: round, ended_at: now }));
    } catch (error) {
      console.error("Error ending round:", error);
    }
  }, [tournament]);

  const handleStartTournament = async (
    numberOfRounds: number,
    roundLength: number,
    maxScore: number,
    byePoints: number,
    byeDifferential: number,
    startingTableNumber: number,
    soundNotifications: boolean
  ) => {
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from("tournaments")
        .update({
          has_started: true,
          has_ended: false,
          started_at: now,
          ended_at: null,
          n_rounds: numberOfRounds,
          current_round: 1,
          round_length: roundLength,
          max_score: maxScore,
          bye_points: byePoints,
          bye_differential: byeDifferential,
          starting_table_number: startingTableNumber,
          sound_notifications: soundNotifications,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      setTournament(data);
      setShowStartModal(false);
      // Creating pairing for the first round if the user has started the tournament.
      await createPairing(data.id, 1);
      setActiveTab(1);
      showToast("Tournament started successfully!", "success");
    } catch (error) {
      showToast("Error starting tournament.", "error");
      console.error("Error starting tournament:", error);
    }
  };

  const createPairingForRound = async (round: number) => {
    if (!tournament?.id) return false;
    const success = await createPairing(tournament.id, round);
    if (success) {
      showToast(`Round ${round} pairings created successfully!`, "success");
    } else {
      showToast(`Failed to create pairings for round ${round}`, "error");
    }
    return success;
  };

  const dropOutParticipant = async (id: string) => {
    const { error } = await supabase
      .from("participants")
      .update({ dropped_out: true })
      .eq("id", id);
    if (error) {
      console.error("Error dropping participant:", error);

      return false;
    }
    fetchParticipants();
    // Bump the pairings refresh nonce so the Rounds tab re-fetches matches/byes
    // and reflects the dropped player on next render (the current-round pairings
    // table doesn't re-render on participants change otherwise).
    setPairingsRefreshNonce((n) => n + 1);
    return true;
  }

  const dropInParticipant = async (id: string) => {
    const { error } = await supabase
      .from("participants")
      .update({ dropped_out: false })
      .eq("id", id);
    if (error) {
      console.error("Error dropping participant:", error);
      return false;
    }
    fetchParticipants();
    // Same reason as dropOutParticipant — keep the Rounds tab in sync.
    setPairingsRefreshNonce((n) => n + 1);
    return true;
  }

  // Re-fetch the current round's scored matches. This drives the re-pair
  // gating (disable "Re-pair current round" / surface "Unlock and re-pair…"),
  // so it must run whenever a result is entered — not just when the tournament
  // object changes. Exposed to the Rounds tab via onMatchesChanged below.
  const fetchScoredCurrentRoundMatches = useCallback(async () => {
    if (!tournament?.id || !tournament?.current_round) return;
    const { data: scoredMatchesData } = await supabase
      .from("matches")
      .select("id, player1_score, player2_score, player1:participants!matches_player1_id_fkey(name), player2:participants!matches_player2_id_fkey(name)")
      .eq("tournament_id", tournament.id)
      .eq("round", tournament.current_round)
      .not("player1_score", "is", null);
    setScoredCurrentRoundMatches((scoredMatchesData ?? []).map((m: any) => ({
      id: m.id,
      player1Name: m.player1?.name ?? "?",
      player2Name: m.player2?.name ?? "?",
      player1Score: m.player1_score,
      player2Score: m.player2_score,
    })));
  }, [tournament?.id, tournament?.current_round]);

  useEffect(() => {
    if (tournament) {
      (async () => {
        const client = createClient();

        const { data } = await client
          .from("rounds")
          .select("round_number, started_at, ended_at, is_completed")
          .eq("tournament_id", tournament.id)
          .eq("round_number", tournament.current_round)
          .maybeSingle();

        if (data) {
          setLatestRound(data);
          if (!data.is_completed && data.started_at && !data.ended_at) {
            setIsRoundActive(true);
          }
        }

        await fetchScoredCurrentRoundMatches();
      })();
    }
  }, [tournament, fetchScoredCurrentRoundMatches]);

  // Fetch data for the repair picker (completed rounds + all matches with names)
  useEffect(() => {
    if (!tournament?.id) return;
    const fetchPickerData = async () => {
      const client = createClient();
      const { data: rounds } = await client
        .from("rounds")
        .select("round_number")
        .eq("tournament_id", tournament.id)
        .eq("is_completed", true)
        .order("round_number", { ascending: false });
      setCompletedRoundNumbers((rounds ?? []).map((r: any) => r.round_number));

      const { data: ms } = await client
        .from("matches")
        .select("id, round, player1:participants!matches_player1_id_fkey(name), player2:participants!matches_player2_id_fkey(name)")
        .eq("tournament_id", tournament.id);
      setAllCompletedMatches((ms ?? []).map((m: any) => ({
        id: m.id,
        round: m.round,
        player1Name: m.player1?.name ?? "?",
        player2Name: m.player2?.name ?? "?",
      })));
    };
    fetchPickerData();
  }, [tournament?.id, scoredCurrentRoundMatches]);

  // Fetch full match row when picker selects a match
  useEffect(() => {
    if (!pickerRepairMatchId) {
      setPickerRepairMatch(null);
      return;
    }
    const fetchMatch = async () => {
      const client = createClient();
      const { data } = await client
        .from("matches")
        .select("id, round, player1_score, player2_score, player1_id:participants!matches_player1_id_fkey(id, name), player2_id:participants!matches_player2_id_fkey(id, name)")
        .eq("id", pickerRepairMatchId)
        .single();
      setPickerRepairMatch(data ?? null);
    };
    fetchMatch();
  }, [pickerRepairMatchId]);

  const fetchDecklists = useCallback(async () => {
    if (!id) return;
    const seq = ++decklistsSeqRef.current;
    const res = await loadTournamentDecklistsAction(id);
    if (res.success && seq === decklistsSeqRef.current) {
      setDecklists((prev) =>
        JSON.stringify(prev) === JSON.stringify(res.decklists) ? prev : res.decklists
      );
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchTournamentDetails();
      fetchParticipants();
      fetchDecklists();
      supabase.auth.getUser().then(({ data: { user } }) => {
        setCurrentUserId(user?.id ?? null);
      });
    }
  }, [id]);

  // Live check-in roster. QR joins and player deck submissions are written
  // server-side (admin RPC), so the host's open page has no way to learn about
  // them — before this, a host watching players scan the code saw nothing until
  // they hit refresh. Poll instead of realtime: the submission tables are
  // admin-only (RLS with no authenticated policy), so postgres_changes would
  // deliver the join but never the decklist.
  //
  // Scoped tight: only once the tournament row has actually loaded (a deleted
  // or RLS-denied id leaves `tournament` null forever behind the "not found"
  // screen — polling that would be free of charge to nobody), only before it
  // starts (joins are rejected after), and only while the tab is visible.
  useEffect(() => {
    if (!id || !tournament || tournament.has_started || tournament.has_ended) return;
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      // Decklists go through a server action, and Next runs those one at a
      // time. Letting ticks stack up behind a slow one would queue ahead of
      // whatever the host clicks next, so skip a tick rather than pile on.
      if (inFlight) return;
      inFlight = true;
      try {
        await Promise.all([fetchParticipants(), fetchDecklists()]);
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(refresh, CHECK_IN_POLL_MS);
    // A host tabbing back mid-check-in shouldn't wait out the interval.
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, tournament?.has_started, tournament?.has_ended, fetchParticipants, fetchDecklists]);

  const isHost = !!(tournament?.host_id && currentUserId && tournament.host_id === currentUserId);
  // Official events have no editable name: it's derived from date + tier +
  // category + location and regenerated by planEventTypeChange whenever any of
  // those change in Settings. A rename here would be silently overwritten by
  // the next Settings save — and worse, renameForEventType recovers the event
  // date by reading the "{Mon D, YYYY}" prefix back off the current name, so a
  // free-form rename makes it fall back to created_at (UTC) and can shift the
  // event's date by a day.
  const nameFrozen = isNameFrozen(tournament?.category ?? null);
  const numberingMode: "tables" | "seats" =
    tournament?.numbering_mode === "seats" ? "seats" : "tables";
  // "N of M participants have decklists" — tournament_decklists has at most
  // one row per participant, so decklists.length is exactly the submitted
  // count regardless of source (player QR submission or host attach).
  const decklistSummary =
    tournament?.require_decklists === true
      ? { submitted: decklists.length, total: participants.length }
      : null;

  return (
    <div className="flex min-h-screen px-3 sm:px-5 w-full jayden-gradient-bg">
      <div className="w-full max-w-4xl mx-auto space-y-5">
        <Breadcrumb
          items={[
            { label: "Tournaments", href: "/tracker/tournaments" },
            { label: tournament?.name || "Loading..." },
          ]}
        />
        <ToastNotification
          message={toast.message}
          show={toast.show}
          onClose={() => setToast((prev) => ({ ...prev, show: false }))}
          type={toast.type}
        />
        
        <div className="flex-grow max-w-4xl mx-auto">
          {tournamentNotFound && !tournament && (
            <div className="my-12 rounded-lg border border-border bg-card p-8 text-center">
              <h2 className="text-xl font-semibold text-foreground">
                Tournament not found
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                It may have been deleted, or the link is wrong.
              </p>
              <Link
                href="/tracker/tournaments"
                className="mt-4 inline-block px-3 py-2 rounded-md border border-border text-foreground hover:bg-muted text-sm"
              >
                Back to tournaments
              </Link>
            </div>
          )}
          {!tournament && !tournamentNotFound && (
            <header
              className="print:hidden sticky top-0 z-30 -mx-3 sm:-mx-5 mb-4 px-3 sm:px-5 py-3 backdrop-blur bg-background/80 border-b border-border"
            >
              <div className="h-16 animate-pulse rounded-md bg-muted/30" />
            </header>
          )}
          {tournament && (
            <>
              <RepairTournamentBanner
                tournamentId={tournament.id}
                currentRound={tournament.current_round ?? 1}
                isRoundActive={isRoundActive}
              />
              <header
                className="print:hidden relative sticky top-0 z-30 -mx-3 sm:-mx-5 mb-4 px-3 sm:px-5 py-3 backdrop-blur bg-background/80 border-b border-border"
              >
                {/* Thin progress bar at the very top edge — ambient "how much
                    time is left" signal, only mounted while a round is live. */}
                {tournament?.has_started &&
                  !tournament?.has_ended &&
                  tournament?.round_length &&
                  latestRound?.started_at &&
                  !latestRound?.is_completed && (
                    <RoundProgressBar
                      key={latestRound?.started_at || "inactive"}
                      startTime={latestRound?.started_at || null}
                      durationMinutes={tournament.round_length}
                    />
                  )}
                {/* Row 1: identity + status + timer + overflow menu */}
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold max-w-full">
                    {nameFrozen ? (
                      <span title="Official events use standardized names. Change the tier, category, or location in Settings to update it.">
                        {tournament.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setNewTournamentName(tournament.name);
                          setIsEditTournamentModalOpen(true);
                        }}
                        className="group inline-flex items-center gap-2 -mx-1 px-1 py-0.5 rounded-md text-left hover:bg-muted transition-colors max-w-full"
                        aria-label="Edit tournament name"
                      >
                        <span>{tournament.name}</span>
                        <HiPencil className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    )}
                  </h1>
                  {/* Status pill — neutral hierarchy:
                      amber=not started, foreground=in progress, muted=ended. */}
                  <span
                    className={`text-base font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${
                      tournament.has_ended
                        ? "bg-muted text-muted-foreground"
                        : tournament.has_started
                          ? "bg-foreground/10 text-foreground"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {tournament.has_ended
                      ? "Ended"
                      : tournament.has_started
                        ? `Round ${tournament.current_round || 1} of ${tournament.n_rounds || "?"}`
                        : "Not Started"}
                  </span>

                  {/* Timer — only render while a round is actually in progress.
                      Without these guards the timer shows a fake "00:45:00"
                      between rounds (F4). */}
                  {tournament?.has_started &&
                    !tournament?.has_ended &&
                    tournament?.round_length &&
                    latestRound?.started_at &&
                    !latestRound?.is_completed && (
                      <CountdownTimer
                        key={latestRound?.started_at || "inactive"}
                        startTime={latestRound?.started_at || null}
                        durationMinutes={tournament.round_length}
                        soundNotifications={tournament.sound_notifications ?? false}
                      />
                    )}

                  {/* Push actions to the right */}
                  <div className="ml-auto flex items-center gap-2">
                    {/* Start Tournament — primary pre-start action stays inline so
                        a host can see it without opening the menu. Filled amber,
                        not green: it echoes the "Not Started" status pill it sits
                        beside, and the filled green CTA belongs to the
                        Participants toolbar (Add Participant) — two greens on one
                        screen made it unclear which action came first. */}
                    {!tournament?.has_started && !tournament?.has_ended && (
                      <Button
                        disabled={participants.length === 0 || togglingStatus}
                        onClick={handleTournamentStatusToggle}
                        className="bg-amber-500 text-amber-950 hover:bg-amber-400 font-semibold shadow-sm"
                      >
                        <Play className="w-4 h-4 mr-1.5 fill-current" />
                        Start Tournament
                      </Button>
                    )}
                    {tournament?.has_ended && (
                      <span className="text-xs text-muted-foreground italic whitespace-nowrap">
                        Tournament has ended
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: condensed dates — hidden on mobile to reclaim chrome. */}
                <p className="hidden sm:block text-xs text-muted-foreground mt-1">
                  Created {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  }).format(new Date(tournament.created_at))}
                  {tournament.started_at && (
                    <> · Started {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(tournament.started_at))}</>
                  )}
                  {tournament.ended_at && (
                    <> · Ended {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(tournament.ended_at))}</>
                  )}
                </p>
              </header>

              {/* Backstop for the gate above: a frozen event has no rename
                  path at all, whatever the modal's open state says. */}
              <EditTournamentNameModal
                isOpen={isEditTournamentModalOpen && !nameFrozen}
                onClose={() => setIsEditTournamentModalOpen(false)}
                onSave={async () => {
                  try {
                    const { error } = await supabase
                      .from("tournaments")
                      .update({ name: newTournamentName })
                      .eq("id", id);

                    if (error) throw error;

                    setTournament((prev) => ({
                      ...prev,
                      name: newTournamentName,
                    }));
                    setIsEditTournamentModalOpen(false);
                    showToast(
                      "Tournament name updated successfully!",
                      "success"
                    );
                  } catch (error) {
                    console.error("Error updating tournament name:", error);
                    showToast("Error updating tournament name", "error");
                  }
                }}
                tournamentName={newTournamentName}
                setTournamentName={setNewTournamentName}
              />

              {participants.length === 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  Add participants to get started
                </p>
              )}

              {/* Publish decklists section — kept inline below the header since
                  it's a substantial post-tournament panel, not a quick action. */}
              {tournament?.has_ended && (
                <div className="mb-4">
                  <PublishDecklistsSection
                    tournamentId={tournament.id}
                    tournamentEnded={tournament.has_ended}
                    decklistCount={decklists.length}
                    isPublished={tournament.decklists_published || false}
                    currentFormat={tournament.deck_format || null}
                    resultsPublished={tournament.results_published || false}
                    onPublishChange={() => {
                      fetchTournamentDetails();
                      fetchDecklists();
                    }}
                  />
                </div>
              )}

              {/* Re-pair dialog — controlled by overflow menu; the dialog UI
                  itself stays in RegeneratePairingsButton. */}
              {isHost && tournament.has_started && !tournament.has_ended && (
                <RegeneratePairingsButton
                  tournamentId={tournament.id}
                  currentRound={tournament.current_round ?? 1}
                  scoredMatchCount={scoredCurrentRoundMatches.length}
                  isRoundCompleted={latestRound?.is_completed ?? false}
                  onComplete={() => {
                    fetchTournamentDetails();
                    setPairingsRefreshNonce((n) => n + 1);
                  }}
                  onUnlockRequest={() => setUnlockDialogOpen(true)}
                  hideTrigger
                  open={repairDialogOpen}
                  onOpenChange={setRepairDialogOpen}
                />
              )}
              {isHost && tournament && (
                <UnlockAndRepairDialog
                  open={unlockDialogOpen}
                  onClose={() => setUnlockDialogOpen(false)}
                  tournamentId={tournament.id}
                  scoredMatches={scoredCurrentRoundMatches}
                  onComplete={() => {
                    fetchTournamentDetails();
                    setPairingsRefreshNonce((n) => n + 1);
                  }}
                />
              )}
            </>
          )}
          {!tournamentNotFound && <TournamentTabs
            participants={participants}
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            isHost={isHost}
            numberingMode={numberingMode}
            onAddParticipant={handleAddParticipant}
            onEdit={(participant) => {
              setCurrentParticipant(participant);
              setNewParticipantName(participant.name);
              setNewParticipantSeat(participant.assigned_seat != null ? String(participant.assigned_seat) : "");
              setIsEditParticipantModalOpen(true);
            }}
            setLatestRound={setLatestRound}
            onDelete={deleteParticipant}
            onDropOut={dropOutParticipant}
            onDropIn={dropInParticipant}
            loading={loading}
            tournamentId={id || ""}
            tournamentStarted={tournament?.has_started || false}
            tournamentEnded={tournament?.has_ended || false}
            tournamentName={tournament?.name}
            tournamentFormat={tournament?.deck_format || null}
            onTournamentEnd={async () => {
              // End Round writes new match_points/differential to participants;
              // refresh both so Standings doesn't render stale zeros.
              await Promise.all([fetchTournamentDetails(), fetchParticipants()]);
            }}
            // Fires only when the FINAL round's End Round button completes the
            // tournament — the common way tournaments end (no confirm dialog
            // exists on this path, unlike the admin-menu End Tournament flow),
            // so it always publishes.
            onTournamentAutoPublish={() => publishOnEnd(true)}
            onRoundActiveChange={(isActive, roundStartTime) => {
              setIsRoundActive(isActive);
              fetchTournamentDetails();
            }}
            createPairing={createPairingForRound}
            matchErrorIndex={matchErrorIndex}
            setMatchErrorIndex={setMatchErrorIndex}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            fetchParticipants={fetchParticipants}
            decklists={decklists}
            onDecklistsChange={fetchDecklists}
            usernames={usernames}
            onOpenQrJoin={() => setQrJoinDialogOpen(true)}
            onOpenLiveRound={() => setLiveRoundDialogOpen(true)}
            onTournamentUpdated={fetchTournamentDetails}
            decklistSummary={decklistSummary}
            onRepairCompleted={() => {
              fetchParticipants();
              fetchTournamentDetails();
              // Editing a result rewrites the match's winner_id/is_tie. Standings
              // computes the W-L-T record from its own matches fetch (keyed on
              // this nonce), so without the bump MP updates but the record goes
              // stale — showing a win as a loss until a full reload.
              setPairingsRefreshNonce((n) => n + 1);
            }}
            matchesRefreshNonce={pairingsRefreshNonce}
            currentRound={tournament?.current_round ?? null}
            onMatchesChanged={() => {
              fetchScoredCurrentRoundMatches();
              // A score was just entered/edited mid-round. Bump the standings
              // nonce so StandingsTable re-fetches matches and updates MP / Diff
              // / W-L-T live — otherwise it keeps the scoreless matches it
              // fetched at round start and only the bye shows until End Round.
              // Loop-safe: the nonce-driven refetch in TournamentRounds calls
              // fetchCurrentRoundData (which does NOT re-notify).
              setPairingsRefreshNonce((n) => n + 1);
            }}
            onRoundStarted={() => {
              // Starting a round makes its bye score (Option C). Pull fresh
              // participant totals and bump the standings nonce so MP and the
              // W-L-T / Byes columns reflect the now-counting bye together.
              fetchParticipants();
              setPairingsRefreshNonce((n) => n + 1);
            }}
            adminMenu={
              isHost && tournament?.has_started && !tournament?.has_ended ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Admin actions"
                      className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-border text-foreground hover:bg-muted"
                    >
                      <Wrench className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    {/* Two distinct families: "Pairings" actions change who
                        plays whom this round; "Results" actions correct a
                        recorded score. Grouped + relabeled so "re-pair" (the
                        pairing verb) no longer collides with fixing a result. */}
                    <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pairings
                    </DropdownMenuLabel>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onSelect={() => setRepairDialogOpen(true)}
                        disabled={
                          (latestRound?.is_completed ?? false) ||
                          scoredCurrentRoundMatches.length > 0
                        }
                      >
                        <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                        Regenerate pairings
                      </DropdownMenuItem>
                      {scoredCurrentRoundMatches.length > 0 && (
                        <DropdownMenuItem onSelect={() => setUnlockDialogOpen(true)}>
                          <Unlock className="w-4 h-4 mr-2" aria-hidden="true" />
                          Unlock &amp; regenerate…
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                    {completedRoundNumbers.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Results
                        </DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
                          <SquarePen className="w-4 h-4 mr-2" aria-hidden="true" />
                          Edit a past result
                        </DropdownMenuItem>
                      </>
                    )}
                    {/* End tournament is only exposed on the final round —
                        no always-present "master end" control. */}
                    {(tournament?.current_round ?? 0) >= (tournament?.n_rounds ?? 0) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => setEndTournamentConfirmOpen(true)}
                          disabled={togglingStatus}
                          className="text-destructive focus:text-destructive"
                        >
                          {togglingStatus ? "Ending…" : "End tournament"}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
            onRoundEnded={() => {
              // End Round writes the next round's pairings + bye. Bump the
              // pairings nonce so the matches/byes fetch picks them up
              // (the local fetchCurrentRoundData refetches via currentPage
              // changing, but Standings and any other readers need the nonce).
              setPairingsRefreshNonce((n) => n + 1);
            }}
          />}
        </div>
        <RepairPastResultPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          completedRounds={completedRoundNumbers}
          currentRound={tournament?.current_round ?? null}
          matches={allCompletedMatches}
          onPick={(matchId) => setPickerRepairMatchId(matchId)}
        />
        {pickerRepairMatch && tournament && (
          <MatchEditModal
            match={pickerRepairMatch}
            tournament={tournament}
            mode="repair"
            // Reason only applies when correcting a PAST round; a current-round
            // match (e.g. the final round) doesn't need one.
            showReason={pickerRepairMatch.round !== tournament.current_round}
            open={true}
            onOpenChange={(v) => { if (!v) setPickerRepairMatchId(null); }}
            isRoundActive={false}
            setMatchErrorIndex={() => {}}
            index={-1}
            onRepairSuccess={() => {
              fetchTournamentDetails();
              fetchParticipants();
              // Refresh Standings' matches fetch so the W-L-T record picks up
              // the new winner_id/is_tie (see onRepairCompleted above).
              setPairingsRefreshNonce((n) => n + 1);
              setPickerRepairMatchId(null);
            }}
          />
        )}
        <EditParticipantModal
          isOpen={isEditParticipantModalOpen}
          onClose={() => setIsEditParticipantModalOpen(false)}
          participant={currentParticipant}
          onSave={updateParticipant}
          newParticipantName={newParticipantName}
          setNewParticipantName={setNewParticipantName}
          numberingMode={numberingMode}
          seatValue={newParticipantSeat}
          setSeatValue={setNewParticipantSeat}
        />
        <TournamentStartModal
          isOpen={showStartModal}
          onClose={() => setShowStartModal(false)}
          onConfirm={handleStartTournament}
          participantCount={participants.length}
          suggestedRounds={suggestNumberOfRounds(participants.length)}
          defaultRoundLength={tournament?.round_length}
          defaultMaxScore={tournament?.max_score}
          defaultByePoints={tournament?.bye_points}
          defaultByeDifferential={tournament?.bye_differential}
          defaultStartingTableNumber={tournament?.starting_table_number}
          defaultSoundNotifications={tournament?.sound_notifications}
          decklistSummary={decklistSummary}
        />
        {tournament && !tournament.has_started && !tournament.has_ended && (
          <QRJoinDialog
            tournament={tournament}
            isOpen={qrJoinDialogOpen}
            onClose={() => setQrJoinDialogOpen(false)}
            onTournamentUpdated={fetchTournamentDetails}
          />
        )}
        {tournament && (
          <LiveRoundDialog
            tournament={tournament}
            isOpen={liveRoundDialogOpen}
            onClose={() => setLiveRoundDialogOpen(false)}
            onTournamentUpdated={fetchTournamentDetails}
          />
        )}
        {tournament && (
          // Typed-confirmation gate — owner explicitly wanted a higher bar
          // than the standard ConfirmationDialog primitive for the only host
          // action that's truly irreversible.
          <EndTournamentDialog
            open={endTournamentConfirmOpen}
            onOpenChange={setEndTournamentConfirmOpen}
            tournamentName={tournament.name ?? ""}
            isEnding={togglingStatus}
            onConfirm={async (publish) => {
              await performEndTournament(publish);
              setEndTournamentConfirmOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
