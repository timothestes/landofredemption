"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { diffCards, summarizeDiff } from "@/app/forge/lib/cardDiff";
import { acceptProposal, denyProposal, type ProposalRow } from "@/app/forge/lib/proposals";
import { addComment } from "@/app/forge/lib/comments";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { denyDraftPlan, draftMovedOnNote, ACCEPT_CLOSED_NOTE, DENY_FLUSH_FAILED } from "@/app/forge/lib/lifecycleCopy";
import { flushThen, runAcceptProposal } from "@/app/forge/lib/proposeFlow";
import { proposalByline } from "@/app/forge/lib/reviewView";
import FieldChanges from "./FieldChanges";
import { useStudioDraft, useStudioSync } from "./StudioSyncContext";

// The Deny dialog's contents. Its own component so that reading the live draft re-renders
// only this, and only while the dialog is open.
function DenyDialogBody({
  proposal,
  savedDraft,
  latestVersion,
  reason,
  setReason,
  onCancel,
  onDenied,
}: {
  proposal: ProposalRow;
  savedDraft: DesignCard;
  latestVersion: { versionNumber: number; data: DesignCard } | null;
  reason: string;
  setReason: (reason: string) => void;
  onCancel: () => void;
  onDenied: () => void;
}) {
  const { flushPending } = useStudioSync();
  const draft = useStudioDraft() ?? savedDraft;
  const plan = denyDraftPlan({ draft, proposed: proposal.proposedSnapshot, latest: latestVersion });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [restore, setRestore] = useState(plan.defaultRestore);

  const doDeny = () =>
    start(async () => {
      setErr(null);
      // Restoring writes the snapshot server-side, so a pending autosave has to land
      // first or it would overwrite the result. See StudioSyncContext.
      const r = restore && plan.offer
        ? await flushThen(
            flushPending,
            () => denyProposal(proposal.id, proposal.cardId, reason, true),
            { ok: false, error: DENY_FLUSH_FAILED },
          )
        : await denyProposal(proposal.id, proposal.cardId, reason);
      if (!r.ok) { setErr(r.error ?? "Could not deny proposal"); return; }
      onDenied();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Deny proposal</DialogTitle>
        <DialogDescription>The reason is recorded in the proposal history.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">Reason</label>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being denied?"
            className="h-24 w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>
        {plan.offer && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">The draft</legend>
            <label className="flex items-start gap-2 py-1 text-sm">
              <input type="radio" name={`deny-draft-${proposal.id}`} className="mt-1 text-primary focus:ring-0 focus:ring-offset-0" checked={restore} onChange={() => setRestore(true)} />
              <span>
                {plan.restoreLabel}
                <span className="block text-xs text-muted-foreground">{plan.restoreHint}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1 text-sm">
              <input type="radio" name={`deny-draft-${proposal.id}`} className="mt-1 text-primary focus:ring-0 focus:ring-offset-0" checked={!restore} onChange={() => setRestore(false)} />
              <span>
                {plan.keepLabel}
                <span className="block text-xs text-muted-foreground">{plan.keepHint}</span>
              </span>
            </label>
          </fieldset>
        )}
        {plan.note && <p className="text-xs text-muted-foreground">{plan.note}</p>}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={pending || !reason.trim()} onClick={doDeny}>
          Deny proposal
        </Button>
      </DialogFooter>
    </>
  );
}

// Its own component so that reading the live draft re-renders only this per keystroke.
function DraftMovedOn({ proposed, savedDraft }: { proposed: DesignCard; savedDraft: DesignCard }) {
  const draft = useStudioDraft() ?? savedDraft;
  const note = draftMovedOnNote(draft, proposed);
  if (!note) return null;
  return (
    <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
      {note}
    </p>
  );
}

