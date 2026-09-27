"use client";

import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

interface PublishResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Publish now. The caller closes the dialog once it has finished. */
  onPublish: () => Promise<void> | void;
  /** Leave unpublished — fired once for "Not yet", ESC, or a backdrop click.
   * The Publish section stays available as the manual path. */
  onNotYet: () => void;
  isPublishing?: boolean;
}

/**
 * Asked once when the final round's End Round completes the tournament.
 * Previously that path published results and decklists with no confirmation;
 * now the host chooses.
 */
export function PublishResultsDialog({
  open,
  onOpenChange,
  onPublish,
  onNotYet,
  isPublishing = false,
}: PublishResultsDialogProps) {
  const dismiss = () => {
    if (isPublishing) return;
    onNotYet();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Publish results and decklists now?</DialogTitle>
          <DialogDescription>
            The tournament has ended. Publishing puts the final standings (and
            any submitted decklists) on the public results page. You can also
            publish later from the Publish section, or correct a result first
            with Edit a past result.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-end">
          <Button variant="ghost" onClick={dismiss} disabled={isPublishing}>
            Not yet
          </Button>
          <Button variant="success" onClick={() => onPublish()} disabled={isPublishing}>
            {isPublishing ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PublishResultsDialog;
