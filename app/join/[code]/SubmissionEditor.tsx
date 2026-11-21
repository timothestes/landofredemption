"use client";

// Brought in with dynamic() from the join page: the list editor loads the card catalog.
import { useEffect, useMemo, useRef, useState } from "react";
import DecklistEditor from "@/components/tournament/DecklistEditor";
import type { DeckSnapshotCard } from "@/lib/tournament/deckSubmission";
import { sameCards, zoneTotals } from "@/lib/tournament/snapshotEdit";
import type { DeckCheckIssue } from "@/utils/deckcheck/types";
import { getMySubmissionAction, updateMySubmissionAction } from "../actions";

interface Props {
  code: string;
  /** The edited list was accepted: the page reloads what it shows. */
  onSaved: () => void;
  onCancel: () => void;
}

const MESSAGES: Record<string, string> = {
  started: "This event has started, so the decklist is locked.",
  not_joined: "You're not registered for this event anymore.",
  not_signed_in: "Sign in again to change your decklist.",
  decklist_required: "This event has no format set yet. Ask the host to set one.",
};

/**
 * The player's submitted list, open for touching up: change a card, a printing or a count, then check it against
 * the event's format and hand it in again. The list on record stays as it was until the edited one passes.
 */
export default function SubmissionEditor({ code, onSaved, onCancel }: Props) {
  const [original, setOriginal] = useState<DeckSnapshotCard[] | null>(null);
  const [cards, setCards] = useState<DeckSnapshotCard[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<{ list: DeckCheckIssue[]; checked: DeckSnapshotCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    getMySubmissionAction(code)
      .then((res) => {
        if (!live) return;
        if (res.success === true) {
          setOriginal(res.cards);
          setCards(res.cards);
        } else {
          setLoadError(MESSAGES[res.error] ?? "Couldn't load your decklist. Try again.");
        }
      })
      .catch(() => live && setLoadError("Couldn't load your decklist. Try again."));
    return () => {
      live = false;
    };
  }, [code]);

  const totals = useMemo(() => zoneTotals(cards), [cards]);
  const changed = original !== null && !sameCards(original, cards);

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await updateMySubmissionAction(code, cards);
      if (res.success === true) return onSaved();
      if (res.error === "deck_illegal") setIssues({ list: res.issues ?? [], checked: cards });
      else setError(MESSAGES[res.error] ?? "Something went wrong. Try again.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (loadError) return <p className="mt-3 text-sm text-muted-foreground">{loadError}</p>;
  if (original === null) return <p className="mt-3 text-sm text-muted-foreground">Loading your decklist…</p>;

  const errors = issues ? issues.list.filter((i) => i.type === "error") : [];
  // The issues describe the list as it was checked: after an edit they stay up, marked as the last check.
  const stale = issues !== null && issues.checked !== cards;

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        Tap a card&apos;s name to swap it, or use − and + to change how many. Your current decklist stays until
        the edited one passes.
      </p>

      {/* Past the card's padding on a phone, as the photo tab's rows run: card names need the width. */}
      <div className="-mx-3 sm:mx-0">
        <DecklistEditor cards={cards} onChange={setCards} editable={!saving} />
      </div>

      {errors.length > 0 && (
        <div
          className={`rounded-md border border-border border-l-2 border-l-amber-500 bg-muted/40 p-3 text-sm ${stale ? "opacity-70" : ""}`}
        >
          <p className="font-medium text-foreground">
            {stale
              ? "From your last check. Press the button to check again."
              : `${errors.length} ${errors.length === 1 ? "thing" : "things"} to fix before this deck passes`}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {errors.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stays in view down a long list: the counts the deck check goes by, and the way out. */}
      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        <p aria-live="polite" className="pb-2 text-sm tabular-nums text-muted-foreground">
          Main {totals.main} · Reserve {totals.reserve}
        </p>
        {error && <p className="pb-2 text-sm text-amber-600 dark:text-amber-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-11 flex-1 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus:outline-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !changed}
            className="min-h-11 flex-[2] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none disabled:opacity-50"
          >
            {saving ? "Checking…" : "Check and resubmit"}
          </button>
        </div>
      </div>
    </div>
  );
}
