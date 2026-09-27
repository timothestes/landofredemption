"use client";

import { Tabs } from "flowbite-react";
import PodGenerationModal from "./PodGenerationModal";
import { Dispatch, ReactNode, SetStateAction, useEffect, useRef, useState } from "react";
import { HiUserGroup } from "react-icons/hi";
import { FaGear, FaClipboardList, FaQrcode, FaTowerBroadcast } from "react-icons/fa6";
import { MdPeople } from "react-icons/md";
import TournamentSettings from "./TournamentSettings";
import TournamentRounds from "./TournamentRounds";
import ParticipantTable from "./ParticipantTable";
import ParticipantFormModal from "./participant-form-modal";
import StandingsTable, { printFinalStandingsFor } from "./StandingsTable";
import { HiPlus } from "react-icons/hi";
import { GiCardPickup } from "react-icons/gi";
import { HiOutlineChartBar } from "react-icons/hi2";
import { Button } from "./button";
import ExportTrackerButton from "./ExportTrackerButton";
import { AuditLogPanel } from "./AuditLogPanel";
import type { TournamentDecklistRow } from "../../app/tracker/tournaments/actions";

interface TournamentTabsProps {
  participants: any[];
  isModalOpen: boolean;
  setIsModalOpen: (value: boolean) => void;
  onAddParticipant: (name: string) => void;
  onEdit: (participant: any) => void;
  onDelete: (id: string) => void;
  onDropOut: (id: string) => void;
  onDropIn: (id: string) => void;
  loading: boolean;
  tournamentId: string;
  tournamentStarted?: boolean;
  tournamentEnded?: boolean;
  tournamentName?: string | null;
  // Tournament's raw deck_format column — threaded down to ParticipantTable's
  // AttachDeckDialog for its attach gate.
  tournamentFormat?: string | null;
  onTournamentEnd?: () => void;
  /** Fired only when the FINAL round's End Round button completes the
   * tournament (not on every round end, and not on the admin-menu End
   * Tournament path, which handles its own publish choice separately). */
  onTournamentAutoPublish?: () => void | Promise<void>;
  setLatestRound: Dispatch<SetStateAction<any>>;
  onRoundActiveChange?: (
    isActive: boolean,
    roundStartTime: string | null
  ) => void;
  createPairing: (round: number) => void;
  matchErrorIndex: any;
  setMatchErrorIndex: Dispatch<SetStateAction<any>>;
  activeTab: number;
  setActiveTab: Dispatch<SetStateAction<number>>;
  fetchParticipants: () => void;
  decklists: TournamentDecklistRow[];
  onDecklistsChange: () => void;
  isHost?: boolean;
  // participant.user_id -> profiles.username, batched once on the page —
  // threaded down to ParticipantTable's account-linkage badge.
  usernames?: Map<string, string>;
  /** Opens the QR Join dialog (mounted at the page level). */
  onOpenQrJoin?: () => void;
  /** Opens the player-facing live pairings & standings link dialog (page level). */
  onOpenLiveRound?: () => void;
  /** Fired after Tournament Settings persists a change, so the page header
   * picks up a rename from the Event Type section. */
  onTournamentUpdated?: () => void;
  /** "N of M participants have decklists" — only meaningful pre-start when
   * the tournament requires decklists; null hides the line entirely. */
  decklistSummary?: { submitted: number; total: number } | null;
  numberingMode: "tables" | "seats";
  onRepairCompleted?: () => void;
  matchesRefreshNonce?: number;
  onRoundEnded?: () => void | Promise<void>;
  currentRound?: number | null;
  /** Host admin menu (wrench) rendered inside the Rounds tab. */
  adminMenu?: ReactNode;
  /** Fired when a match result changes so the page can refresh re-pair gating. */
  onMatchesChanged?: () => void;
  /** Fired after a round is started (a started round's bye begins scoring). */
  onRoundStarted?: () => void;
}

