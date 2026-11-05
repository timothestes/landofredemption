"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";
import { getSubmissionAction } from "@/app/tracker/tournaments/actions";
import { findCard } from "@/lib/cards/lookup";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import CardTile from "./CardTile";
import CardEnlargeModal from "./CardEnlargeModal";
import { LegalityDot } from "./LegalityDot";
import type { DeckSnapshot, DeckSnapshotCard } from "@/lib/tournament/deckSubmission";
import type { DeckCheckIssue } from "@/utils/deckcheck";

interface SubmissionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  participantId: string | null;
  participantName: string;
}

interface SubmissionDetail {
  snapshot: DeckSnapshot;
  isLegal: boolean | null;
  issues: DeckCheckIssue[];
  submittedAt: string;
  source: "player" | "host";
  submittedByUsername: string | null;
}

function groupByType(cards: DeckSnapshotCard[]): { type: string; cards: DeckSnapshotCard[] }[] {
  const groups = new Map<string, DeckSnapshotCard[]>();
  for (const c of cards) {
    const resolved = findCard(c.name, c.set, c.imgFile ?? undefined);
    const type = resolved?.type || "Other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(c);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    })
    .map(([type, typeCards]) => ({
      type,
      cards: [...typeCards].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function ZoneSection({ title, cards }: { title: string; cards: DeckSnapshotCard[] }) {
  if (cards.length === 0) return null;
  const groups = groupByType(cards);
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({total})</span>
      </h4>
      <div className="mt-1.5 space-y-2">
        {groups.map((g) => (
          <div key={g.type}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.type}
            </p>
            <ul className="text-sm text-foreground">
              {g.cards.map((c, i) => (
                <li key={`${c.name}-${c.set}-${i}`} className="truncate">
                  {c.quantity}× {c.name} <span className="text-muted-foreground">({c.set})</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card-image grid for the same zone the list view renders as text. Uses the
 * public deck page's CardTile so a host sees decks exactly as players do, and
 * keeps the list view's type headings — without them the grid is strictly less
 * information than the list it replaces. */
function ZoneImages({
  title,
  cards,
  onSelect,
}: {
  title: string;
  cards: DeckSnapshotCard[];
  onSelect: (card: DeckSnapshotCard) => void;
}) {
  if (cards.length === 0) return null;
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  const groups = groupByType(cards);
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({total})</span>
      </h4>
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <div key={g.type}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.type}
            </p>
            {/* ~97px on a phone up to ~163px on a desktop: enough to recognise
                the art, never enough to read the card, so tiles enlarge. */}
            <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
              {g.cards.map((c, i) => (
                <CardTile
                  key={`${c.name}-${c.set}-${i}`}
                  card={{
                    card_name: c.name,
                    card_set: c.set,
                    card_img_file: c.imgFile,
                    quantity: c.quantity,
                  }}
                  onClick={() => onSelect(c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The enlarged face for one snapshot card — name-only when the art is missing,
 * mirroring CardTile's fallback. */
function EnlargedFace({ card }: { card: DeckSnapshotCard }) {
  const src = getCardImageUrl(card.imgFile || "");
  if (!src) {
    return (
      <div className="flex aspect-[2.5/3.5] w-full items-center justify-center rounded-lg bg-muted p-4 text-center text-sm font-medium text-muted-foreground">
        {card.name}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={card.name}
      width={500}
      height={700}
      className="h-auto w-full rounded-lg shadow-2xl"
    />
  );
}

const ISSUE_COLOR: Record<DeckCheckIssue["type"], string> = {
  error: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
};

export default function SubmissionModal({
  open,
  onOpenChange,
  tournamentId,
  participantId,
  participantName,
}: SubmissionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  // Text stays the default — it's the faster read for checking a list against
  // a physical deck. Images are for recognising cards the host doesn't know by
  // name. The choice sticks across opens so a host checking a row of decks
  // picks a view once.
  const [view, setView] = useState<"list" | "images">("list");
  const [enlarged, setEnlarged] = useState<DeckSnapshotCard | null>(null);

  useEffect(() => {
    if (!open || !participantId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSubmissionAction(tournamentId, participantId)
      .then((res) => {
        if (cancelled) return;
        if (res.success === true && res.submission) {
          setSubmission(res.submission);
        } else {
          setError(res.error ?? "not_found");
        }
      })
      .catch(() => {
        // Thrown server action / network failure — distinct from the
        // `{ success: false }` path above, which the action returns
        // normally. Without this, a rejection leaves `loading` true
        // forever and the modal is stuck on "Loading…" until closed and
        // reopened.
        if (cancelled) return;
        setError("load_failed");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, participantId, tournamentId]);

  // Clear stale data once the dialog closes so the next open doesn't briefly
  // flash the previous participant's deck before the fresh fetch resolves.
  useEffect(() => {
    if (!open) {
      setSubmission(null);
      setError(null);
      setEnlarged(null);
    }
  }, [open]);

  const mainCards = submission?.snapshot.cards.filter((c) => c.zone === "main") ?? [];
  const reserveCards = submission?.snapshot.cards.filter((c) => c.zone === "reserve") ?? [];

  // Flat display order (main groups → reserve groups) for the enlarged card's
  // prev/next. `groupByType` hands back the very snapshot objects ZoneImages
  // renders, so identity is enough to locate the clicked card.
  const navCards = [...groupByType(mainCards), ...groupByType(reserveCards)].flatMap(
    (g) => g.cards,
  );
  const enlargedIndex = enlarged ? navCards.indexOf(enlarged) : -1;
  const hasNav = enlargedIndex !== -1 && navCards.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `size="lg"` is only max-w-lg (512px) — fine for the text list, far too
          narrow for card art, which came out ~70px wide and unreadable. Widen
          it the way the other image-bearing modals do. */}
      <DialogContent size="lg" className="max-w-4xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>{submission?.snapshot.deckName ?? "Decklist"}</DialogTitle>
            {submission && <LegalityDot isLegal={submission.isLegal} />}
          </div>
          <p className="text-sm text-muted-foreground">{participantName}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && error && (
            <p className="text-sm text-destructive">Couldn't load the submission — try again.</p>
          )}
          {!loading && submission && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {submission.source === "player" ? "Submitted" : "Attached"} by{" "}
                  {submission.submittedByUsername ? `@${submission.submittedByUsername}` : "unknown"}
                  {" · "}
                  {new Date(submission.submittedAt).toLocaleString()}
                </p>
                <div
                  role="group"
                  aria-label="Decklist view"
                  className="flex flex-shrink-0 rounded-md border border-border p-0.5"
                >
                  {(["list", "images"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setView(mode)}
                      aria-pressed={view === mode}
                      className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                        view === mode
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              {submission.isLegal === false && submission.issues.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  {submission.issues.map((issue, i) => (
                    <p key={i} className={`text-xs ${ISSUE_COLOR[issue.type]}`}>
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}
              {view === "list" ? (
                <>
                  <ZoneSection title="Main deck" cards={mainCards} />
                  <ZoneSection title="Reserve" cards={reserveCards} />
                </>
              ) : (
                <>
                  <ZoneImages title="Main deck" cards={mainCards} onSelect={setEnlarged} />
                  <ZoneImages title="Reserve" cards={reserveCards} onSelect={setEnlarged} />
                </>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter className="justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Close
          </button>
        </DialogFooter>
        {/* Inside DialogContent so its backdrop click can't bubble out to the
            Dialog root and close the whole submission modal. */}
        {enlarged && (
          <CardEnlargeModal
            onClose={() => setEnlarged(null)}
            name={enlarged.name}
            qty={enlarged.quantity}
            subtitle={enlarged.set}
            nav={
              hasNav
                ? {
                    index: enlargedIndex,
                    total: navCards.length,
                    onNavigate: (delta) =>
                      setEnlarged(
                        navCards[(enlargedIndex + delta + navCards.length) % navCards.length],
                      ),
                  }
                : undefined
            }
          >
            <EnlargedFace card={enlarged} />
          </CardEnlargeModal>
        )}
      </DialogContent>
    </Dialog>
  );
}
