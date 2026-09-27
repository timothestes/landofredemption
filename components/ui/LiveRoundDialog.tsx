"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "./dialog";
import { Button } from "./button";
import { setQrJoinEnabledAction } from "../../app/tracker/tournaments/actions";

interface LiveRoundTournament {
  id: string;
  code: string | null;
}

interface LiveRoundDialogProps {
  tournament: LiveRoundTournament;
  isOpen: boolean;
  onClose: () => void;
  /** Fired after a code is created here so the page re-reads the tournament. */
  onTournamentUpdated: () => void;
}

/**
 * The player-facing live page for this event: /t/[code]. Same code the QR
 * Join flow hands out, so anyone who scanned in already has it — this dialog
 * is for the projector / group chat, and for events that never used QR Join.
 */
export default function LiveRoundDialog({
  tournament,
  isOpen,
  onClose,
  onTournamentUpdated,
}: LiveRoundDialogProps) {
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveUrl =
    typeof window !== "undefined" && tournament.code
      ? `${window.location.origin}/t/${tournament.code}`
      : "";

  function copyUrl() {
    if (!liveUrl) return;
    navigator.clipboard
      .writeText(liveUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  // The live page is keyed by the join code. An event that never enabled QR
  // Join has none, so offer to create one here; before the event starts this
  // is the same switch as "Enable QR Join" (joins close at Start regardless).
  async function createCode() {
    setCreating(true);
    setError(null);
    try {
      const res = await setQrJoinEnabledAction(tournament.id, true);
      if (res.success === false) {
        setError("Couldn't create an event code — please try again.");
        return;
      }
      onTournamentUpdated();
    } catch {
      setError("Couldn't create an event code — please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Live pairings &amp; standings for players</DialogTitle>
          <DialogDescription>
            Players open this on their phones to see their table, the round timer and the
            standings. It refreshes on its own — no sign-in needed.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {tournament.code ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="rounded-lg border border-border bg-white p-3">
                <QRCodeSVG value={liveUrl} size={240} />
              </div>
              <div className="w-full">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Live page link
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={liveUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={copyUrl} className="flex-shrink-0">
                    {copied ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="text-sm font-medium text-foreground">This event has no code yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The live page uses the same six-character code as QR Join. Create one and the
                link and QR appear here.
              </p>
              <Button
                type="button"
                variant="success"
                size="sm"
                className="mt-3"
                onClick={createCode}
                disabled={creating}
              >
                {creating ? "Creating…" : "Create event code"}
              </Button>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="justify-end">
          <Button type="button" variant="cancel" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