export default function TournamentTabs({
  participants,
  isModalOpen,
  setIsModalOpen,
  onAddParticipant,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
  loading,
  tournamentId,
  tournamentStarted = false,
  tournamentEnded = false,
  tournamentName,
  tournamentFormat,
  onTournamentEnd,
  onTournamentAutoPublish,
  setLatestRound,
  createPairing,
  matchErrorIndex,
  setMatchErrorIndex,
  activeTab,
  setActiveTab,
  fetchParticipants,
  decklists,
  onDecklistsChange,
  isHost = false,
  usernames,
  onOpenQrJoin,
  onOpenLiveRound,
  onTournamentUpdated,
  decklistSummary,
  numberingMode,
  onRepairCompleted,
  matchesRefreshNonce,
  onRoundEnded,
  currentRound,
  adminMenu,
  onMatchesChanged,
  onRoundStarted,
}: TournamentTabsProps) {
  // state for booster draft pods
  const [showPodsModal, setShowPodsModal] = useState(false);
  const [podSize, setPodSize] = useState(4);
  const [pods, setPods] = useState<any[][]>([]);
  const tabsRef = useRef(null);
  const addParticipantButtonRef = useRef<HTMLButtonElement>(null);

  // Use effect to programmatically change tabs when activeTab state changes
  useEffect(() => {
    if (tabsRef.current) {
      tabsRef.current.setActiveTab(activeTab);
    }

    if (activeTab === 0) {
      fetchParticipants();
    }
  }, [activeTab]);
  return (
    <>
      <Tabs
      ref={tabsRef}
      aria-label="Tournament tabs"
      style={{ marginTop: "1rem" }}
      onActiveTabChange={(tab) => setActiveTab(tab)}
      theme={{
        tablist: {
          base: "flex text-center overflow-x-auto no-scrollbar",
          variant: {
            default: "border-b border-border",
          },
          tabitem: {
            base: "flex items-center justify-center px-3 py-2.5 sm:px-4 sm:py-4 text-sm font-medium first:ml-0 focus:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground whitespace-nowrap -mb-px border-b-2 border-transparent",
            variant: {
              default: {
                base: "",
                active: {
                  // The active tab now signals primacy via foreground text +
                  // a thin foreground underline rather than the bright accent.
                  on: "text-foreground font-semibold border-foreground",
                  off: "text-muted-foreground hover:text-foreground",
                },
              },
            },
          },
        },
      }}
    >
      <Tabs.Item title="Participants" icon={HiUserGroup}>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
          <h2 className="text-2xl font-bold">
            Participants{participants.length > 0 && ` (${participants.length})`}
          </h2>
          <div className="flex items-center gap-2 justify-end flex-wrap">
            {/* generate pods button only if more than one participant and tournament hasn't ended */}
            {participants.length > 1 && !tournamentEnded && (
              <Button
                type="button"
                onClick={() => setShowPodsModal(true)}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <GiCardPickup className="w-4 h-4" />
                <span className="hidden sm:inline">Pods</span>
              </Button>
            )}
            {tournamentEnded && (
              <Button
                onClick={() => printFinalStandingsFor(tournamentId, participants, tournamentName || "Tournament")}
                variant="accent"
                size="sm"
              >
                <span className="hidden sm:inline">Print Final Standings</span>
                <span className="sm:hidden">Print</span>
              </Button>
            )}
            {/* QR Join — same eligibility window as the Start button: the
                join code can only be generated/used before the tournament
                has started, and it's moot once the event has ended. */}
            {!tournamentStarted && !tournamentEnded && onOpenQrJoin && (
              <Button
                type="button"
                onClick={onOpenQrJoin}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <FaQrcode className="w-4 h-4" />
                <span className="hidden sm:inline">QR Join</span>
              </Button>
            )}
            {/* Live view — the players' /t/[code] page. Useful in every
                phase: before Start it says "hasn't started yet", after the
                end it shows final standings. */}
            {onOpenLiveRound && (
              <Button
                type="button"
                onClick={onOpenLiveRound}
                variant="outline"
                size="sm"
                className="gap-1.5"
                title="Live pairings & standings for players"
              >
                <FaTowerBroadcast className="w-4 h-4" />
                <span className="hidden sm:inline">Live view</span>
              </Button>
            )}
            {!tournamentEnded && (
              <div className="relative group">
                <Button
                  ref={addParticipantButtonRef}
                  onClick={() => !tournamentStarted && setIsModalOpen(true)}
                  className={`flex items-center gap-2 ${tournamentStarted ? "opacity-50 cursor-not-allowed" : ""}`}
                  variant="success"
                  disabled={tournamentStarted}
                >
                  <div className="flex items-center gap-2">
                    <HiPlus className="w-5 h-5" />
                    <span className="hidden sm:inline">Add Participant</span>
                    <span className="sm:hidden">Add</span>
                  </div>
                </Button>
                {tournamentStarted && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-foreground text-background text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                    Cannot add participants after tournament has started
                    <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-foreground"></div>
                  </div>
                )}
              </div>
            )}
            <ParticipantFormModal
              isOpen={isModalOpen}
              existingNames={participants.map((p) => p.name)}
              onClose={() => {
                setIsModalOpen(false);
                setTimeout(() => {
                  addParticipantButtonRef.current?.focus();
                }, 0);
              }}
              onSubmit={(name) => {
                onAddParticipant(name);
                setIsModalOpen(false);
                setTimeout(() => {
                  addParticipantButtonRef.current?.focus();
                }, 0);
              }}
            />
          </div>
        </div>
        {!tournamentStarted && decklistSummary && (
          <p className="text-sm text-muted-foreground -mt-4 mb-4">
            <span className="font-medium text-foreground">
              {decklistSummary.submitted} of {decklistSummary.total}
            </span>{" "}
            participants have decklists
          </p>
        )}
        {loading ? (
          <p>Loading participants...</p>
        ) : participants.length === 0 ? (
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            <div className="rounded-lg border border-border bg-card jayden-gradient-bg shadow-sm">
              <div className="flex flex-col items-center justify-center py-12 px-6">
                <p className="text-foreground font-medium mb-2">No participants found</p>
                <p className="text-sm text-muted-foreground">
                  Add participants to get started
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            <ParticipantTable
              tournamentStarted={tournamentStarted}
              tournamentEnded={tournamentEnded}
              participants={participants}
              onEdit={onEdit}
              onDelete={onDelete}
              onDropOut={onDropOut}
              onDropIn={onDropIn}
              tournamentId={tournamentId}
              tournamentFormat={tournamentFormat}
              decklists={decklists}
              onDecklistsChange={onDecklistsChange}
              numberingMode={numberingMode}
              usernames={usernames}
              isHost={isHost}
              fetchParticipants={fetchParticipants}
            />
          </div>
        )}
      </Tabs.Item>
      <Tabs.Item
        title={
          <div className="relative group">
            Rounds
            {!tournamentStarted && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-4 px-3 py-2 bg-foreground text-background text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                Add participants and start the tournament to enable this tab
                <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-1 border-4 border-transparent border-t-foreground"></div>
              </div>
            )}
          </div>
        }
        icon={MdPeople}
        disabled={!tournamentStarted}
      >
        <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
          <TournamentRounds
            tournamentId={tournamentId}
            isActive={activeTab === 1}
            key={activeTab} // Force re-render when tab becomes active
            onTournamentEnd={onTournamentEnd}
            onTournamentEnded={() => {
              setActiveTab(2); // jump to Standings (index 2) when the tournament finishes
              onTournamentAutoPublish?.();
            }}
            setLatestRound={setLatestRound}
            createPairing={createPairing}
            matchErrorIndex={matchErrorIndex}
            setMatchErrorIndex={setMatchErrorIndex}
            activeTab={activeTab}
            tournamentName={tournamentName}
            isHost={isHost}
            onRepairCompleted={onRepairCompleted}
            matchesRefreshNonce={matchesRefreshNonce}
            onRoundEnded={onRoundEnded}
            adminMenu={adminMenu}
            onMatchesChanged={onMatchesChanged}
            onRoundStarted={onRoundStarted}
          />
        </div>
      </Tabs.Item>
      {tournamentStarted && (
        <Tabs.Item title="Standings" icon={HiOutlineChartBar}>
          <div className="w-full max-w-[800px] mx-auto overflow-x-auto">
            {(tournamentEnded || isHost) && (
              <div className="flex justify-end gap-2 mb-4">
                {isHost && (
                  <ExportTrackerButton
                    tournamentId={tournamentId}
                    tournamentName={tournamentName || "Tournament"}
                  />
                )}
                {tournamentEnded && (
                  <Button
                    onClick={() => printFinalStandingsFor(tournamentId, participants, tournamentName || "Tournament")}
                    variant="accent"
                    size="sm"
                  >
                    <span className="hidden sm:inline">Print Final Standings</span>
                    <span className="sm:hidden">Print</span>
                  </Button>
                )}
              </div>
            )}
            <StandingsTable
              tournamentId={tournamentId}
              participants={participants as any}
              tournamentEnded={tournamentEnded}
              matchesRefreshNonce={matchesRefreshNonce}
              currentRound={tournamentEnded ? null : currentRound}
            />
          </div>
        </Tabs.Item>
      )}
      <Tabs.Item title="Settings" icon={FaGear}>
        <div className="w-full">
          <TournamentSettings
            tournamentId={tournamentId}
            participantCount={participants.length}
            onTournamentUpdated={onTournamentUpdated}
            key={activeTab} // Force re-render when tab becomes active
          />
        </div>
      </Tabs.Item>
      {isHost && (
        <Tabs.Item
          title={
            <>
              <span className="hidden sm:inline">Audit log</span>
              <span className="sm:hidden">History</span>
            </>
          }
          icon={FaClipboardList}
        >
          <div className="w-full max-w-[800px] mx-auto">
            <AuditLogPanel
              tournamentId={tournamentId}
              key={activeTab} // Re-fetch edits when the tab becomes active
            />
          </div>
        </Tabs.Item>
      )}
    </Tabs>
    {/* use external pod generation modal */}
    <PodGenerationModal
      show={showPodsModal}
      participants={participants}
      onClose={() => setShowPodsModal(false)}
    />
  </>
  );
}
