"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, Trophy, Undo2 } from "lucide-react";
import { Button } from "./button";
import {
  publishTournamentDecklistsAction,
  unpublishTournamentDecklistsAction,
  setResultsPublishedAction,
} from "../../app/tracker/tournaments/actions";

interface PublishDecklistsSectionProps {
  tournamentId: string;
  tournamentEnded: boolean;
  decklistCount: number;
  isPublished: boolean;
  currentFormat: string | null;
  resultsPublished: boolean;
  onPublishChange: () => void;
}

/**
 * Results and decklists publish as ONE action — the same semantics as the
 * "Publish results and decklists" checkbox on End Tournament and the
 * automatic publish when the final round ends. A tournament left half
 * published by the older two-button UI reads as unpublished here and is
 * squared away by the next Publish click.
 */
export default function PublishDecklistsSection({
  tournamentId,
  tournamentEnded,
  decklistCount,
  isPublished,
  currentFormat,
  resultsPublished,
  onPublishChange,
}: PublishDecklistsSectionProps) {
  const [busy, setBusy] = useState(false);
  // What went wrong with the last Publish or Unpublish; stays in the panel until the next try.
  const [problem, setProblem] = useState<string | null>(null);

  // Don't show if tournament hasn't ended
  if (!tournamentEnded) return null;

  const published = resultsPublished && (decklistCount === 0 || isPublished);

  async function handlePublish() {
    setBusy(true);
    setProblem(null);
    try {
      const results = await setResultsPublishedAction(tournamentId, true);
      // Format comes from Tournament Settings — the same source the
      // end-of-tournament auto-publish uses.
      const decks =
        decklistCount > 0
          ? await publishTournamentDecklistsAction(tournamentId, currentFormat || "Other")
          : null;
      if (results.success === false) {
        setProblem("Could not publish. Try again.");
      } else if (decks?.success === false) {
        setProblem("The decklists could not be published. Try again.");
      } else if (decks?.failed) {
        setProblem(
          `${decks.failed} of ${decklistCount} decklists could not be published. Unpublish, then Publish to try again.`
        );
      }
    } catch {
      setProblem("Could not publish. Check your connection and try again.");
    } finally {
      setBusy(false);
      onPublishChange();
    }
  }

  async function handleUnpublish() {
    setBusy(true);
    setProblem(null);
    try {
      const results = await setResultsPublishedAction(tournamentId, false);
      const decks = isPublished ? await unpublishTournamentDecklistsAction(tournamentId) : null;
      if (results.success === false || decks?.success === false) {
        setProblem("Could not unpublish. Try again.");
      }
    } catch {
      setProblem("Could not unpublish. Check your connection and try again.");
    } finally {
      setBusy(false);
      onPublishChange();
    }
  }

  const decklistPhrase =
    decklistCount > 0
      ? ` and ${decklistCount} ${decklistCount === 1 ? "decklist" : "decklists"}`
      : "";

  if (published) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-lg">
        <Trophy className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Final standings{decklistPhrase} published
          </p>
          <Link
            href={`/tournaments/results/${tournamentId}`}
            className="text-xs text-primary hover:underline"
          >
            View public results page
          </Link>
          {problem && (
            <p aria-live="polite" className="text-xs text-destructive">
              {problem}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUnpublish}
          disabled={busy}
          className="flex-shrink-0 gap-1.5"
        >
          <Undo2 className="w-3.5 h-3.5" />
          {busy ? "Unpublishing..." : "Unpublish"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border border-border rounded-lg">
      <Trophy className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Results private</p>
        <p className="text-xs text-muted-foreground">
          Publish final standings{decklistPhrase} to a public results page
        </p>
        {problem && (
          <p aria-live="polite" className="text-xs text-destructive">
            {problem}
          </p>
        )}
      </div>
      <Button
        variant="success"
        size="sm"
        onClick={handlePublish}
        disabled={busy}
        className="flex-shrink-0 gap-1.5"
      >
        <Globe className="w-3.5 h-3.5" />
        {busy ? "Publishing..." : "Publish"}
      </Button>
    </div>
  );
}
