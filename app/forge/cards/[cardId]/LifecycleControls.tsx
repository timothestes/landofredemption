"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import { STATUS_PATH, STATUS_LABEL, ACTION_LABEL, releaseLabel, releaseProposalNotice, returnToIdeasCopy, deleteCopy, releaseBlockers, releaseBlockedNote, isReleaseUnchanged, releaseUnchangedNote, restoreCopy, releasePreview, readOnlyCardNote, shareCopy, SHARE_NO_SETS, SHARE_FAILED, RELEASE_FLUSH_FAILED, type ReleaseBase, type RestoreTarget } from "@/app/forge/lib/lifecycleCopy";
import { flushThen } from "@/app/forge/lib/proposeFlow";
import { withDeadline } from "@/app/forge/lib/withDeadline";
import FieldChanges from "./FieldChanges";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

export default function LifecycleControls({
  card,
  draft,
  flushPending = async () => ({ ok: true }),
  releaseBase = null,
  restoreTarget = null,
  sets,
  openProposals = { count: 0, hasMatch: false },
  canEdit = true,
}: {
  card: ForgeCardFull;
  // The editor's live draft. `card.snapshot` trails it by a save and a refresh.
  draft: DesignCard;
  // Writes the editor's pending edit. Release freezes the server's copy, so without this
  // it could ship something other than the diff its dialog just showed.
  flushPending?: () => Promise<{ ok: boolean }>;
  // The newest version playtesters have seen. Null before a card's first release.
  releaseBase?: ReleaseBase | null;
  // Where Restore will put this card. Only set while it's shelved.
  restoreTarget?: RestoreTarget | null;
  sets: ForgeSetSummary[];
  // Releasing closes the card's open proposals (migration 083). `hasMatch` =
  // one of them is exactly this draft, so the release records it as accepted
  // instead of discarding it. Classified server-side in the page.
  openProposals?: { count: number; hasMatch: boolean };
  // Whether this member can write to this card. Worked out in the page; the RPCs still decide.
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [shareSetId, setShareSetId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
  // The RPC minted nothing. It decides; this catches what the dialog's own check can't see.
  const [releaseNoOp, setReleaseNoOp] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok === false) alert(r.error ?? "Action failed");
      router.refresh();
    });

  // Release freezes a new version; the optional note is stamped on the version
  // row inside the same transaction (migration 072).
  const doRelease = () =>
    start(async () => {
      const r = await flushThen(
        flushPending,
        () => publish(card.id, releaseNote),
        { ok: false, error: RELEASE_FLUSH_FAILED },
      );
      if (r.ok === false) { alert(r.error ?? "Could not release card"); return; }
      if (r.unchanged) { setReleaseNoOp(true); return; }
      setReleaseOpen(false);
      setReleaseNote("");
      router.refresh();
    });

  // Stays open until the page has turned into the set's copy of the card: the inner transition
  // puts the close and the refreshed page in one commit, so there is no gap that looks like a miss.
  const doShare = () =>
    start(async () => {
      const r = await withDeadline(shareToSet(card.id, shareSetId), { ok: false, error: SHARE_FAILED });
      if (r.ok === false) { alert(r.error ?? SHARE_FAILED); return; }
      start(() => {
        setPicking(false);
        setShareSetId("");
        router.refresh();
      });
    });

  // Delete navigates away (the card no longer exists) — refreshing in place would 404.
  const onDelete = () =>
    start(async () => {
      const r = await deleteCard(card.id);
      if (r.ok === false) { alert(r.error ?? "Could not delete card"); return; }
      router.push(card.setId ? `/forge/sets/${card.setId}/cards` : "/forge/ideas");
    });

  const inSet = card.setId !== null;
  const releaseNotices = releaseProposalNotice(openProposals.count, openProposals.hasMatch);
  const returnCopy = returnToIdeasCopy(1);
  const restore = restoreCopy(restoreTarget ?? { status: "draft", versionNumber: null });
  const delCopy = deleteCopy([draft.name]);
  const blockers = releaseBlockers(draft);
  const blockedNote = releaseBlockedNote(blockers);
  const releaseUnchanged = releaseNoOp || isReleaseUnchanged(draft, releaseBase);
  const preview = releasePreview(draft, releaseBase);
  const shareTarget = sets.find((s) => s.id === shareSetId) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          {/* From sm up. On a phone the version pill above already says where the card is. */}
          <ol className="hidden items-center gap-1 text-muted-foreground sm:flex">
            {STATUS_PATH.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {STATUS_LABEL[s]}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
            {card.status === "archived" && <li className="font-semibold text-foreground">· {STATUS_LABEL.archived}</li>}
          </ol>
          {!canEdit ? (
            <span className="ml-auto text-muted-foreground">{readOnlyCardNote(card.status)}</span>
          ) : (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <>
                {blockedNote && <span className="text-muted-foreground">{blockedNote}</span>}
                <Button size="sm" className="h-11 px-4 sm:h-7 sm:px-3 sm:text-xs" disabled={pending || blockers.length > 0} onClick={() => { setReleaseNoOp(false); setReleaseOpen(true); }}>
                  {releaseLabel(card.status)}
                </Button>
              </>
            )}
            {card.status === "playtesting" && (
              <Button size="sm" variant="outline" className="h-11 px-4 sm:h-7 sm:px-3 sm:text-xs" disabled={pending} onClick={() => run(() => approve(card.id))}>
                {ACTION_LABEL.markFinal}
              </Button>
            )}
            {card.status === "approved" && (
              <Button size="sm" variant="outline" className="h-11 px-4 sm:h-7 sm:px-3 sm:text-xs" disabled={pending} onClick={() => run(() => unapprove(card.id))}>
                {ACTION_LABEL.reopen}
              </Button>
            )}
            {card.status === "archived" && (
              <Button size="sm" variant="outline" className="h-11 px-4 sm:h-7 sm:px-3 sm:text-xs" disabled={pending} onClick={() => setConfirmRestore(true)}>
                {ACTION_LABEL.restore}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-11 w-11 p-0 sm:h-7 sm:w-7" disabled={pending} aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {card.status !== "archived" && (
                  <DropdownMenuItem className="min-h-11 sm:min-h-0" onSelect={() => run(() => archive(card.id))}>
                    {ACTION_LABEL.shelve}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="min-h-11 sm:min-h-0" onSelect={() => setConfirmReturn(true)}>
                  {ACTION_LABEL.returnToIdeas}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive sm:min-h-0" onSelect={() => setConfirmDelete(true)}>
                  {ACTION_LABEL.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          )}
        </>
      ) : (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-11 px-4 sm:h-7 sm:px-3 sm:text-xs" disabled={pending} onClick={() => setPicking(true)}>Share to a set</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-11 w-11 p-0 sm:h-7 sm:w-7" disabled={pending} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive sm:min-h-0" onSelect={() => setConfirmDelete(true)}>
                {ACTION_LABEL.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Dialog open={releaseOpen} onOpenChange={(o) => { if (!o) setReleaseOpen(false); }}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{releaseLabel(card.status)}</DialogTitle>
            <DialogDescription>
              {releaseUnchanged
                ? releaseUnchangedNote(releaseBase?.versionNumber ?? null)
                : "Freezes the current draft as a new version visible to playtesters."}
            </DialogDescription>
          </DialogHeader>
          {!releaseUnchanged && (
            <DialogBody className="space-y-2">
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{preview.caption}</p>
                <FieldChanges changes={preview.changes} />
                {preview.artNote && <p className="text-xs text-muted-foreground">{preview.artNote}</p>}
              </div>
              {releaseNotices.length > 0 && (
                <ul className="space-y-1 rounded-md border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                  {releaseNotices.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <label className="block text-xs font-medium text-muted-foreground">What changed? (optional)</label>
              <textarea
                autoFocus
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
                placeholder="Shown in the card’s history…"
                className="h-24 w-full rounded-md border bg-background px-2 py-1 text-base sm:text-sm"
              />
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-10" disabled={pending} onClick={() => setReleaseOpen(false)}>
              {releaseUnchanged ? "Close" : "Cancel"}
            </Button>
            {!releaseUnchanged && (
              <Button className="h-11 sm:h-10" disabled={pending || blockers.length > 0} onClick={doRelease}>Release</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={picking} onOpenChange={(o) => { if (pending) return; setPicking(o); if (!o) setShareSetId(""); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Share to a set</DialogTitle>
            <DialogDescription>{sets.length > 0 ? shareCopy(shareTarget) : SHARE_NO_SETS}</DialogDescription>
          </DialogHeader>
          {sets.length > 0 && (
            <DialogBody>
              <select aria-label="Set to share into" disabled={pending} value={shareSetId} onChange={(e) => setShareSetId(e.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-2 py-1.5 text-base sm:min-h-0 sm:text-sm">
                <option value="" disabled>Choose a set…</option>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-10" disabled={pending} onClick={() => { setPicking(false); setShareSetId(""); }}>Cancel</Button>
            {sets.length > 0 && (
              <Button className="h-11 sm:h-10" disabled={pending || !shareTarget} onClick={doShare}>{pending ? "Sharing…" : "Share"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        onConfirm={() => run(() => unarchive(card.id))}
        variant="warning"
        title={restore.title}
        description={restore.description}
        confirmLabel={restore.confirmLabel}
      />
      <ConfirmationDialog
        open={confirmReturn}
        onOpenChange={setConfirmReturn}
        onConfirm={() => run(() => sendToPrivate(card.id))}
        variant="warning"
        title={returnCopy.title}
        description={returnCopy.description}
        confirmLabel={returnCopy.confirmLabel}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
        variant="destructive"
        title={delCopy.title}
        description={delCopy.description}
        confirmLabel={delCopy.confirmLabel}
      />
    </div>
  );
}
