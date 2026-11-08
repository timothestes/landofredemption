"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { shareToSet, sendToPrivate, publish, approve, unapprove, archive, unarchive, deleteCard } from "@/app/forge/lib/lifecycle";
import { STATUS_PATH, STATUS_LABEL, ACTION_LABEL, releaseLabel, releaseProposalNotice, returnToIdeasCopy, deleteCopy, releaseBlockers, releaseBlockedNote } from "@/app/forge/lib/lifecycleCopy";
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
  sets,
  openProposals = { count: 0, hasMatch: false },
}: {
  card: ForgeCardFull;
  // The editor's live draft. `card.snapshot` trails it by a save and a refresh.
  draft: DesignCard;
  sets: ForgeSetSummary[];
  // Releasing closes the card's open proposals (migration 083). `hasMatch` =
  // one of them is exactly this draft, so the release records it as accepted
  // instead of discarding it. Classified server-side in the page.
  openProposals?: { count: number; hasMatch: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
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
      const r = await publish(card.id, releaseNote);
      if (r.ok === false) { alert(r.error ?? "Could not release card"); return; }
      setReleaseOpen(false);
      setReleaseNote("");
      router.refresh();
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
  const delCopy = deleteCopy([draft.name]);
  const blockers = releaseBlockers(draft);
  const blockedNote = releaseBlockedNote(blockers);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {inSet ? (
        <>
          <ol className="flex items-center gap-1 text-muted-foreground">
            {STATUS_PATH.map((s) => (
              <li key={s} className={card.status === s ? "font-semibold text-foreground" : ""}>
                {STATUS_LABEL[s]}
                {s !== "approved" ? " ›" : ""}
              </li>
            ))}
            {card.status === "archived" && <li className="font-semibold text-foreground">· {STATUS_LABEL.archived}</li>}
          </ol>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {(card.status === "draft" || card.status === "playtesting") && (
              <>
                {blockedNote && <span className="text-muted-foreground">{blockedNote}</span>}
                <Button size="sm" className="h-7 px-3 text-xs" disabled={pending || blockers.length > 0} onClick={() => setReleaseOpen(true)}>
                  {releaseLabel(card.status)}
                </Button>
              </>
            )}
            {card.status === "playtesting" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => approve(card.id))}>
                {ACTION_LABEL.markFinal}
              </Button>
            )}
            {card.status === "approved" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unapprove(card.id))}>
                {ACTION_LABEL.reopen}
              </Button>
            )}
            {card.status === "archived" && (
              <Button size="sm" variant="outline" className="h-7 px-3 text-xs" disabled={pending} onClick={() => run(() => unarchive(card.id))}>
                {ACTION_LABEL.restore}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={pending} aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {card.status !== "archived" && (
                  <DropdownMenuItem onSelect={() => run(() => archive(card.id))}>
                    {ACTION_LABEL.shelve}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setConfirmReturn(true)}>
                  {ACTION_LABEL.returnToIdeas}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
                  {ACTION_LABEL.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {picking ? (
            <select autoFocus disabled={pending} value="" onChange={(e) => e.target.value && run(() => shareToSet(card.id, e.target.value))} className="rounded-md border bg-background px-2 py-1">
              <option value="" disabled>Share into set…</option>
              {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => setPicking(true)}>Share to a set</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={pending} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
                {ACTION_LABEL.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <Dialog open={releaseOpen} onOpenChange={(o) => { if (!o) setReleaseOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{releaseLabel(card.status)}</DialogTitle>
            <DialogDescription>
              Freezes the current draft as a new version visible to playtesters.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
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
              className="h-24 w-full rounded-md border bg-background px-2 py-1 text-sm"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setReleaseOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || blockers.length > 0} onClick={doRelease}>Release</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
