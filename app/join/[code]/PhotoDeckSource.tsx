"use client";

import { useMemo, useRef, useState, type Dispatch } from "react";
import { createDeckFromScanAction } from "@/app/decklist/actions";
import DeckPhotoReader from "@/app/decklist/scan/components/DeckPhotoReader";
import type { DeckTrayAction } from "@/app/decklist/scan/lib/deckTrayReducer";
import { deckFormat, deckName, deckOutcomes, saveRows, totals } from "@/app/decklist/scan/lib/handoff";
import type { DeckTrayState } from "@/app/decklist/scan/types";
import type { FormatId } from "@/lib/formats";
import type { DeckCheckIssue } from "@/utils/deckcheck/types";

interface Props {
  userId: string;
  code: string;
  /** The event's format; null when the event has none to check against. */
  eventFormat: FormatId | null;
  /** False while another tab is showing: the reader stays mounted so a read in flight is not lost. */
  active: boolean;
  onSelect: (deckId: string, deckName: string) => void;
}

/**
 * The join page's photo source: the deck photo reader, with Use this deck under the tray. The deck is checked
 * against the event's format before anything is saved, so the player can fix a row or add a photo and try again.
 */
export default function PhotoDeckSource({ userId, code, eventFormat, active, onSelect }: Props) {
  return (
    <DeckPhotoReader
      userId={userId}
      active={active}
      signInHref={`/sign-in?redirectTo=${encodeURIComponent(`/join/${code}`)}`}
      trayClassName="-mx-3"
      footer={(ctx) => <UseDeckBar {...ctx} eventFormat={eventFormat} onSelect={onSelect} />}
    />
  );
}

type Failure =
  | { kind: "illegal"; issues: DeckCheckIssue[]; entries: DeckTrayState["entries"]; picks: DeckTrayState["lostSoulPicks"] }
  | { kind: "error" };

function UseDeckBar({
  state,
  dispatch,
  eventFormat,
  onSelect,
}: {
  state: DeckTrayState;
  dispatch: Dispatch<DeckTrayAction>;
  eventFormat: FormatId | null;
  onSelect: Props["onSelect"];
}) {
  const saving = useRef(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const t = useMemo(() => totals(state), [state]);
  const saved = t.main + t.reserve;
  // A card left out of the save could turn an illegal deck into a smaller legal one: every row gets an answer first.
  const pending = t.leftOut + t.lostSoulsToPick;
  const reading = state.photos.some((p) => p.status === "queued" || p.status === "reading");
  const busy = state.phase !== "editing" || reading;

  const use = async () => {
    if (saving.current) return;
    saving.current = true;
    setFailure(null);
    dispatch({ type: "saving" });
    const name = deckName(new Date());
    try {
      const res = await createDeckFromScanAction({
        rows: saveRows(state),
        outcomesByScanId: deckOutcomes(state),
        name,
        format: deckFormat(t.main),
        eventFormat: eventFormat ?? undefined,
      });
      if (res.ok === true) {
        dispatch({ type: "saved", deckId: res.deckId });
        onSelect(res.deckId, name);
        return;
      }
      dispatch({ type: "saveFailed" });
      setFailure(
        res.code === "illegal"
          ? { kind: "illegal", issues: res.issues, entries: state.entries, picks: state.lostSoulPicks }
          : { kind: "error" },
      );
    } catch {
      dispatch({ type: "saveFailed" });
      setFailure({ kind: "error" });
    } finally {
      saving.current = false;
    }
  };

  // The issues describe the deck as it was checked: once a row changes they no longer apply.
  const issues =
    failure?.kind === "illegal" && failure.entries === state.entries && failure.picks === state.lostSoulPicks
      ? failure.issues.filter((i) => i.type === "error")
      : null;

  return (
    <div className="space-y-3">
      {issues && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-foreground">This deck isn&apos;t legal for this event</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">Fix a row above or add another photo, then try again.</p>
        </div>
      )}
      {failure?.kind === "error" && (
        <p className="text-sm text-destructive">Something went wrong — try again.</p>
      )}
      {pending > 0 && !reading && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {pending} {pending === 1 ? "card still needs" : "cards still need"} an answer. Pick or remove{" "}
          {pending === 1 ? "it" : "them"} to use this deck.
        </p>
      )}
      <button
        type="button"
        onClick={() => void use()}
        disabled={busy || saved === 0 || pending > 0}
        className="min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none disabled:opacity-50"
      >
        {state.phase === "saving" ? "Checking…" : "Use this deck"}
      </button>
    </div>
  );
}
