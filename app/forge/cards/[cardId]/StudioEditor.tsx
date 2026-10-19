"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, ChevronLeft, ChevronRight, Loader2, Check, AlertTriangle } from "lucide-react";
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
import { saveCard, uploadFinished, setPlaceholder, type ForgeCardFull } from "@/app/forge/lib/cards";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import { sameSnapshot } from "@/app/forge/lib/cardDiff";
import type { ArtCandidate } from "@/app/forge/lib/artCandidates";
import LifecycleControls from "./LifecycleControls";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";
import { forgeCardTopic } from "@/app/forge/lib/realtime";
import { useForgeCardChannel } from "@/app/forge/lib/useForgeRealtime";
import PresenceBar from "./PresenceBar";
import { StudioSyncProvider } from "./StudioSyncContext";
import CardDetailsFields from "./CardDetailsFields";
import ScriptureFields from "./ScriptureFields";

// DESCOPE (2026-07-03): the structured template (FullModeForm) was removed from the
// studio; it remains on disk (unused) for recovery. A card is a name + raw text +
// optional details + optional artwork + optional finished-card image.
// The composite renderer (ForgeCardPreview) came back on 2026-09-10 (#387): while
// there is no finished-card image, it draws the live snapshot in the design team's frame.

// Prev/next arrows overlaid on the card face edges. Inside the edges (not the
// gutter) so they never clip on mobile.
const arrowClass =
  "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border bg-background/70 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground";

export default function StudioEditor({
  card, sets, currentUser, creator, setId, setName, prevId, nextId, position, artCandidates, openProposals, review,
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
  const lastSaved = useRef(snapshot);    // last snapshot the server accepted
  const savedRef = useRef(saved);
  const [pendingFinished, setPendingFinished] = useState<File | null>(null);
  const [uploading, setUploading] = useState<"finished" | null>(null);
  // The verse finder's candidate excerpt, drawn on the preview face only. Never saved.
  const [previewScripture, setPreviewScripture] = useState<string | null>(null);
  const router = useRouter();

  const { others, setEditing } = useForgeCardChannel(
    setId ? forgeCardTopic(card.id) : null,
    { userId: currentUser.userId, displayName: currentUser.displayName, editing: false },
  );

  // Debounced autosave — fires only after the user edits (skips mount).
  useEffect(() => {
    latest.current = snapshot;
    if (firstRender.current) { firstRender.current = false; return; }
    // Content, not identity: update() always builds a new object, and an adopted snapshot
    // must not be echoed straight back to the server.
    if (sameSnapshot(snapshot, lastSaved.current)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved("saving");
      const r = await saveCard(card.id, snapshot);
      if (r.ok) { lastSaved.current = snapshot; setDirty(false); }
      setSaved(r.ok ? "saved" : "error");
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, card.id]);

  useEffect(() => { savedRef.current = saved; }, [saved]);

  // `snapshot` is seeded from props once; router.refresh() re-renders WITHOUT remounting,
  // so every server-side write to working_snapshot — Apply suggestion, Accept proposal,
  // another elder saving — used to be invisible here, and the next keystroke autosaved the
  // stale copy back over it. Compared by content: revalidatePath means card.updatedAt
  // changes on every autosave, so a timestamp guard would fire every 700ms.
  useEffect(() => {
    const incoming = card.snapshot ?? {};
    if (sameSnapshot(incoming, lastSaved.current)) return;   // nothing new, or our own write
    if (!sameSnapshot(latest.current, lastSaved.current)) { setStale(true); return; }
    lastSaved.current = incoming;
    latest.current = incoming;
    setSnapshot(incoming);
    setStale(false);
  }, [card.snapshot]);

  // Clicking a nav link within the debounce window unmounts this editor before the
  // timer fires — flush the pending edit so it isn't silently dropped. A hard
  // unload (close tab, reload) gets the browser's leave prompt instead.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!sameSnapshot(latest.current, lastSaved.current) || savedRef.current === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (!sameSnapshot(latest.current, lastSaved.current)) void saveCard(card.id, latest.current);
    };
  }, [card.id]);

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
  const retrySave = async () => {
    const pending = latest.current;
    setSaved("saving");
    const r = await saveCard(card.id, pending);
    if (r.ok) { lastSaved.current = pending; setDirty(false); }
    setSaved(r.ok ? "saved" : "error");
  };

  // Handed to the review column so Apply/Accept can land on top of this session's edits
  // instead of racing the 700ms debounce. See StudioSyncContext for why it must be context.
  const flushPending = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const pending = latest.current;
    if (sameSnapshot(pending, lastSaved.current)) return { ok: true };
    setSaved("saving");
    const r = await saveCard(card.id, pending);
    if (r.ok) { lastSaved.current = pending; setDirty(false); }
    setSaved(r.ok ? "saved" : "error");
    return { ok: !!r.ok };
  }, [card.id]);

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
          className="mb-0 min-w-0 text-sm"
          items={
            card.setId
              ? [
                  { label: "The Forge", href: "/forge" },
                  { label: "Sets", href: "/forge/sets" },
                  { label: setName ?? "Set", href: `/forge/sets/${card.setId}/cards` },
                  { label: card.title?.trim() || "Untitled" },
                ]
              : [
                  { label: "The Forge", href: "/forge" },
                  { label: "Ideas", href: "/forge/ideas" },
                  { label: card.title?.trim() || "Untitled" },
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
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 text-sm">
        <p className="text-xs text-muted-foreground">
          Created by <span className="font-medium text-foreground">{creator.name}</span>
          {" · "}
          {new Date(creator.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
        <LifecycleControls card={card} sets={sets} openProposals={openProposals} />
        {card.setId && (
          <p className="text-xs text-muted-foreground">
            Releases are visible to Forge playtesters only — they don’t change the public card database.
          </p>
        )}
      </div>

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
              fills the 360px track. */}
          <div className="relative mx-auto max-w-sm lg:max-w-none">
            {card.hasFinished ? (
              <ForgeCardFace
                name={snapshot.name ?? null}
                rawText={cardRawText(snapshot)}
                finishedUrl={`/forge/api/art/${card.id}?kind=finished&t=${t}`}
                artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null}
              />
            ) : (
              <ForgeCardPreview card={previewCard} artUrl={card.hasArt ? `/forge/api/art/${card.id}?t=${t}` : null} />
            )}
            {/* Prev/next within the set — same order as the grid, no wrap at ends. */}
            {prevId && (
              <Link href={`/forge/cards/${prevId}`} aria-label="Previous card in set" className={arrowClass + " left-1.5"}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            {nextId && (
              <Link href={`/forge/cards/${nextId}`} aria-label="Next card in set" className={arrowClass + " right-1.5"}>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
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
          <StudioSyncProvider value={syncValue}>{review}</StudioSyncProvider>
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
