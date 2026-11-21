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
import { getSubmissionAction, updateSubmissionAsHostAction } from "@/app/tracker/tournaments/actions";
import DecklistEditor from "@/components/tournament/DecklistEditor";
import SubmissionPdfButton from "@/components/tournament/SubmissionPdfButton";
import { findCard } from "@/lib/cards/lookup";
import { sameCards, zoneTotals } from "@/lib/tournament/snapshotEdit";
import {
  DEFAULT_VIEW_PREFS, GROUP_LABELS, GROUPS, SORT_LABELS, SORTS, VIEW_PREFS_KEY, groupCards, parseViewPrefs,
  type SubmissionViewPrefs,
} from "@/lib/tournament/submissionView";
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
  /** The host saved a corrected list: the roster's legality dot and card count are out of date. */
  onChanged?: () => void;
}

interface SubmissionDetail {
  snapshot: DeckSnapshot;
  isLegal: boolean | null;
  issues: DeckCheckIssue[];
  submittedAt: string;
  source: "player" | "host";
  submittedByUsername: string | null;
  eventName: string;
  eventFormat: string | null;
}

type Group = { label: string; cards: DeckSnapshotCard[] };

const resolveCard = (c: DeckSnapshotCard) => findCard(c.name, c.set, c.imgFile ?? undefined);

function ZoneSection({ title, cards, groups }: { title: string; cards: DeckSnapshotCard[]; groups: Group[] }) {
  if (cards.length === 0) return null;
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({total})</span>
      </h4>
      <div className="mt-1.5 space-y-2">
        {groups.map((g) => (
          <div key={g.label}>
            {g.label && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
            )}
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
  groups,
  large,
  onSelect,
}: {
  title: string;
  cards: DeckSnapshotCard[];
  groups: Group[];
  /** Bigger tiles: fewer to a row, enough to read a card's title without enlarging it. */
  large: boolean;
  onSelect: (card: DeckSnapshotCard) => void;
}) {
  if (cards.length === 0) return null;
  const total = cards.reduce((n, c) => n + c.quantity, 0);
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground">({total})</span>
      </h4>
      <div className="mt-2 space-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            {g.label && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
            )}
            {/* Small: ~97px on a phone up to ~163px on a desktop, enough to recognise
                the art, never enough to read the card, so tiles enlarge. */}
            <div
              className={`mt-1.5 grid gap-2 ${
                large
                  ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                  : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6"
              }`}
            >
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

const selectClass =
  "h-7 rounded-md border border-border bg-background py-0 pl-2 pr-7 text-xs font-medium leading-none text-foreground focus:border-foreground/40 focus:outline-none focus:ring-0";

