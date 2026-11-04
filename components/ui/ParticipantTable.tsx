import React, { useMemo, useState } from "react";
import { Table } from "flowbite-react";
import { HiPencil, HiTrash } from "react-icons/hi";
import { BookOpen, CircleMinus, CirclePlus, Crown, Link2Off, RefreshCw } from "lucide-react";
import AttachDeckDialog from "./AttachDeckDialog";
import type { TournamentDecklistRow, DeckSearchResult } from "../../app/tracker/tournaments/actions";
import {
  attachDeckToParticipantAction,
  detachDeckFromParticipantAction,
  recheckAllSubmissionsAction,
  removeParticipantWithBlockAction,
} from "../../app/tracker/tournaments/actions";
import ConfirmationDialog from "./confirmation-dialog";
import { LegalityDot } from "./LegalityDot";
import ToastNotification from "./toast-notification";
import { Dialog, DialogContent, DialogHeader, DialogFooter } from "./dialog";
import dynamic from "next/dynamic";

// The submission modal reaches the whole card catalog through lib/cards/lookup
// (findCard, to group the snapshot by type). It loads on demand so the catalog
// stays out of the host view's static bundle. The dialog is mounted (closed)
// with the table, so the chunk is fetched on mount rather than on the first
// open — no loading placeholder needed.
const SubmissionModal = dynamic(() => import("./SubmissionModal"), { ssr: false });

interface Participant {
  id: string;
  name: string;
  match_points: number;
  differential: number;
  dropped_out: boolean;
  assigned_seat?: number | null;
  user_id?: string | null;
}

interface ParticipantTableProps {
  tournamentStarted: boolean;
  participants: Participant[];
  onEdit: (participant: Participant) => void;
  onDelete: (id: string) => void;
  onDropOut: (id: string) => void;
  onDropIn: (id: string) => void;
  tournamentEnded?: boolean;
  tournamentId: string;
  // Tournament's raw deck_format column — passed through to AttachDeckDialog
  // for its attach gate. null/'Other' means "attach anything."
  tournamentFormat?: string | null;
  decklists: TournamentDecklistRow[];
  onDecklistsChange: () => void;
  numberingMode: "tables" | "seats";
  // participant.user_id -> profiles.username, batched once on the page.
  usernames?: Map<string, string>;
  isHost?: boolean;
  // Refreshes the participant roster — used after Remove & block deletes a row.
  fetchParticipants?: () => void;
}

