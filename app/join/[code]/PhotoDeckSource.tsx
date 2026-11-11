"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import { createDeckFromScanAction } from "@/app/decklist/actions";
import DeckPhotoReader from "@/app/decklist/scan/components/DeckPhotoReader";
import type { TrayJumps } from "@/app/decklist/scan/components/DeckTray";
import { DECK_COPY } from "@/app/decklist/scan/copy";
import type { DeckTrayAction } from "@/app/decklist/scan/lib/deckTrayReducer";
import { deckFormat, deckName, deckOutcomes, saveRows, totals } from "@/app/decklist/scan/lib/handoff";
import type { DeckTrayState } from "@/app/decklist/scan/types";
import { FORMATS, type FormatId } from "@/lib/formats";
import type { DeckCheckIssue } from "@/utils/deckcheck/types";

interface Props {
  userId: string;
  code: string;
  /** Names the saved deck, so My Decks and the host's roster do not fill with identical "Deck from photo" rows. */
  eventName: string;
  /** The event's format; null when the event has none to check against. */
  eventFormat: FormatId | null;
  /** False while another tab is showing: the reader stays mounted so a read in flight is not lost. */
  active: boolean;
  /** What the button does on this page: it is the join itself, or the decklist change. */
  submitLabel: string;
  /** Why the button cannot be pressed yet, for a reason outside the tray (no display name). */
  blocked?: string | null;
  onSelect: (deckId: string, deckName: string) => void;
}

/**
 * The join page's photo source: the deck photo reader, with the page's own submit under the tray. The deck is
 * checked against the event's format before anything is saved, so the player can fix a row or add a photo and
 * try again.
 */
export default function PhotoDeckSource({ userId, code, eventName, eventFormat, active, submitLabel, blocked, onSelect }: Props) {
  const tips = [
    "Lay out the whole deck with every title showing, and the reserve in its own row. A big deck reads best as two photos, half each.",
    DECK_COPY.captureTip,
    eventFormat
      ? `Your list is checked against ${FORMATS[eventFormat].label} and saved to your decks.`
      : "Your list is saved to your decks.",
  ];
  return (
    <DeckPhotoReader
      userId={userId}
      active={active}
      signInHref={`/sign-in?redirectTo=${encodeURIComponent(`/join/${code}`)}`}
      trayClassName="-mx-3"
      tips={tips}
      hideCrossLink
      footer={(ctx) => (
        <SubmitBar
          {...ctx}
          eventName={eventName}
          eventFormat={eventFormat}
          submitLabel={submitLabel}
          blocked={blocked ?? null}
          onSelect={onSelect}
        />
      )}
    />
  );
}

type Failure = { kind: "illegal"; issues: DeckCheckIssue[]; checked: DeckTrayState } | { kind: "error" };

