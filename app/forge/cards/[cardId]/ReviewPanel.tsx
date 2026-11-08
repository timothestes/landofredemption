"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProposalDiff from "./ProposalDiff";
import CommentThread from "./CommentThread";
import CardHistory from "./CardHistory";
import { useStudioDraft, useStudioSync } from "./StudioSyncContext";
import FieldChanges from "./FieldChanges";
import { Button } from "@/components/ui/button";
import { appliedSuggestions, buildHistory } from "@/app/forge/lib/historyView";
import { diffCards } from "@/app/forge/lib/cardDiff";
import { runProposeSubmit } from "@/app/forge/lib/proposeFlow";
import { keepHeldProposal } from "@/app/forge/lib/reviewView";
import {
  PROPOSE_INTRO, PROPOSE_NEW_CARD, PROPOSE_SELF_ACCEPT, PROPOSE_ALREADY_UNDER_REVIEW,
  proposeConsequence, proposeDiffCaption, proposeEmptyNote,
} from "@/app/forge/lib/proposeCopy";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { createProposal, type ProposalDiffData, type ProposalRow } from "@/app/forge/lib/proposals";
import type { CommentRow } from "@/app/forge/lib/comments";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";

// What the reviewer will be asked to sign off on, from the editor's live draft, which is
// what a submit flushes and freezes. Its own component so that only this re-renders per
// keystroke, and only while the propose form is open. A first proposal gets no field list:
// every field reads as an addition, which ProposalDiff already judged to be noise.
export function ProposePreview({
  latestVersion,
  savedDraft,
}: {
  latestVersion: { versionNumber: number; data: DesignCard } | null;
  savedDraft: DesignCard;
}) {
  const draft = useStudioDraft() ?? savedDraft;
  if (!latestVersion) return <p className="text-muted-foreground">{PROPOSE_NEW_CARD}</p>;
  const changes = diffCards(latestVersion.data, draft);
  if (changes.length === 0) {
    return <p role="status" className="text-muted-foreground">{proposeEmptyNote(latestVersion.versionNumber)}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground">{proposeDiffCaption(latestVersion.versionNumber)}</p>
      <FieldChanges changes={changes} />
    </div>
  );
}