const ParticipantTable: React.FC<ParticipantTableProps> = ({
  tournamentStarted,
  participants,
  onEdit,
  onDelete,
  onDropOut,
  onDropIn,
  tournamentEnded = false,
  tournamentId,
  tournamentFormat,
  decklists,
  onDecklistsChange,
  numberingMode,
  usernames = new Map(),
  isHost = false,
  fetchParticipants,
}) => {
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [attachTarget, setAttachTarget] = useState<Participant | null>(null);
  const [dropTarget, setDropTarget] = useState<Participant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null);
  const [removeBlockTarget, setRemoveBlockTarget] = useState<Participant | null>(null);
  const [submissionTarget, setSubmissionTarget] = useState<Participant | null>(null);
  // Detaching a player-submitted decklist deletes the immutable submission
  // record (spec §8) — that needs a confirmation step. Detaching a
  // host-attached deck (no submission) stays a single click.
  const [detachSubmissionTarget, setDetachSubmissionTarget] = useState<Participant | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    show: boolean;
    type?: "success" | "error" | "warning" | "info";
  }>({ message: "", show: false, type: "success" });

  const showToast = (
    message: string,
    type: "success" | "error" | "warning" | "info" = "success"
  ) => {
    setToast({ message, show: true, type });
  };

  const decklistMap = useMemo(() => {
    const map = new Map<string, TournamentDecklistRow>();
    for (const dl of decklists) {
      map.set(dl.participant_id, dl);
    }
    return map;
  }, [decklists]);

  // Participants tab is a roster view — sort alphabetically so hosts can find
  // players by name. Score-based ranking lives in the Standings tab.
  const sortedParticipants = useMemo(() =>
    [...participants].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    ),
    [participants]
  );

  // Winner crown still highlights the final-standings leader; compute it from
  // raw match_points/differential regardless of the alphabetical display order.
  const { winnerMatchPoints, winnerDifferential } = useMemo(() => {
    const ranked = [...participants].sort((a, b) => {
      const mpA = a.match_points !== null ? a.match_points : -Infinity;
      const mpB = b.match_points !== null ? b.match_points : -Infinity;
      if (mpA !== mpB) return mpB - mpA;
      const diffA = a.differential !== null ? a.differential : -Infinity;
      const diffB = b.differential !== null ? b.differential : -Infinity;
      return diffB - diffA;
    });
    return {
      winnerMatchPoints: ranked[0]?.match_points ?? 0,
      winnerDifferential: ranked[0]?.differential ?? 0,
    };
  }, [participants]);

  async function handleAttachDeck(deck: DeckSearchResult) {
    if (!attachTarget) return;
    const result = await attachDeckToParticipantAction(tournamentId, attachTarget.id, deck.id);
    if (result.success) {
      onDecklistsChange();
    }
  }

  async function handleDetachDeck(participantId: string) {
    const result = await detachDeckFromParticipantAction(participantId);
    if (result.success) {
      onDecklistsChange();
    }
  }

  async function handleRemoveWithBlock(participant: Participant, block: boolean) {
    setRemoveBlockTarget(null);
    const result = await removeParticipantWithBlockAction(tournamentId, participant.id, block);
    if (result.success) {
      fetchParticipants?.();
      showToast(
        block
          ? `Removed ${participant.name} and blocked their account from rejoining.`
          : `Removed ${participant.name}.`,
        "success"
      );
    } else {
      showToast("Error removing participant.", "error");
    }
  }

  // Season-boundary tool (spec §7): re-validates every submission against the
  // tournament's current format. No declared format -> no legality verdict is
  // possible, which the action reports as "format_required" — that's expected
  // configuration state, not a failure, so it gets an informational toast.
  async function handleRecheckAll() {
    const result = await recheckAllSubmissionsAction(tournamentId);
    if (result.success) {
      showToast(
        `${result.rechecked} re-checked, ${result.nowIllegal} now illegal`,
        result.nowIllegal > 0 ? "warning" : "success"
      );
      onDecklistsChange();
    } else if (result.error === "format_required") {
      showToast("Set a format for this tournament first, then re-check decklists.", "info");
    } else {
      showToast("Error re-checking decklists.", "error");
    }
  }

  function renderActionButtons(participant: Participant) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onEdit(participant)}
          className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
          aria-label={`Edit ${participant.name}`}
        >
          <HiPencil className="w-5 h-5" />
        </button>
        {tournamentStarted ? (
          participant.dropped_out ? (
            <button
              onClick={() => onDropIn(participant.id)}
              className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 touch-manipulation transition-colors"
              aria-label={`Restore ${participant.name}`}
              title="Restore participant"
            >
              <CirclePlus className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setDropTarget(participant)}
              className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
              aria-label={`Drop ${participant.name}`}
              title="Drop from tournament"
            >
              <CircleMinus className="w-5 h-5" />
            </button>
          )
        ) : (
          <button
            onClick={() =>
              participant.user_id != null
                ? setRemoveBlockTarget(participant)
                : setDeleteTarget(participant)
            }
            className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 touch-manipulation transition-colors"
            aria-label={`Delete ${participant.name}`}
            title="Remove participant"
          >
            <HiTrash className="w-5 h-5" />
          </button>
        )}
      </div>
    );
  }

  function renderDeckCell(participant: Participant) {
    const linkedDeck = decklistMap.get(participant.id);
    if (linkedDeck) {
      const sub = linkedDeck.submission;
      // The `decks` join fails when deck_id is null (deleted) or private/
      // inaccessible — loadTournamentDecklistsAction then falls back
      // deck_name to the literal "Unknown". Only link out when there's an
      // actual deck to land on.
      const linkable = linkedDeck.deck_id != null && linkedDeck.deck_name !== "Unknown";

      return (
        <div className="flex items-center gap-2 min-w-0">
          {sub ? (
            <button
              onClick={() => setSubmissionTarget(participant)}
              className="flex items-center gap-1.5 min-w-0 text-sm text-foreground hover:text-primary transition-colors"
              title={`${sub.deckName} — view submission`}
            >
              <LegalityDot isLegal={sub.isLegal} />
              <span className="truncate">{sub.deckName}</span>
            </button>
          ) : linkable ? (
            <a
              href={`/decklist/${linkedDeck.deck_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline truncate"
              title={linkedDeck.deck_name}
            >
              {linkedDeck.deck_name}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground truncate" title={linkedDeck.deck_name}>
              {linkedDeck.deck_name}
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
            {sub ? sub.cardCount : linkedDeck.deck_card_count}c
          </span>
          <button
            onClick={() =>
              sub ? setDetachSubmissionTarget(participant) : handleDetachDeck(participant.id)
            }
            className="p-1 -m-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
            title="Remove deck"
            aria-label={`Remove deck from ${participant.name}`}
          >
            <Link2Off className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => {
          setAttachTarget(participant);
          setAttachDialogOpen(true);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors group"
      >
        <BookOpen className="w-3.5 h-3.5" />
        <span className="group-hover:underline">Attach deck</span>
      </button>
    );
  }

  const hasAnySubmission = decklists.some((dl) => dl.submission !== null);

  return (
    <>
      {isHost && hasAnySubmission && (
        <div className="mb-3 flex justify-end">
          <button
            onClick={handleRecheckAll}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-check all decklists
          </button>
        </div>
      )}
      {/* Mobile card list */}
      <ul className="md:hidden space-y-2">
        {sortedParticipants.map((participant) => {
          const isWinner =
            participant.match_points === winnerMatchPoints &&
            participant.differential === winnerDifferential;
          return (
            <li
              key={participant.id}
              className={`rounded-lg border border-border bg-card p-3 ${
                isWinner && tournamentEnded ? "ring-1 ring-yellow-500/40 bg-yellow-500/5" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {isWinner && tournamentEnded && (
                      <Crown className="w-4 h-4 text-orange-300 flex-shrink-0" />
                    )}
                    <span className="font-medium text-foreground truncate">
                      {participant.name}
                    </span>
                    {participant.user_id != null && usernames.get(participant.user_id) && (
                      <span
                        className="text-xs text-muted-foreground flex-shrink-0"
                        title={`Joined via QR with account @${usernames.get(participant.user_id)}`}
                      >
                        @{usernames.get(participant.user_id)}
                      </span>
                    )}
                    {participant.dropped_out && (
                      <span className="text-destructive text-[11px] flex-shrink-0 uppercase tracking-wide">
                        Dropped
                      </span>
                    )}
                    {participant.assigned_seat != null && (
                      <span
                        className="text-[11px] font-semibold tabular-nums rounded px-1.5 py-0.5 bg-muted text-muted-foreground border border-border flex-shrink-0"
                        title={`Static ${numberingMode === "seats" ? "seat" : "table"} ${participant.assigned_seat}`}
                      >
                        {numberingMode === "seats" ? "S" : "T"}
                        {participant.assigned_seat}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">{renderDeckCell(participant)}</div>
                </div>
                <div className="flex-shrink-0">{renderActionButtons(participant)}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop table */}
      <div className="hidden md:block">
        <Table
          hoverable
          theme={{
            root: {
              base: "w-full text-left text-sm text-muted-foreground",
              shadow: "absolute left-0 top-0 -z-10 h-full w-full rounded-lg bg-card drop-shadow-md",
              wrapper: "relative",
            },
            head: {
              base: "group/head text-xs uppercase text-muted-foreground",
              cell: {
                base: "bg-muted px-6 py-3 group-first/head:first:rounded-tl-lg group-first/head:last:rounded-tr-lg",
              },
            },
            row: {
              base: "group/row",
              hovered: "hover:bg-muted/50",
            },
          }}
        >
          <Table.Head>
            <Table.HeadCell className="py-3">Name</Table.HeadCell>
            <Table.HeadCell className="py-3">Deck</Table.HeadCell>
            <Table.HeadCell className="py-3">
              <span className="sr-only">Actions</span>
            </Table.HeadCell>
          </Table.Head>
          <Table.Body>
            {sortedParticipants.map((participant) => {
              const isWinner =
                participant.match_points === winnerMatchPoints &&
                participant.differential === winnerDifferential;

              return (
                <Table.Row
                  key={participant.id}
                  className={`${isWinner && tournamentEnded ? "bg-yellow-500/5 dark:bg-yellow-500/10 border-yellow-500/20" : ""} `}
                >
                  <Table.Cell className="font-medium text-foreground py-3">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {isWinner && tournamentEnded && (
                        <Crown className="w-4 h-4 text-orange-300 flex-shrink-0" />
                      )}
                      <span className="truncate">{participant.name}</span>
                      {participant.user_id != null && usernames.get(participant.user_id) && (
                        <span
                          className="text-xs text-muted-foreground flex-shrink-0"
                          title={`Joined via QR with account @${usernames.get(participant.user_id)}`}
                        >
                          @{usernames.get(participant.user_id)}
                        </span>
                      )}
                      {participant.dropped_out && (
                        <span className="text-destructive text-[11px] flex-shrink-0 uppercase tracking-wide">Dropped</span>
                      )}
                      {participant.assigned_seat != null && (
                        <span
                          className="text-[11px] font-semibold tabular-nums rounded px-1.5 py-0.5 bg-muted text-muted-foreground border border-border flex-shrink-0"
                          title={`Static ${numberingMode === "seats" ? "seat" : "table"} ${participant.assigned_seat}`}
                        >
                          {numberingMode === "seats" ? "S" : "T"}
                          {participant.assigned_seat}
                        </span>
                      )}
                    </div>
                  </Table.Cell>

                  <Table.Cell className="py-3">
                    <div className="max-w-[200px]">{renderDeckCell(participant)}</div>
                  </Table.Cell>

                  <Table.Cell className="py-3">{renderActionButtons(participant)}</Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <AttachDeckDialog
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
        participantName={attachTarget?.name || ""}
        tournamentFormat={tournamentFormat}
        onSelect={handleAttachDeck}
      />

      <ConfirmationDialog
        open={dropTarget !== null}
        onOpenChange={(open) => { if (!open) setDropTarget(null); }}
        onConfirm={() => {
          if (dropTarget) onDropOut(dropTarget.id);
        }}
        variant="warning"
        title={dropTarget ? `Drop ${dropTarget.name}?` : ""}
        description="They will not appear in next round's pairings. You can restore them later from this list."
        confirmLabel="Drop player"
        cancelLabel="Cancel"
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
        }}
        variant="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : ""}
        description="This permanently removes them from the tournament."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      {/* Detach on a player-submitted row deletes the immutable submission
          record (spec §8) — unlike a host-attached deck, that needs a
          confirmation step. */}
      <ConfirmationDialog
        open={detachSubmissionTarget !== null}
        onOpenChange={(open) => { if (!open) setDetachSubmissionTarget(null); }}
        onConfirm={() => {
          if (detachSubmissionTarget) handleDetachDeck(detachSubmissionTarget.id);
        }}
        variant="destructive"
        title={detachSubmissionTarget ? `Remove ${detachSubmissionTarget.name}'s deck?` : ""}
        description="This player submitted this decklist themselves. Removing it deletes their submitted record — this cannot be undone."
        confirmLabel="Remove deck"
        cancelLabel="Cancel"
      />

      {/* Remove & block — user-linked rows only. ConfirmationDialog only
          supports a single confirm action, so this is a bespoke two-button
          confirm built from the same Dialog primitives. */}
      <Dialog
        open={removeBlockTarget !== null}
        onOpenChange={(open) => { if (!open) setRemoveBlockTarget(null); }}
      >
        <DialogContent size="md">
          <DialogHeader className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
            <h3 className="text-lg font-semibold text-foreground">
              {removeBlockTarget ? `Remove ${removeBlockTarget.name}?` : ""}
            </h3>
            <p className="text-sm text-muted-foreground">
              This permanently removes them from the tournament. They joined with a linked
              account — you can also block that account from rejoining this event.
            </p>
          </DialogHeader>
          <DialogFooter className="justify-end flex-wrap">
            <button
              onClick={() => setRemoveBlockTarget(null)}
              className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => removeBlockTarget && handleRemoveWithBlock(removeBlockTarget, false)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Remove
            </button>
            <button
              onClick={() => removeBlockTarget && handleRemoveWithBlock(removeBlockTarget, true)}
              className="px-4 py-2 text-sm font-medium text-white bg-red-800 hover:bg-red-900 rounded-lg transition-colors"
            >
              Remove &amp; block
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SubmissionModal
        open={submissionTarget !== null}
        onOpenChange={(open) => { if (!open) setSubmissionTarget(null); }}
        tournamentId={tournamentId}
        participantId={submissionTarget?.id ?? null}
        participantName={submissionTarget?.name ?? ""}
      />

      <ToastNotification
        message={toast.message}
        show={toast.show}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
      />
    </>
  );
};

export default ParticipantTable;
