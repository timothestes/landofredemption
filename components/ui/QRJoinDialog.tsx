"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  setQrJoinEnabledAction,
  updateJoinSettingsAction,
  getJoinStatsAction,
} from "../../app/tracker/tournaments/actions";
import { normalizeTournamentFormat, type FormatId } from "../../lib/formats";
import { categoryDefaults, requireDecklistsDefault } from "../../utils/tournament/categoryDefaults";
import { isNameFrozen } from "../../utils/tournament/naming";

// Only the columns this dialog reads/writes — callers pass the full
// tournament row (typed `any` at the page level), which satisfies this shape.
interface QRJoinTournament {
  id: string;
  code: string | null;
  deck_format: string | null;
  require_decklists: boolean | null;
  category: string | null;
}

interface QRJoinDialogProps {
  tournament: QRJoinTournament;
  isOpen: boolean;
  onClose: () => void;
  onTournamentUpdated: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "You don't have access to this tournament.",
  code_generation_failed: "Couldn't generate a join code — please try again.",
  invalid_format: "That format isn't valid.",
  format_required: "Set a format in the Settings tab before requiring decklists.",
};

// Shown when a server action throws outright (network drop, expired
// session, uncaught server exception) instead of resolving to
// {success:false, error} — and reused as friendlyError()'s fallback for any
// error code that isn't one of the known ones above.
const GENERIC_ERROR_MESSAGE = "Something went wrong — try again.";

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE;
}

function initialFormat(tournament: QRJoinTournament): FormatId | "Other" {
  // Official categories freeze the event name (e.g. "… Type 1 Unlimited
  // Tournament"), so the format is implied by the category itself. Derive it
  // from the category — not the stored deck_format, which an earlier edit
  // could have drifted from the name — so what the host sees and what the
  // deck-check enforces always agree with the name. Only free-form
  // "Unofficial" events keep a stored, host-chosen format.
  if (isNameFrozen(tournament.category)) {
    return categoryDefaults(tournament.category as string).deck_format;
  }
  return normalizeTournamentFormat(tournament.deck_format) ?? "Other";
}

// The category-based suggestion only applies before QR Join has ever been
// configured (code is null). Once enabled, `require_decklists` is an
// explicit choice the host already made through this dialog — re-deriving
// it from the category on every reopen would silently override a "no" the
// host picked on purpose.
function initialRequireDecklists(tournament: QRJoinTournament): boolean {
  if (tournament.code) return tournament.require_decklists === true;
  return tournament.require_decklists === true || requireDecklistsDefault(tournament.category);
}