/** What to do about an issue, where the fix is not obvious from the rule's own message. */
function hintFor(rule: string): string | null {
  if (rule === "pool-legality" || rule === "banned-card")
    return "If you have a different printing, open the row's ⋯ menu and choose Change printing.";
  if (rule.endsWith("deck-size") || rule.endsWith("lost-soul-count"))
    return "If part of the deck is not in the photo, add another photo of the rest.";
  if (rule.endsWith("reserve-size") || rule === "t1-reserve-contents")
    return "Check each group is marked Main deck or Reserve correctly.";
  return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function SubmitBar({
  state,
  dispatch,
  jumps,
  eventName,
  eventFormat,
  submitLabel,
  blocked,
  onSelect,
}: {
  state: DeckTrayState;
  dispatch: Dispatch<DeckTrayAction>;
  jumps: TrayJumps;
  eventName: string;
  eventFormat: FormatId | null;
  submitLabel: string;
  blocked: string | null;
  onSelect: Props["onSelect"];
}) {
  const saving = useRef(false);
  const savedName = useRef("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const t = useMemo(() => totals(state), [state]);
  const saved = t.main + t.reserve;
  const reading = state.photos.some((p) => p.status === "queued" || p.status === "reading");
  // A photo that failed has no rows to flag, but its cards are missing all the same.
  const failedPhotos = state.photos.filter((p) => p.status === "failed").length;
  const isSaved = state.phase === "saved" && state.savedDeckId !== null;
  const busy = state.phase !== "editing" || reading;
  // A card left out of the save could turn an illegal deck into a smaller legal one: every row gets an answer first.
  const open = !isSaved && (t.toCheck > 0 || t.lostSoulsToPick > 0 || failedPhotos > 0);

  // The deck goes to the host only once the saved tray has rendered: the tray clears its stored copy in that
  // commit, and a host that swaps the picker out on select would otherwise unmount it first and leave the
  // spent tray behind for the next visit.
  const select = useRef(onSelect);
  select.current = onSelect;
  const savedDeckId = isSaved ? state.savedDeckId : null;
  useEffect(() => {
    if (savedDeckId !== null) select.current(savedDeckId, savedName.current);
  }, [savedDeckId]);

  const submit = async () => {
    // Saved already, and the host's own submit failed (venue wifi): hand the same deck over again.
    if (isSaved) return onSelect(state.savedDeckId!, savedName.current);
    if (saving.current) return;
    saving.current = true;
    setFailure(null);
    dispatch({ type: "saving" });
    const name = (savedName.current = eventName.trim() ? `${eventName.trim().slice(0, 90)} deck` : deckName(new Date()));
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
        return;
      }
      dispatch({ type: "saveFailed" });
      setFailure(res.code === "illegal" ? { kind: "illegal", issues: res.issues, checked: state } : { kind: "error" });
    } catch {
      dispatch({ type: "saveFailed" });
      setFailure({ kind: "error" });
    } finally {
      saving.current = false;
    }
  };

  const issues = failure?.kind === "illegal" ? failure.issues.filter((i) => i.type === "error") : null;
  // The issues describe the deck as it was checked. After an edit they stay up, marked as the last check, so
  // fixing one does not hide the rest.
  const edited =
    failure?.kind === "illegal" &&
    !(
      failure.checked.entries === state.entries &&
      failure.checked.lostSoulPicks === state.lostSoulPicks &&
      failure.checked.groupZones === state.groupZones &&
      failure.checked.photos === state.photos
    );
  const hints = issues ? [...new Set(issues.map((i) => hintFor(i.rule)).filter((h): h is string => h !== null))] : [];

  const jumpClass =
    "min-h-9 whitespace-nowrap font-medium text-amber-600 underline-offset-4 hover:underline focus:outline-none dark:text-amber-400";

  // A fragment, not a wrapper: the bar sticks within the reader's own column, which spans the whole tray.
  return (
    <>
      {issues && (
        <div
          className={`rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm ${edited ? "opacity-70" : ""}`}
        >
          <p className="font-medium text-foreground">
            {edited ? "From your last check" : "This deck isn't legal for this event"}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          {hints.map((h) => (
            <p key={h} className="mt-2 text-muted-foreground">
              {h}
            </p>
          ))}
          <p className="mt-2 text-muted-foreground">
            {edited ? "Press the button below to check again." : "Fix the rows above, then check again."}
          </p>
        </div>
      )}

      {!isSaved && t.toCheck > 0 && (
        <p className="text-xs text-muted-foreground">
          Tap the right card on each flagged row. Remove a row only if that card is not in your deck.
        </p>
      )}

      {/* Stays in view while the player works down the rows: what is left, how to get to it, and the way out. */}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <div aria-live="polite" className="flex min-h-9 flex-wrap items-center gap-x-3 text-sm tabular-nums">
          {/* The counts once nothing is left to do; until then the to-dos have the line to themselves. */}
          {(!open || reading) && (
            <span className="text-muted-foreground">
              Main {t.main} · Reserve {t.reserve}
            </span>
          )}
          {reading && <span className="text-muted-foreground">Reading… you can add the next photo now.</span>}
          {!isSaved && t.toCheck > 0 && (
            <button type="button" onClick={jumps.walk} className={jumpClass}>
              {plural(t.toCheck, "row", "rows")} to check
            </button>
          )}
          {!isSaved && t.lostSoulsToPick > 0 && (
            <button type="button" onClick={jumps.openLostSouls} className={jumpClass}>
              {plural(t.lostSoulsToPick, "Lost Soul", "Lost Souls")} to pick
            </button>
          )}
        </div>
        {!isSaved && failedPhotos > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {failedPhotos === 1 ? "A photo was" : `${failedPhotos} photos were`} not read. Retry or remove{" "}
            {failedPhotos === 1 ? "it" : "them"}.
          </p>
        )}
        {!open && !reading && blocked && <p className="text-sm text-amber-600 dark:text-amber-400">{blocked}</p>}
        {failure?.kind === "error" && <p className="text-sm text-destructive">Something went wrong — try again.</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={blocked !== null || (!isSaved && (busy || saved === 0 || open))}
          className="min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none disabled:opacity-50"
        >
          {state.phase === "saving" ? "Checking…" : submitLabel}
        </button>
      </div>
    </>
  );
}
