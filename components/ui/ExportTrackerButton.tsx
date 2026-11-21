"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { prepareTrackerExport } from "../../utils/tournament/exportTracker";

interface ExportTrackerButtonProps {
  tournamentId: string;
  tournamentName: string;
}

/**
 * "Export to Excel" — downloads the official Tracker 2.6 spreadsheet
 * (macro-enabled .xlsm) pre-filled with this tournament's data. When the
 * export carries fidelity caveats (byes, renamed players, ...) they're shown
 * in a dialog first; blockers surface in the same dialog without a download.
 */
export default function ExportTrackerButton({
  tournamentId,
  tournamentName,
}: ExportTrackerButtonProps) {
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveFn, setSaveFn] = useState<(() => void) | null>(null);

  const handleClick = async () => {
    setBusy(true);
    try {
      const result = await prepareTrackerExport(tournamentId, tournamentName);
      if (result.ok === false) {
        setError(result.error);
        setWarnings([]);
        setSaveFn(null);
        setDialogOpen(true);
        return;
      }
      if (result.warnings.length === 0) {
        result.save();
        return;
      }
      setError(null);
      setWarnings(result.warnings);
      setSaveFn(() => result.save);
      setDialogOpen(true);
    } catch (e) {
      // A dropped connection throws from the template download.
      console.error("Export failed:", e);
      setError("The export could not be prepared. Check your connection and try again.");
      setWarnings([]);
      setSaveFn(null);
      setDialogOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        onClick={handleClick}
        disabled={busy}
        variant="outline"
        size="sm"
        title="Download the official Tracker 2.6 spreadsheet pre-filled with this tournament. Excel may require enabling macros on downloaded files."
      >
        <span className="hidden sm:inline">{busy ? "Exporting…" : "Export to Excel"}</span>
        <span className="sm:hidden">{busy ? "…" : "Excel"}</span>
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {error ? "Cannot export" : "Export notes"}
            </DialogTitle>
            <DialogDescription>
              {error
                ? "This tournament can't be exported to the Tracker 2.6 spreadsheet."
                : "The file opens in the official Tracker 2.6 spreadsheet, which has its own scoring conventions:"}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : (
              <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                <li>
                  Excel may block macros on downloaded files — use
                  &quot;Enable&nbsp;Content&quot; (or right-click →
                  Properties → Unblock on Windows) to activate the tracker&apos;s
                  buttons.
                </li>
              </ul>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {error ? "Close" : "Cancel"}
            </Button>
            {!error && saveFn && (
              <Button
                onClick={() => {
                  saveFn();
                  setDialogOpen(false);
                }}
              >
                Download anyway
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