export default function QRJoinDialog({
  tournament,
  isOpen,
  onClose,
  onTournamentUpdated,
}: QRJoinDialogProps) {
  const enabled = !!tournament.code;

  // Read-only here: Tournament Settings owns the event's category and format.
  // This dialog owns the join knobs (code, require-decklist) and nothing else.
  const [deckFormat, setDeckFormat] = useState<FormatId | "Other">(() => initialFormat(tournament));
  const [requireDecklists, setRequireDecklists] = useState<boolean>(() =>
    initialRequireDecklists(tournament)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<{ joined: number; submitted: number }>({
    joined: 0,
    submitted: 0,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-sync the form with the tournament's persisted values whenever the
  // dialog opens (covers reopening after an external change).
  useEffect(() => {
    if (!isOpen) return;
    setDeckFormat(initialFormat(tournament));
    setRequireDecklists(initialRequireDecklists(tournament));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tournament.deck_format, tournament.require_decklists, tournament.category, tournament.code]);

  // Poll the join/decklist counter every 5s, but only while the dialog is
  // open AND a code is live — never in the background, never pre-enable.
  useEffect(() => {
    if (!isOpen || !enabled) return;

    let cancelled = false;
    const poll = async () => {
      const res = await getJoinStatsAction(tournament.id);
      if (!cancelled && res.success === true) {
        setStats({ joined: res.joined, submitted: res.submitted });
      }
    };
    poll();
    pollRef.current = setInterval(poll, 5000);

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [isOpen, enabled, tournament.id]);

  const joinUrl =
    typeof window !== "undefined" && tournament.code
      ? `${window.location.origin}/join/${tournament.code}`
      : "";
  // The site's address as a player would type it, for the code-entry page.
  const joinSite = typeof window !== "undefined" ? window.location.host : "";

  async function handleEnable() {
    setSaving(true);
    setError(null);
    try {
      const settingsRes = await updateJoinSettingsAction(tournament.id, {
        requireDecklists,
      });
      if (settingsRes.success === false) {
        setError(friendlyError(settingsRes.error ?? ""));
        return;
      }
      const enableRes = await setQrJoinEnabledAction(tournament.id, true);
      if (enableRes.success === false) {
        setError(friendlyError(enableRes.error ?? ""));
        return;
      }
      onTournamentUpdated();
    } catch {
      // Server actions can throw outright (network drop, expired session,
      // uncaught server exception) rather than resolving to {success:false}.
      // Without this catch, `saving` never gets reset and the dialog locks
      // up for the rest of the session.
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    setSaving(true);
    setError(null);
    try {
      const res = await setQrJoinEnabledAction(tournament.id, false);
      if (res.success === false) {
        setError(friendlyError(res.error ?? ""));
        return;
      }
      onTournamentUpdated();
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  // Auto-save knob edits once QR Join is already live — there's no separate
  // "save" step once a code has been handed out. `previous` is the
  // pre-optimistic-update value so a failed or thrown save can roll the local
  // (already-changed) state back to the last-known-persisted one instead of
  // leaving the UI showing something the server never saved.
  async function handleRequireChange(checked: boolean) {
    const previous = requireDecklists;
    setRequireDecklists(checked);
    if (!enabled) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateJoinSettingsAction(tournament.id, {
        requireDecklists: checked,
      });
      if (res.success === false) {
        setError(friendlyError(res.error ?? ""));
        setRequireDecklists(previous);
        return;
      }
      onTournamentUpdated();
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
      setRequireDecklists(previous);
    } finally {
      setSaving(false);
    }
  }

  function copyUrl() {
    if (!joinUrl) return;
    navigator.clipboard
      .writeText(joinUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>QR Join</DialogTitle>
          <DialogDescription>
            {enabled
              ? "Players can scan this code or use the link below to join."
              : "Let players join by scanning a QR code instead of you typing every name."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {enabled && (
            <>
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="bg-white p-3 rounded-lg border border-border">
                  <QRCodeSVG value={joinUrl} size={280} />
                </div>
                <p className="text-3xl font-mono font-bold tracking-widest text-foreground">
                  {tournament.code}
                </p>
                {/* For a player who can't scan: where the code above gets typed. */}
                <p className="text-center text-sm text-muted-foreground">
                  Or go to{" "}
                  <span className="break-all font-medium text-foreground">
                    {joinSite}/join
                  </span>{" "}
                  and enter this code.
                </p>
                <div className="w-full">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Join link
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={joinUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-0 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={copyUrl} className="flex-shrink-0">
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Joined</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{stats.joined}</p>
                </div>
                <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Decklists</p>
                  <p className="text-2xl font-semibold text-foreground tabular-nums">{stats.submitted}</p>
                </div>
              </div>
            </>
          )}

          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium text-foreground mb-1.5 block">Format</span>
              <div className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-2.5">
                <span className="font-medium text-foreground">{deckFormat}</span>
                <span className="text-xs text-muted-foreground">Set in the Settings tab</span>
              </div>
            </div>

            <label
              className={`flex items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors ${
                deckFormat === "Other" ? "opacity-60" : "cursor-pointer hover:bg-muted/40"
              }`}
            >
              <input
                type="checkbox"
                checked={requireDecklists}
                disabled={deckFormat === "Other" || saving}
                onChange={(e) => handleRequireChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-2 border-border text-primary bg-card focus:outline-none focus:ring-0 flex-shrink-0"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">
                  Require decklist to join
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {deckFormat === "Other"
                    ? "Choose a format above to require a validated decklist."
                    : "Players must submit a deck that passes deck check for this format."}
                </p>
              </div>
            </label>
          </div>
        </DialogBody>

        <DialogFooter className="justify-end">
          {enabled ? (
            <Button type="button" variant="outline" onClick={handleDisable} disabled={saving}>
              {saving ? "Working…" : "Disable QR Join"}
            </Button>
          ) : (
            <Button type="button" variant="success" onClick={handleEnable} disabled={saving}>
              {saving ? "Enabling…" : "Enable QR Join"}
            </Button>
          )}
          <Button type="button" variant="cancel" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