/** A small two-way switch, as the view toggle has always been. */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-shrink-0 rounded-md border border-border p-0.5">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            value === option ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
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
  onChanged,
}: SubmissionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  // Card art is the default, and how the deck is shown is the host's to set once: the view, grouping, order and
  // tile size are kept in this browser, so they hold across decks, events and reloads.
  const [prefs, setPrefs] = useState<SubmissionViewPrefs>(() => {
    try {
      return parseViewPrefs(window.localStorage.getItem(VIEW_PREFS_KEY));
    } catch {
      return DEFAULT_VIEW_PREFS;
    }
  });
  const setPref = (patch: Partial<SubmissionViewPrefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked or full: the choice still holds until the page goes.
      }
      return next;
    });
  const [enlarged, setEnlarged] = useState<DeckSnapshotCard | null>(null);
  // The list while the host corrects it; null when only viewing.
  const [draft, setDraft] = useState<DeckSnapshotCard[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [reload, setReload] = useState(0);

  const save = async () => {
    if (!draft || !participantId || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const res = await updateSubmissionAsHostAction(tournamentId, participantId, draft);
      if (res.success !== true) throw new Error(res.error ?? "save failed");
      setDraft(null);
      setReload((n) => n + 1);
      onChanged?.();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

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
  }, [open, participantId, tournamentId, reload]);

  // Clear stale data once the dialog closes so the next open doesn't briefly
  // flash the previous participant's deck before the fresh fetch resolves.
  useEffect(() => {
    if (!open) {
      setSubmission(null);
      setError(null);
      setEnlarged(null);
      setDraft(null);
      setSaveError(false);
    }
  }, [open]);

  const mainCards = submission?.snapshot.cards.filter((c) => c.zone === "main") ?? [];
  const reserveCards = submission?.snapshot.cards.filter((c) => c.zone === "reserve") ?? [];
  const mainGroups = groupCards(mainCards, prefs, resolveCard);
  const reserveGroups = groupCards(reserveCards, prefs, resolveCard);

  // Flat display order (main groups → reserve groups) for the enlarged card's
  // prev/next. `groupCards` hands back the very snapshot objects ZoneImages
  // renders, so identity is enough to locate the clicked card.
  const navCards = [...mainGroups, ...reserveGroups].flatMap((g) => g.cards);
  const enlargedIndex = enlarged ? navCards.indexOf(enlarged) : -1;
  const hasNav = enlargedIndex !== -1 && navCards.length > 1;

  const editing = draft !== null;
  const draftTotals = draft ? zoneTotals(draft) : null;
  const draftChanged = draft !== null && submission !== null && !sameCards(submission.snapshot.cards, draft);

  return (
    // While the list is being corrected, Escape and a click outside belong to the card picker open over it, and
    // would otherwise also close this window and throw the edits away: Cancel and Save are the ways out.
    <Dialog open={open} onOpenChange={(o) => (editing && !o ? undefined : onOpenChange(o))}>
      {/* `size="lg"` is only max-w-lg (512px) — fine for the text list, far too
          narrow for card art, which came out ~70px wide and unreadable. Widen
          it the way the other image-bearing modals do. One height: sized to
          its content, the centered box re-centered when "Loading…" gave way
          to the deck and when the view toggled. */}
      <DialogContent size="lg" className="max-w-4xl h-[85vh]">
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
          {!loading && submission && editing && (
            <>
              <p className="text-xs text-muted-foreground">
                Tap a card&apos;s name to swap it, or use − and + to change how many. Saving replaces the list on
                record for {participantName || "this player"} and checks it against the event&apos;s format.
              </p>
              <DecklistEditor cards={draft} onChange={setDraft} editable={!saving} />
            </>
          )}
          {!loading && submission && !editing && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="text-xs text-muted-foreground">
                  {submission.source === "player" ? "Submitted" : "Attached"} by{" "}
                  {submission.submittedByUsername ? `@${submission.submittedByUsername}` : "unknown"}
                  {" · "}
                  {new Date(submission.submittedAt).toLocaleString()}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Group
                    <select
                      value={prefs.group}
                      onChange={(e) => setPref({ group: e.target.value as SubmissionViewPrefs["group"] })}
                      className={selectClass}
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {GROUP_LABELS[g]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Sort
                    <select
                      value={prefs.sort}
                      onChange={(e) => setPref({ sort: e.target.value as SubmissionViewPrefs["sort"] })}
                      className={selectClass}
                    >
                      {SORTS.map((s) => (
                        <option key={s} value={s}>
                          {SORT_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {prefs.view === "images" && (
                    <Segmented
                      label="Card size"
                      options={[["small", "Small"], ["large", "Large"]]}
                      value={prefs.size}
                      onChange={(size) => setPref({ size })}
                    />
                  )}
                  <Segmented
                    label="Decklist view"
                    options={[["images", "Images"], ["list", "List"]]}
                    value={prefs.view}
                    onChange={(view) => setPref({ view })}
                  />
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
              {prefs.view === "list" ? (
                <>
                  <ZoneSection title="Main deck" cards={mainCards} groups={mainGroups} />
                  <ZoneSection title="Reserve" cards={reserveCards} groups={reserveGroups} />
                </>
              ) : (
                <>
                  <ZoneImages title="Main deck" cards={mainCards} groups={mainGroups} large={prefs.size === "large"} onSelect={setEnlarged} />
                  <ZoneImages title="Reserve" cards={reserveCards} groups={reserveGroups} large={prefs.size === "large"} onSelect={setEnlarged} />
                </>
              )}
            </>
          )}
        </DialogBody>
        {editing ? (
          <DialogFooter className="items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
              {saveError ? (
                <span className="text-destructive">Couldn&apos;t save. Try again.</span>
              ) : (
                <>Main {draftTotals?.main ?? 0} · Reserve {draftTotals?.reserve ?? 0}</>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setSaveError(false);
                }}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !draftChanged}
                className="px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save list"}
              </button>
            </div>
          </DialogFooter>
        ) : (
          <DialogFooter className="justify-end gap-2">
            {submission && !loading && (
              // Keyed by the save time: after the host corrects the list, the PDF is made again from the new one.
              <SubmissionPdfButton
                key={submission.submittedAt}
                fileName={`${participantName} ${submission.snapshot.deckName}`}
                className="mr-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-60"
                load={() => ({
                  cards: submission.snapshot.cards,
                  format: submission.eventFormat,
                  playerName: participantName,
                  eventName: submission.eventName,
                  isLegal: submission.isLegal,
                })}
              />
            )}
            {submission && !loading && (
              <button
                type="button"
                onClick={() => setDraft(submission.snapshot.cards)}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Edit list
              </button>
            )}
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-lg hover:bg-muted transition-colors"
            >
              Close
            </button>
          </DialogFooter>
        )}
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
