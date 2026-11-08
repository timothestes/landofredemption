"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, ChevronLeft, ChevronRight, Loader2, Check, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { upload } from "@vercel/blob/client";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import FilePicker from "@/app/forge/components/FilePicker";
import ArtCandidatesPanel from "@/app/forge/components/ArtCandidatesPanel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { cn } from "@/lib/utils";
import { saveCardFields, uploadFinished, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import { sameSnapshot } from "@/app/forge/lib/cardDiff";
import { createCardSaver, incomingAction } from "@/app/forge/lib/cardSave";
import { STATUS_BADGE_CLASS } from "@/app/forge/lib/lifecycleCopy";
import { versionPill, type StudioVersion } from "@/app/forge/lib/studioVersion";
import type { ArtCandidate } from "@/app/forge/lib/artCandidates";
import type { ReleaseBase, RestoreTarget } from "@/app/forge/lib/lifecycleCopy";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";
import { StudioDraftProvider, StudioSyncProvider } from "./StudioSyncContext";
import CardDetailsFields from "./CardDetailsFields";
import CopyCardImageButton from "./CopyCardImageButton";
import ScriptureFields from "./ScriptureFields";

// DESCOPE (2026-07-03): the structured template (FullModeForm) was removed from the
// studio; it remains on disk (unused) for recovery. A card is a name + raw text +
// optional details + optional artwork + optional finished-card image.
// The composite renderer (ForgeCardPreview) came back on 2026-09-10 (#387): while
// there is no finished-card image, it draws the live snapshot in the design team's frame.

// Prev/next arrows on the card face. From sm up they sit inside its edges; on a phone the
// face is narrow enough to leave a gutter each side, so they sit there, off the small card.
const arrowClass =
  "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/70 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground";

export default function StudioEditor({
  card, sets, currentUser, creator, setId, setName, prevId, nextId, position, artCandidates, openProposals, releaseBase, restoreTarget, version = null, review,
}: {
  card: ForgeCardFull;
  sets: ForgeSetSummary[];
  currentUser: { userId: string; displayName: string | null };
  // Original author of the card (forge_cards.owner_id) — resolved server-side.
  creator: { name: string; at: string };
  setId: string | null;
  setName: string | null;
  prevId?: string | null;
  nextId?: string | null;
  // Where this card sits in the set's grid order, when there is more than one.
  position?: { index: number; total: number } | null;
  artCandidates: ArtCandidate[];
  // Passed straight to LifecycleControls for the release dialog's heads-up.
  openProposals?: { count: number; hasMatch: boolean };
  // Also for the release dialog: what the draft is compared against.
  releaseBase?: ReleaseBase | null;
  // For the Restore dialog on a shelved card: where it will go back to.
  restoreTarget?: RestoreTarget | null;
  version?: StudioVersion | null;
  // The review column (proposals / history / comments), rendered inside this component's
  // grid so the sticky card face keeps travelling alongside it. Built in the server
  // component, so it is an element, not a render prop — it cannot take callbacks.
  review?: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<DesignCard>(card.snapshot ?? {});
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dirty, setDirty] = useState(false);
  // A write from elsewhere arrived while this session had an unsaved edit, so adopting it
  // would have thrown that edit away. Offered as a choice instead.
  const [stale, setStale] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  const fieldsDirty = useRef(false);
  const latest = useRef(snapshot);       // most recent edit (for flush-on-leave)
  // This session's view of the server, and the base of every save's diff. Moves when a save
  // is accepted or a write from elsewhere is adopted, never just because the props changed.
  // That is what keeps a field another elder changed out of this session's saves.
  const lastSaved = useRef(snapshot);
  const savedRef = useRef(saved);
  const [saver] = useState(() => createCardSaver({
    latest,
    lastSaved,
    send: (patch) => saveCardFields(card.id, patch),
  }));
  const [pendingFinished, setPendingFinished] = useState<File | null>(null);
  const [uploading, setUploading] = useState<"finished" | null>(null);
  // The verse finder's candidate excerpt, drawn on the preview face only. Never saved.
  const [previewScripture, setPreviewScripture] = useState<string | null>(null);
  const [peeking, setPeeking] = useState(false); // the large face over the form, below lg
  const router = useRouter();

  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );

  // Every save goes through here, so the pill can't be left on "Saving…": the saver resolves
  // false instead of throwing when the connection drops. The edit stays in the editor, and
  // diffing against lastSaved keeps its fields in the next attempt.
  const runSave = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaved("saving");
    const ok = await saver.flush();
    if (ok && sameSnapshot(latest.current, lastSaved.current)) setDirty(false);
    setSaved(ok ? "saved" : "error");
    return ok;
  }, [saver]);

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    latest.current = snapshot;
    if (firstRender.current) { firstRender.current = false; return; }
    // Content, not identity: update() always builds a new object, and an adopted snapshot
    // must not be echoed straight back to the server. Against what the server will hold, not
    // lastSaved: an edit undone while its save is in flight still needs saving.
    if (sameSnapshot(snapshot, saver.target())) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void runSave(); }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id, saver, runSave]);

  useEffect(() => { savedRef.current = saved; }, [saved]);

  // `snapshot` is seeded from props once; router.refresh() re-renders WITHOUT remounting,
  // so every server-side write to working_snapshot — Apply suggestion, Accept proposal,
  // another elder saving — used to be invisible here, and the next keystroke autosaved the
  // stale copy back over it. Compared by content: revalidatePath means card.updatedAt
  // changes on every autosave, so a timestamp guard would fire every 700ms.
  // A save merges into the row, so what comes back can hold more than this session sent.
  // That is another elder's field, adopted here once this session has nothing unsaved.
  useEffect(() => {
    const incoming = card.snapshot ?? {};
    const action = incomingAction({
      incoming, latest: latest.current, lastSaved: lastSaved.current, busy: saver.busy(),
    });
    if (action === "ignore") return;   // nothing new, or our own write
    if (action === "stale") { setStale(true); return; }
    lastSaved.current = incoming;
    latest.current = incoming;
    setSnapshot(incoming);
    setStale(false);
  }, [card.snapshot, saver]);

  // Clicking a nav link within the debounce window unmounts this editor before the
  // timer fires — flush the pending edit so it isn't silently dropped. A hard
  // unload (close tab, reload) gets the browser's leave prompt instead.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver.clean()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      saver.leave(window);
    };
  }, [card.id, saver]);

  // A save that failed offline goes out by itself on reconnect, with no keystroke or Retry.
  useEffect(() => {
    const onOnline = () => { if (savedRef.current === "error") void runSave(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [runSave]);

  // Arrow keys step to the prev/next card in the set — but only when focus is
  // outside a field, so they still move the text cursor while editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;                                   // holding an arrow is not 30 cards
      if (document.querySelector('[role="dialog"]')) return;  // Radix mounts this only while open
      // Only walk the set when focus is nowhere in particular. The old blocklist missed
      // <summary> and <button>, so a stray ArrowRight while a Resolve button had focus
      // navigated off the card.
      const el = document.activeElement;
      if (el && el !== document.body && el !== document.documentElement) return;
      const dest = e.key === "ArrowLeft" ? prevId : nextId;
      if (!dest) return;
      e.preventDefault();
      router.push(`/forge/cards/${dest}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevId, nextId, router]);

  const update = (patch: Partial<DesignCard>) => {
    fieldsDirty.current = true;
    setDirty(true);
    setSnapshot((s) => ({ ...s, ...patch }));
  };

  // "Save failed" used to be a dead end: no retry, and nothing announced it. Retries the
  // newest edit through the same state machine the debounce uses.
  const retrySave = () => { void runSave(); };

  // Handed to the review column so Apply/Accept can land on top of this session's edits
  // instead of racing the 700ms debounce. See StudioSyncContext for why it must be context.
  const flushPending = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (saver.clean()) return { ok: true };
    return { ok: await runSave() };
  }, [saver, runSave]);

  // Memoized: a fresh value object would force every context consumer to re-render on
  // each keystroke, which is exactly the re-render the stable `review` element avoids.
  const syncValue = useMemo(() => ({ flushPending }), [flushPending]);

  // Adopt the version written elsewhere, discarding this session's unsaved edit.
  const adoptIncoming = () => {
    const incoming = card.snapshot ?? {};
    lastSaved.current = incoming;
    latest.current = incoming;
    setSnapshot(incoming);
    setStale(false);
    setDirty(false);
    setSaved((s) => (s === "error" ? "idle" : s));   // nothing of this session's is left to fail
  };

  async function onUpload(file: File, kind: "finished") {
    setErr(null);
    setUploading(kind);
    try {
      const blob = await upload(`forge-art-raw/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/forge/api/art/upload-token",
      });
      const r = await uploadFinished(card.id, blob.pathname);
      if (r.ok === false) setErr(r.error ?? "Upload failed");
      else router.refresh();
    } catch (e) {
      // Previously uncaught: the spinner cleared (finally still ran) but nothing told
      // the user it failed — a silent no-op. Now it does.
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  // Cache-buster: updated_at bumps on every image/snapshot write, so the browser can
  // cache each t-stamped art URL indefinitely and still swap after router.refresh().
  const t = Date.parse(card.updatedAt) || 0;
  const activeSourceId = artCandidates.find((c) => c.isActiveSource)?.id ?? null;
  const previewCard = previewScripture === null ? snapshot : { ...snapshot, scripture: previewScripture };
  // Local, like the face and the field: card.title only catches up after the save and a refresh.
  // A name still undefined means it was never edited, so a title set at creation stands.
  const crumbName = (snapshot.name ?? card.title)?.trim() || "Untitled";
  // Follows the local draft too (never previewCard: a verse being previewed is not an edit).
  const pill = card.setId ? versionPill(card.status, version, snapshot) : null;
  const versionBadge = pill && (
    <span title={pill.title} className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] tabular-nums", STATUS_BADGE_CLASS[card.status])}>
      {pill.label}
    </span>
  );

  const face = card.hasFinished ? (
    <ForgeCardFace
      name={snapshot.name ?? null}
      rawText={cardRawText(snapshot)}
      finishedUrl={`/forge/api/art/${card.id}?kind=finished&t=${t}`}
      artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null}
    />
  ) : (
    <ForgeCardPreview card={previewCard} artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null} />
  );

  return (
    <div className="mx-auto max-w-5xl p-4">
      <PresenceBar others={others} />
      {stale && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span>
            This card changed elsewhere while you were editing. Your unsaved edit is still here —
            saving keeps yours.
          </span>
          <Button variant="outline" className="ml-auto h-6 px-2 text-[11px]" onClick={adoptIncoming}>
            Load their version
          </Button>
        </div>
      )}
      {/* Pinned under the Forge chrome: on a card with real history this page runs past
          3000px, and which set/card you are in — plus whether your edit saved — are
          exactly what you need while you are down in the comments. Must be a direct child
          of the padded wrapper; inside the flex-col below it would unstick immediately. */}
      <div className="sticky top-[var(--forge-chrome)] z-30 -mx-4 mb-2 flex items-center justify-between gap-3 border-b bg-background px-4 py-2">
        <ForgeBreadcrumbs
          className="mb-0 min-w-0 flex-1 text-sm"
          oneLine
          items={
            card.setId
              ? [
                  { label: "The Forge", href: "/forge" },
                  { label: "Sets", href: "/forge/sets" },
                  { label: setName ?? "Set", href: `/forge/sets/${card.setId}/cards` },
                  { label: crumbName },
                ]
              : [
                  { label: "The Forge", href: "/forge" },
                  { label: "Ideas", href: "/forge/ideas" },
                  { label: crumbName },
                ]
          }
        />
        <div className="flex shrink-0 items-center gap-2">
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground",
              saved === "idle" && !dirty && "hidden",
              saved === "error" && "border-destructive/40 text-destructive",
            )}
          >
            {saved === "saving" ? (
              <><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />Saving…</>
            ) : saved === "error" ? (
              <><AlertTriangle className="h-3 w-3" aria-hidden="true" />Save failed</>
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              <><Check className="h-3 w-3" aria-hidden="true" />Saved</>
            )}
          </span>
          {saved === "error" && (
            <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={retrySave}>
              Retry
            </Button>
          )}
          {/* Last in the row, so it holds still while the save pill changes width. Below lg the
              row has no room for it: it sits on the Created by line, out of the sticky chrome. */}
          {versionBadge && <span className="hidden lg:inline-flex">{versionBadge}</span>}
        </div>
        {/* Below lg the face sits above the form and scrolls away; this brings it back without
            losing your place. In this row, not over the form, so it never covers a field. The
            negative margin keeps a 36px target from making the row taller. */}
        <Button variant="ghost" aria-label={peeking ? "Hide card" : "Show card"} title={peeking ? "Hide card" : "Show card"}
          className="-my-2 -mr-2 h-9 w-9 shrink-0 p-0 text-muted-foreground lg:hidden" onClick={() => setPeeking(!peeking)}>
          {peeking ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      <div className="mb-3 flex flex-col gap-2 text-sm">
        {/* One line whatever the pill says: it grows on the first edit, and a wrap here would
            move the form under the caret. */}
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            Created by <span className="font-medium text-foreground">{creator.name}</span>
            {" · "}
            {new Date(creator.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
          {versionBadge && <span className="inline-flex shrink-0 leading-4 lg:hidden">{versionBadge}</span>}
        </div>
        <LifecycleControls card={card} draft={snapshot} flushPending={flushPending} releaseBase={releaseBase} restoreTarget={restoreTarget} sets={sets} openProposals={openProposals} />
        {card.setId && (
          <p className="text-xs text-muted-foreground">
            Releases are visible to Forge playtesters only — they don’t change the public card database.
          </p>
        )}
      </div>

      {/* As large as fits under the chrome, at the card's aspect ratio. */}
      {peeking && (
        <div className="fixed right-4 top-[calc(var(--forge-chrome)+3rem)] z-20 w-[min(100vw-2rem,24rem,(100svh-11rem)*0.714)] rounded-lg shadow-lg lg:hidden">
          {face}
        </div>
      )}

      {/* lg, not md: at 768–1023px a 360px face track left the review column at 352px and
          shrank ProposalDiff's paired faces to 157px. Below lg this is one column. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* Face — sticky beside the form AND the review; single column below lg.
            self-start is load-bearing: a stretched grid item has no sticky travel. The
            max-height keeps the card's verse and footer reachable on short viewports,
            where 112px of chrome + a 504px card would otherwise run past the fold with
            no way to scroll to it. */}
        <div className="lg:sticky lg:top-[calc(var(--forge-chrome)+3rem)] lg:self-start lg:max-h-[calc(100dvh-var(--forge-chrome)-4rem)] lg:overflow-y-auto">
          {/* Capped in the single-column range so a full-width face isn't 1030px of card to
              scroll past before reaching the name field. Uncapped in the lg grid, where it
              fills the 360px track. On a phone, sized from the screen height so Name still
              starts on the first screen; tap it for the large view. */}
          <div className="relative mx-auto w-[28svh] sm:w-auto sm:max-w-sm lg:max-w-none">
            {face}
            <button type="button" aria-label="Show the card larger" className="absolute inset-0 sm:hidden"
              onClick={() => setPeeking(true)} />
            {/* Prev/next within the set — same order as the grid, no wrap at ends. */}
            {prevId && (
              <Link href={`/forge/cards/${prevId}`} aria-label="Previous card in set" className={arrowClass + " -left-11 sm:left-1.5"}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            {nextId && (
              <Link href={`/forge/cards/${nextId}`} aria-label="Next card in set" className={arrowClass + " -right-11 sm:right-1.5"}>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            {/* Copy the face as a PNG to share. Tucked into the bottom-right corner, small
                enough to sit over the frame's blank corner (in the gutter on a phone, with the
                arrows). The draft is flushed first so the server renders what is on screen,
                not the last autosave. */}
            <CopyCardImageButton
              className="absolute bottom-0 -right-10 z-10 sm:bottom-1.5 sm:right-1.5"
              src={card.hasFinished
                ? `/forge/api/art/${card.id}?kind=finished&t=${t}`
                : `/forge/api/art/${card.id}?kind=rendered&v=working`}
              prepare={async () => { if (!(await flushPending()).ok) throw new Error("unsaved edit"); }}
              onError={setErr}
            />
          </div>
          {position && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {position.index} of {position.total}
              <span className="hidden lg:inline"> · ← → to move</span>
            </p>
          )}
        </div>

        {/* Form + review in one column, so the sticky face travels past the review too.
            The presence focus handlers stay on the form only — typing a comment should not
            flag you as editing the card. */}
        <div className="min-w-0 space-y-6">
          <div className="space-y-4" onFocusCapture={() => setEditing(true)} onBlurCapture={() => setEditing(false)}>
            {err && <p className="text-sm text-destructive">{err}</p>}

            <input autoFocus={!card.title?.trim()} value={snapshot.name ?? ""} onChange={(e) => update({ name: e.target.value })}
              placeholder="Name your card…" className="w-full rounded-md border bg-background px-3 py-2 text-lg" />

            <textarea value={snapshot.rawText ?? ""} onChange={(e) => update({ rawText: e.target.value })}
              placeholder="Type the card's special ability."
              className="max-h-[60vh] min-h-40 w-full rounded-md border bg-background px-3 py-2 text-sm [field-sizing:content]" />

            <ScriptureFields snapshot={snapshot} update={update} onPreview={setPreviewScripture} />

            <CardDetailsFields snapshot={snapshot} update={update} />

            {/* Artwork (illustration) */}
            <fieldset className="rounded-lg border bg-card p-4">
              <legend className="px-1 text-sm font-medium">Artwork (illustration)</legend>
              <ArtCandidatesPanel cardId={card.id} candidates={artCandidates} cardName={snapshot.name ?? null} />
              <label className="mt-3 flex items-start gap-2">
                <Checkbox className="mt-0.5" checked={!!card.isPlaceholder}
                  onCheckedChange={async () => { await setPlaceholder(card.id, !card.isPlaceholder); router.refresh(); }} />
                <span>
                  <span className="font-medium">Temporary / placeholder art</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Placeholder art isn’t shown in playtests — upload final art and uncheck when it’s ready.
                  </span>
                </span>
              </label>
              {card.hasArt && (
                <a href={activeSourceId
                  ? `/forge/api/art/${card.id}?candidate=${activeSourceId}&download=1`
                  : `/forge/api/art/${card.id}?download=1`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Download original
                </a>
              )}
            </fieldset>

            {/* Finished card (full composed image) */}
            <fieldset className="rounded-lg border bg-card p-4">
              <legend className="px-1 text-sm font-medium">
                Finished card (full composed image)
                {uploading === "finished" && <span className="ml-2 text-xs text-muted-foreground">Uploading…</span>}
              </legend>
              <FilePicker label="Choose image…" accept="image/jpeg,image/png,image/webp,.tif,.tiff,image/tiff" disabled={uploading !== null}
                onFile={(f) => {
                  // Replacing an existing finished image without touching any field this session
                  // usually means the printed ability text changed — confirm before overwriting.
                  if (card.hasFinished && !fieldsDirty.current) setPendingFinished(f);
                  else onUpload(f, "finished");
                }} />
              <p className="mt-2 text-xs text-muted-foreground">
                A finished card image made elsewhere. When present, it’s shown everywhere instead of the artwork.
              </p>
              {card.hasFinished && (
                <a href={`/forge/api/art/${card.id}?kind=finished&download=1`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Download finished card
                </a>
              )}
            </fieldset>
          </div>
          <StudioSyncProvider value={syncValue}>
            <StudioDraftProvider value={snapshot}>{review}</StudioDraftProvider>
          </StudioSyncProvider>
        </div>
      </div>

      <ConfirmationDialog
        open={pendingFinished !== null}
        onOpenChange={(o) => { if (!o) setPendingFinished(null); }}
        onConfirm={() => { const f = pendingFinished; setPendingFinished(null); if (f) onUpload(f, "finished"); }}
        variant="warning"
        title="Replace image without updating the card fields?"
        description="You're replacing the finished card image but haven't changed any card fields this session. If the new image changed the ability text, update the fields to match."
        confirmLabel="Replace anyway"
      />
    </div>
  );
}
