"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import DeckPicker from "./DeckPicker";
import {
  getJoinInfoAction,
  joinTournamentAction,
  resubmitDeckAction,
  type JoinInfo,
  type JoinResult,
} from "../actions";

type JoinedState = Extract<JoinInfo, { success: true }>;
type FailedResult = Extract<JoinResult, { success: false }>;

function Shell({ children }: { children: React.ReactNode }) {
  // Centered card over the full-screen hero background: without the vertical
  // centering the content clings to the top of an otherwise-empty immersive
  // backdrop, and without the panel it reads as bare text floating on art.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md sm:p-8">
        {children}
      </div>
    </div>
  );
}

function EventHeader({ info }: { info: JoinedState }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="font-cinzel text-2xl font-bold text-foreground sm:text-3xl">
        {info.tournamentName}
      </h1>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
        {info.category && <span>{info.category}</span>}
        {info.hostName && <span>Hosted by {info.hostName}</span>}
      </div>
    </div>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function LegalityBadge({ isLegal }: { isLegal: boolean | null }) {
  if (isLegal === true) {
    return (
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        Legal
      </span>
    );
  }
  if (isLegal === false) {
    return (
      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
        Illegal
      </span>
    );
  }
  return null;
}

const ERROR_MESSAGES: Partial<Record<FailedResult["error"], string>> = {
  blocked: "The host has blocked you from this event.",
  already_joined: "You're already registered for this event — refreshing…",
  started: "This event has already started.",
  not_signed_in: "You need to sign in to join.",
  decklist_required: "This event requires a decklist to join.",
  deck_not_found: "That deck couldn't be found.",
  deck_not_accessible: "You don't have access to that deck.",
  invalid_name: "Enter a display name.",
  not_joined: "You're not registered for this event yet.",
  invalid_code: "This code isn't valid anymore.",
  join_failed: "Something went wrong — try again.",
};

function ActionErrorNotice({ res, deckId }: { res: FailedResult; deckId?: string }) {
  if (res.error === "deck_illegal") {
    const rank = (t: string) => (t === "error" ? 0 : t === "warning" ? 1 : 2);
    const issues = (res.issues ?? []).slice().sort((a, b) => rank(a.type) - rank(b.type));
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <p className="font-medium text-foreground">This deck isn&apos;t legal for this event</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
        {deckId && (
          <Link
            href={`/decklist/card-search?deckId=${deckId}`}
            className="mt-2 inline-block text-primary hover:underline"
          >
            Open in deck builder
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {ERROR_MESSAGES[res.error] ?? "Something went wrong — try again."}
    </div>
  );
}

export default function JoinClient({
  info: initialInfo,
  code,
  signedIn,
  defaultName,
}: {
  info: JoinInfo;
  code: string;
  signedIn: boolean;
  defaultName: string;
}) {
  const [info, setInfo] = useState<JoinInfo>(initialInfo);
  const [displayName, setDisplayName] = useState(defaultName);
  const [selectedDeck, setSelectedDeck] = useState<{ id: string; name: string } | null>(null);
  const [showChangeDeck, setShowChangeDeck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ res: JoinResult; deckId?: string } | null>(null);

  async function refresh() {
    try {
      const fresh = await getJoinInfoAction(code);
      setInfo(fresh);
      // A refresh always means the UI is about to reflect a real state
      // transition (joined, resubmitted, or bounced back to the join form
      // after a host removal) — any action-result banner from the call that
      // triggered this refresh (e.g. the transient "already registered —
      // refreshing…" notice) is now stale and must not persist past it.
      setResult(null);
    } catch {
      // Network drop mid-refresh: don't leave a stale "refreshing…" banner
      // up forever, surface the generic retry message instead.
      setResult({ res: { success: false, error: "join_failed" } });
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const deckId = selectedDeck?.id;
    try {
      const r = await joinTournamentAction(code, { displayName, deckId });
      setResult({ res: r, deckId });
      if (r.success === true || (r.success === false && r.error === "already_joined")) {
        await refresh();
      }
    } catch {
      // A thrown server action (network drop — venue wifi on a phone, the
      // primary environment) must not leave `submitting` stuck true forever.
      setResult({ res: { success: false, error: "join_failed" }, deckId });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResubmit(deckId: string) {
    setSubmitting(true);
    try {
      const r = await resubmitDeckAction(code, deckId);
      setResult({ res: r, deckId });
      if (r.success === true) {
        setShowChangeDeck(false);
        await refresh();
      } else if (r.error === "not_joined") {
        await refresh();
      }
    } catch {
      setResult({ res: { success: false, error: "join_failed" }, deckId });
    } finally {
      setSubmitting(false);
    }
  }

  // 1. Invalid code / rate-limited.
  if (info.success === false) {
    return (
      <Shell>
        <ErrorCard
          title="Can't join right now"
          message={
            info.error === "rate_limited"
              ? "Too many attempts from this connection — wait a minute and try again."
              : "That code isn't valid, or QR join isn't enabled for this event."
          }
        />
        <Link href="/join" className="mt-4 block text-center text-sm text-primary hover:underline">
          Enter a code
        </Link>
      </Shell>
    );
  }

  // 2. Event already started and this player never joined — hard lock.
  if (info.hasStarted === true && info.joined === null) {
    return (
      <Shell>
        <EventHeader info={info} />
        <ErrorCard
          title="This event has already started"
          message="Joining is closed. Check with the host if you think this is a mistake."
        />
        <Link
          href={`/t/${code}`}
          className="mt-4 block text-center text-sm text-primary hover:underline"
        >
          View live pairings &amp; standings
        </Link>
      </Shell>
    );
  }

  // 3. Not signed in — show what they're joining, then send them to sign in.
  if (signedIn === false) {
    return (
      <Shell>
        <EventHeader info={info} />
        <Button asChild className="w-full">
          <Link href={`/sign-in?redirectTo=${encodeURIComponent(`/join/${code}`)}`}>
            Sign in to join
          </Link>
        </Button>
      </Shell>
    );
  }

  // 4. Already registered.
  if (info.joined !== null) {
    const { joined } = info;
    return (
      <Shell>
        <EventHeader info={info} />
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <p className="text-sm text-muted-foreground">Registered as</p>
          <p className="text-lg font-medium text-foreground">{joined.displayName}</p>

          {info.requiresDecklist && (
            <div className="mt-3 border-t border-border pt-3">
              {joined.submission ? (
                <>
                  <p className="text-sm text-muted-foreground">Decklist</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-medium text-foreground">{joined.submission.deckName}</span>
                    <LegalityBadge isLegal={joined.submission.isLegal} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Submitted {new Date(joined.submission.submittedAt).toLocaleString()}
                  </p>
                </>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">No decklist submitted yet.</p>
              )}

              {info.hasStarted ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  This event has started — decklist changes are locked.
                  {joined.submission === null &&
                    " Talk to your host if you still need to hand in a decklist."}
                </p>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => setShowChangeDeck((v) => !v)}
                  >
                    {showChangeDeck ? "Cancel" : "Change decklist"}
                  </Button>
                  {showChangeDeck && (
                    <DeckPicker
                      tournamentFormat={info.deckFormat}
                      onSelect={(id) => handleResubmit(id)}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Once the event is under way, the thing a checked-in player wants is
            their table — send them to the live page. Before that, players
            don't otherwise know whether this page is meant to stay open (it
            looks like a live event screen), so say so, but only once there's
            nothing left to do here: on a decklist event with nothing
            submitted, "you can close this" would be wrong. */}
        {info.hasStarted ? (
          <Button asChild className="mt-3 w-full">
            <Link href={`/t/${code}`}>Live pairings &amp; standings</Link>
          </Button>
        ) : (
          (!info.requiresDecklist || joined.submission !== null) && (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-sm text-foreground">
                You're all set — you can close this page.
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Once the host starts round 1, your table, the round timer and the standings will
                be live at{" "}
                <Link href={`/t/${code}`} className="font-medium text-primary hover:underline">
                  this page
                </Link>
                .
              </p>
            </div>
          )
        )}

        {result && result.res.success === false && (
          <div className="mt-3">
            <ActionErrorNotice res={result.res} deckId={result.deckId} />
          </div>
        )}
      </Shell>
    );
  }

  // 5. Join form.
  const canSubmit =
    displayName.trim().length > 0 && (!info.requiresDecklist || selectedDeck !== null) && !submitting;

  return (
    <Shell>
      <EventHeader info={info} />
      <form onSubmit={handleJoin} className="space-y-4">
        <label className="block text-sm font-medium text-foreground">
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            required
            placeholder="Your name"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>

        {info.requiresDecklist && (
          <div>
            <p className="text-sm font-medium text-foreground">Decklist</p>
            {selectedDeck ? (
              <div className="mt-1 flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <span className="truncate font-medium text-foreground">{selectedDeck.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedDeck(null)}
                  className="ml-2 flex-shrink-0 text-xs text-muted-foreground hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <DeckPicker
                tournamentFormat={info.deckFormat}
                onSelect={(id, name) => setSelectedDeck({ id, name })}
              />
            )}
          </div>
        )}

        {result && result.res.success === false && (
          <ActionErrorNotice res={result.res} deckId={result.deckId} />
        )}

        <p className="text-xs text-muted-foreground">
          Your decklist will be visible to the host. When the event ends, your display name, final
          standing, and decklist will be published with the results unless the host withholds them.
        </p>

        <Button type="submit" disabled={!canSubmit} className="w-full">
          {submitting ? "Joining…" : "Join"}
        </Button>
      </form>
    </Shell>
  );
}