export default function ProposalDiff({
  proposal,
  current,
  artUrl,
  finishedUrl,
  canReview,
  cardStatus,
  baseVersionNumber = null,
  savedDraft = {},
  latestVersion = null,
  closed = false,
  onAcceptDialog,
}: {
  proposal: ProposalRow;
  current: DesignCard;
  artUrl: string | null;
  finishedUrl: string | null;
  canReview: boolean;
  cardStatus: string;
  baseVersionNumber?: number | null;
  // The card's working draft as last refreshed, and its newest version of any status: the
  // one Deny can put the draft back to. Same row forge_deny_proposal_restore_draft picks.
  savedDraft?: DesignCard;
  latestVersion?: { versionNumber: number; data: DesignCard } | null;
  // The proposal has left the open list, and this row is only here for its open dialog.
  closed?: boolean;
  onAcceptDialog?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { flushPending } = useStudioSync();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [closedByAccept, setClosedByAccept] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const changes = diffCards(current, proposal.proposedSnapshot);
  const proposed = proposal.proposedSnapshot;
  // No base version = the card has never been released; a field-by-field
  // "— → value" diff is noise, so render the proposal as a plain new card.
  const isNewCard = proposal.baseVersionId === null;
  const isDraft = cardStatus === "draft";
  // Not while an accept is running: a good one leaves the open list before its note is saved.
  const gone = (closed || closedByAccept) && !pending;

  const showAccept = (open: boolean) => {
    setErr(null);
    setAcceptOpen(open);
    onAcceptDialog?.(open);
  };

  const doAccept = () =>
    start(async () => {
      setErr(null);
      const r = await runAcceptProposal({
        flush: flushPending,
        accept: () => acceptProposal(proposal.id),
        note,
        addNote: (body) => addComment({ cardId: proposal.cardId, proposalId: proposal.id, body }),
      });
      if (!r.ok) {
        setErr(r.error ?? "Could not accept proposal");
        if (r.closed) { setClosedByAccept(true); router.refresh(); }
        return;
      }
      showAccept(false);
      setNote("");
      router.refresh();
    });

  return (
    <div className="rounded-md border p-3">
      <p className="text-sm font-medium">{proposal.summary ?? "Proposed change"}</p>
      {/* The relative time can differ between the server's render and this one. */}
      <p suppressHydrationWarning className="mt-0.5 text-xs text-muted-foreground">
        {proposalByline({ who: proposal.proposerName, at: proposal.createdAt, baseVersion: baseVersionNumber })}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {isNewCard ? "New card — first proposal" : summarizeDiff(changes)}
      </p>
      <DraftMovedOn proposed={proposed} savedDraft={savedDraft} />

      {/* Decision controls + change list render ABOVE the previews (mobile-first). */}
      {proposal.status === "open" && canReview && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => showAccept(true)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setDenyOpen(true)}>
            Deny
          </Button>
        </div>
      )}

      {changes.length > 0 && (
        <div className="mt-2">
          <FieldChanges changes={changes} isNewCard={isNewCard} />
        </div>
      )}

      {/* The field diff above carries the change; the paired faces are collapsed by
          default. Available on demand. Always the rendered frame, even on a card with a
          finished image: a proposal never changes that image, so showing it would make
          the two faces identical. A first proposal has no released version to put in the
          "Current" slot, and an empty face there reads as a wiped card rather than as
          "nothing yet". So a new card shows one face on its own. */}
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
          Show card preview
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {!isNewCard && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Current</p>
              <ForgeCardPreview card={current} artUrl={artUrl} />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{isNewCard ? "Card preview" : "Proposed"}</p>
            <ForgeCardPreview card={proposed} artUrl={artUrl} />
          </div>
        </div>
        {finishedUrl && (
          <p className="mt-2 text-xs text-muted-foreground">
            This card has a finished image, which is shown everywhere in place of these faces. Accepting doesn’t change it.
          </p>
        )}
      </details>

      <Dialog open={acceptOpen} onOpenChange={(o) => { if (!o) showAccept(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{gone ? "Proposal closed" : "Accept proposal"}</DialogTitle>
            <DialogDescription>
              {gone
                ? "This proposal can’t be accepted any more."
                : isDraft
                ? "Applies this change to the working draft and records it as a new draft version in the card’s history. The card stays in Draft — nothing is visible to playtesters."
                : "Releases a new version to playtesters (not the public card database) and replaces the working draft with this proposal. The card stays in playtest — use Mark final when it’s done."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {!gone && <DraftMovedOn proposed={proposed} savedDraft={savedDraft} />}
            <label className="block text-xs font-medium text-muted-foreground">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={gone}
              placeholder="Add a note for the proposal history…"
              className="h-24 w-full rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-60"
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
            {gone && !err && <p className="text-sm">{ACCEPT_CLOSED_NOTE}</p>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => showAccept(false)}>
              {gone ? "Close" : "Cancel"}
            </Button>
            {!gone && <Button disabled={pending} onClick={doAccept}>{isDraft ? "Accept" : "Accept & release"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={denyOpen} onOpenChange={(o) => { if (!o) setDenyOpen(false); }}>
        <DialogContent>
          <DenyDialogBody
            proposal={proposal}
            savedDraft={savedDraft}
            latestVersion={latestVersion}
            reason={reason}
            setReason={setReason}
            onCancel={() => setDenyOpen(false)}
            onDenied={() => { setDenyOpen(false); setReason(""); router.refresh(); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
