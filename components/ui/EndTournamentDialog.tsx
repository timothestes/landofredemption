"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { typedNameMatches } from "../../utils/tournament/confirmName";

interface EndTournamentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentName: string;
  onConfirm: (publish: boolean) => Promise<void> | void;
  isEnding?: boolean;
}

/**
 * Typed-confirmation gate for ending a tournament. The owner explicitly
 * wanted "End Tournament" to require typing the tournament name to defuse
 * accidental clicks on what is otherwise an irreversible host action.
 *
 * We intentionally do NOT modify the shared `ConfirmationDialog` primitive
 * here — that component is wired into ~12 other destructive flows where
 * a typed gate would be overkill, and bending its API just for End
 * Tournament would muddy the contract for everyone else.
 *
 * Match semantics: case-insensitive comparison with both sides trimmed, and
 * any dash counts as a hyphen (generated names contain a long dash that a
 * phone keyboard cannot type). Paste is allowed. The mismatch error stays
 * hidden until the user has typed at least one character.
 */
export function EndTournamentDialog({
  open,
  onOpenChange,
  tournamentName,
  onConfirm,
  isEnding = false,
}: EndTournamentDialogProps) {
  const [typed, setTyped] = useState("");
  // Publishing is opt-out, not opt-in — checked by default so ending a
  // tournament publishes results + decklists unless the host unchecks it.
  const [publish, setPublish] = useState(true);
  const matches = typedNameMatches(typed, tournamentName);
  // Only nag once the user has actually typed something — don't yell at
  // an empty input.
  const showMismatchError = typed.length > 0 && !matches;

  // Reset the input every time the dialog opens so a previous attempt
  // doesn't pre-fill the confirmation gate.
  useEffect(() => {
    if (open) {
      setTyped("");
      setPublish(true);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-destructive"
              aria-hidden="true"
            />
            <span>
              End &quot;{tournamentName}&quot;?
            </span>
          </DialogTitle>
          <DialogDescription>
            This ends the tournament for all players. You cannot undo this.
            Results can still be corrected afterwards with Edit a past result.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <label
            htmlFor="end-tournament-confirm-name"
            className="block text-sm font-medium text-foreground"
          >
            To confirm, type the tournament name:
          </label>
          <Input
            id="end-tournament-confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={tournamentName}
            autoFocus
            autoComplete="off"
            disabled={isEnding}
            // Owner feedback: the project's --ring token is the bright
            // accent green, which reads as jarring on form inputs. Override
            // to the same muted foreground ring used on `Button`.
            className="focus-visible:ring-foreground/40 focus-visible:border-foreground/40"
            aria-invalid={showMismatchError || undefined}
            aria-describedby={
              showMismatchError ? "end-tournament-mismatch" : undefined
            }
          />
          {showMismatchError && (
            <p
              id="end-tournament-mismatch"
              className="text-sm text-destructive"
              role="alert"
            >
              That doesn&apos;t match. Type &quot;{tournamentName}&quot; to
              enable End tournament.
            </p>
          )}
          <p className="text-sm text-muted-foreground pt-1">
            Results and decklists publish automatically when the event ends.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={publish}
              onCheckedChange={(v) => setPublish(v === true)}
              disabled={isEnding}
              className="mt-0.5"
            />
            <span>Publish results and decklists</span>
          </label>
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isEnding}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || isEnding}
            onClick={() => onConfirm(publish)}
          >
            {isEnding ? "Ending…" : "End tournament"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EndTournamentDialog;