export default function ReviewPanel({
  card,
  openDiffs,
  proposals,
  comments,
  versions,
  events,
  canReview,
  alreadyUnderReview,
}: {
  card: ForgeCardFull;
  openDiffs: ProposalDiffData[];
  proposals: ProposalRow[];
  comments: CommentRow[];
  versions: VersionRow[];
  events: CardEventRow[];
  canReview: boolean;
  // An open proposal already holds exactly this draft (page.tsx compares with
  // sameSnapshot). Advisory only — there is no server-side duplicate guard — so it
  // hides the trigger rather than blocking a submit already in progress.
  alreadyUnderReview?: boolean;
}) {
  // Cache-buster: updated_at bumps on every image/snapshot write, mirroring the studio.
  const t = Date.parse(card.updatedAt) || 0;
  const artUrl = card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null;
  const finishedUrl = card.hasFinished ? `/forge/api/art/${card.id}?kind=finished&t=${t}` : null;
  const history = buildHistory(versions, proposals, events, comments, card.snapshot ?? {});

  // Proposing lives beside the proposals it creates. The proposal freezes the
  // card's saved working draft server-side (see createProposal).
  const router = useRouter();
  // The editor autosaves 700ms after a keystroke and createProposal freezes the
  // SERVER’s working draft, so proposing inside that window would submit the
  // pre-keystroke snapshot. Flush first, as CommentThread does before applying a
  // suggestion — see StudioSyncContext.
  const { flushPending } = useStudioSync();
  const [proposing, setProposing] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitProposal = async () => {
    if (!summary.trim()) return;
    setErr(null);
    setBusy(true);
    const r = await runProposeSubmit({
      flush: flushPending,
      create: () => createProposal(card.id, summary),
    });
    setBusy(false);
    if (r.ok === false) { setErr(r.error); return; }
    setProposing(false);
    setSummary("");
    router.refresh();
  };
  const canPropose = card.status === "draft" || card.status === "playtesting";

  // The proposal whose Accept dialog is open. See keepHeldProposal.
  const [held, setHeld] = useState<ProposalDiffData | null>(null);
  const shownDiffs = keepHeldProposal(openDiffs, held);

  // listVersions orders version_number DESC, so versions[0] is the same row
  // createProposal diffs against server-side.
  const latestVersion = versions[0] ?? null;

  // Card-level thread only, mirroring CommentThread's own filter.
  const cardComments = comments.filter((c) => c.proposalId === null);
  const unresolvedCount = cardComments.filter((c) => !c.resolved).length;

  return (
    <div className="space-y-8">
      {/* scroll-mt for the same reason as #comments below. */}
      <section id="proposals" className="scroll-mt-[calc(var(--forge-chrome)+4rem)]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            Open proposals
            {openDiffs.length > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">{openDiffs.length}</span>
            )}
          </h2>
          {canPropose && !proposing && !alreadyUnderReview && (
            <Button size="sm" variant="outline" onClick={() => setProposing(true)}>
              Propose changes
            </Button>
          )}
          {canPropose && !proposing && alreadyUnderReview && (
            <p className="text-xs text-muted-foreground">{PROPOSE_ALREADY_UNDER_REVIEW}</p>
          )}
        </div>

        {/* Outside the {proposing} block on purpose: "Propose changes" is the string
            people misread, so the correction cannot live behind the button that
            causes the confusion. */}
        {canPropose && !proposing && (
          <p className="mb-3 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">{PROPOSE_INTRO}</p>
        )}

        {proposing && (
          <div className="mb-3 space-y-3 rounded-md border bg-muted/30 p-3 text-xs">
            {/* Lead with WHAT is being submitted. */}
            <ProposePreview latestVersion={latestVersion} savedDraft={card.snapshot ?? {}} />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea autoFocus value={summary} onChange={(e) => setSummary(e.target.value)}
                aria-describedby="propose-consequence"
                placeholder="Summarize this change — what and why?"
                className="h-16 w-full rounded-md border bg-background px-2 py-1 sm:flex-1" />
              <div className="flex gap-2">
                {/* Never gated on the diff above: artwork changes are invisible to
                    diffCards. The server guard in createProposal stays authoritative. */}
                <Button size="sm" disabled={busy || !summary.trim()} onClick={submitProposal}>
                  Submit proposal
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setProposing(false); setErr(null); }}>Cancel</Button>
              </div>
            </div>

            <p id="propose-consequence" className="text-muted-foreground">{proposeConsequence(card.status)}</p>
            {canReview && <p className="text-muted-foreground">{PROPOSE_SELF_ACCEPT}</p>}
            {err && <p role="alert" className="text-destructive">{err}</p>}
          </div>
        )}
        {shownDiffs.length === 0 ? (
          <p className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            No open proposals.
          </p>
        ) : (
          <div className="space-y-3">
            {shownDiffs.map((d) => (
              <ProposalDiff
                key={d.proposal.id}
                proposal={d.proposal}
                current={d.current}
                artUrl={artUrl}
                finishedUrl={finishedUrl}
                canReview={canReview}
                cardStatus={card.status}
                baseVersionNumber={versions.find((v) => v.id === d.proposal.baseVersionId)?.versionNumber ?? null}
                savedDraft={card.snapshot ?? {}}
                latestVersion={latestVersion}
                closed={!openDiffs.some((o) => o.proposal.id === d.proposal.id)}
                onAcceptDialog={(open) => setHeld(open ? d : null)}
              />
            ))}
          </div>
        )}
      </section>

      {/* scroll-mt so a #comments deep link doesn't land under the sticky chrome. */}
      <section id="comments" className="scroll-mt-[calc(var(--forge-chrome)+4rem)]">
        <h2 className="mb-2 text-base font-semibold tracking-tight">
          Comments &amp; suggestions
          {cardComments.length > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {cardComments.length}
              {unresolvedCount > 0 && ` · ${unresolvedCount} unresolved`}
            </span>
          )}
        </h2>
        <CommentThread
          cardId={card.id}
          comments={comments}
          canApply={canReview}
          versions={versions.map((v) => ({ versionNumber: v.versionNumber, createdAt: v.createdAt, status: v.status }))}
          applied={appliedSuggestions(comments, versions, card.snapshot ?? {})}
          savedDraft={card.snapshot ?? {}}
        />
      </section>

      <section id="history" className="scroll-mt-[calc(var(--forge-chrome)+4rem)]">
        <h2 className="mb-2 text-base font-semibold tracking-tight">
          History
          {versions.length > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground">{versions.length} versions</span>
          )}
        </h2>
        <CardHistory history={history} cardId={card.id} />
      </section>
    </div>
  );
}
