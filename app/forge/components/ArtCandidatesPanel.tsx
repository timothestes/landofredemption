"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2, Trash2 } from "lucide-react";
import { upload } from "@vercel/blob/client";
import FilePicker from "@/app/forge/components/FilePicker";
import CropCandidateModal from "@/app/forge/components/CropCandidateModal";
import SourceLinkDialog from "@/app/forge/components/SourceLinkDialog";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { activateCandidate, addArtCandidate, deleteArtCandidate, type ArtCandidate } from "@/app/forge/lib/artCandidates";
import { pendingTiles, uploadHint, type UploadBatch } from "@/app/forge/lib/artUploadProgress";
import { withDeadline } from "@/app/forge/lib/withDeadline";

// Candidate blobs are immutable (a row is written once, never replaced), so a
// constant t cache-buster is enough for the proxy's immutable caching.
const candidateUrl = (cardId: string, id: string) => `/forge/api/art/${cardId}?candidate=${id}&t=c`;

const USE_FAILED = "Couldn’t switch the artwork. Check your connection and try again.";
const DELETE_FAILED = "Couldn’t delete that image. Check your connection and try again.";

export default function ArtCandidatesPanel({
  cardId, candidates, cardName,
}: {
  cardId: string;
  candidates: ArtCandidate[];
  cardName: string | null;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<UploadBatch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cropping, setCropping] = useState<string | null>(null); // candidate id
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(null); // candidate id
  // The image being switched to or deleted, one at a time.
  const [acting, setActing] = useState<{ id: string; kind: "use" | "delete" } | null>(null);
  const busy = acting !== null || progress !== null;

  async function onFiles(files: File[]) {
    setErr(null);
    const errors: string[] = [];
    const before = candidates.length;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length, name: files[i].name, failed: errors.length, before });
      try {
        const blob = await upload(`forge-art-raw/${files[i].name}`, files[i], {
          access: "private",
          handleUploadUrl: "/forge/api/art/upload-token",
        });
        const r = await addArtCandidate(cardId, blob.pathname);
        if (r.ok === false) errors.push(`${files[i].name}: ${r.error ?? "failed"}`);
        // Refresh per file, not once per batch — each finished upload swaps its
        // skeleton tile for the real thumbnail, so a slow batch never looks hung.
        else router.refresh();
      } catch (e) {
        // Previously an uncaught throw here (e.g. a 413 from an oversized file) left
        // `progress` set forever — a permanent spinner. Catching it keeps the batch
        // going and reports the failure like any other per-file error.
        errors.push(`${files[i].name}: ${e instanceof Error ? e.message : "Upload failed"}`);
      }
    }
    if (errors.length > 0) setErr(errors.join(" · "));
    if (errors.length === files.length) {
      setProgress(null);
      router.refresh();
      return;
    }
    // In one commit with the refreshed page, so the spinner turns into the image. Cleared any
    // earlier, it left seconds with no spinner and the old count, which looked like a failed upload.
    setProgress({ done: files.length, total: files.length, name: "", failed: errors.length, before });
    startTransition(() => {
      setProgress(null);
      router.refresh();
    });
  }

  // Same as an upload's spinner: the tile only changes with the refreshed page, so the spinner
  // lasts until then. Refreshes after a failure too: past the deadline, the action may have landed.
  async function act(id: string, kind: "use" | "delete", action: Promise<{ ok: boolean; error?: string }>, failed: string) {
    setErr(null);
    setActing({ id, kind });
    const r = await withDeadline(action, { ok: false, error: failed });
    if (r.ok === false) {
      setErr(r.error ?? failed);
      setActing(null);
      router.refresh();
      return;
    }
    settle();
  }

  function settle() {
    startTransition(() => {
      setActing(null);
      router.refresh();
    });
  }

  return (
    <div>
      <FilePicker label="Add images…" accept="image/jpeg,image/png,image/webp,.tif,.tiff,image/tiff" multiple
        disabled={busy} onFiles={onFiles}
        hint={progress ? uploadHint(progress) : `${candidates.length}/12 · click an image to crop`} />
      {err && <p role="status" className="mt-2 text-sm text-destructive">{err}</p>}

      {(candidates.length > 0 || progress !== null) && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {candidates.map((c) => (
            <li key={c.id}>
              <div className="group relative">
                <button type="button" className="block w-full" disabled={busy} onClick={() => setCropping(c.id)}
                  aria-label={c.isActiveSource ? "Re-crop the current artwork's source" : "Crop this image"}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- forge art must use the authed proxy, never next/image */}
                  <img src={candidateUrl(cardId, c.id)} alt="" loading="lazy" decoding="async"
                    className={`aspect-square w-full rounded-md border bg-muted/40 object-cover ${c.isActiveSource ? "ring-2 ring-primary" : ""}`} />
                </button>
                {!c.isActiveSource && (
                  <button type="button" aria-label="Delete image" disabled={busy}
                    className="absolute right-1 top-1 rounded-md border bg-background/85 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 active:opacity-100 group-hover:opacity-100 [@media(hover:none)]:p-2.5 [@media(hover:none)]:opacity-100"
                    onClick={() => setPendingDelete(c.id)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <button type="button" aria-label={c.sourceUrl ? "Edit source link" : "Add source link"}
                  className={`absolute bottom-1 right-1 rounded-md border bg-background/85 p-1 text-muted-foreground transition-opacity hover:text-foreground focus:opacity-100 active:opacity-100 group-hover:opacity-100 [@media(hover:none)]:p-2.5 [@media(hover:none)]:opacity-100 ${c.sourceUrl ? "opacity-100" : "opacity-0"}`}
                  onClick={() => setEditingSource(c.id)}>
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {acting?.id === c.id && acting.kind === "delete" && (
                  <span role="status" aria-label="Deleting image" className="absolute inset-0 flex items-center justify-center rounded-md bg-background/70">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                  </span>
                )}
              </div>
              {/* The action and the state it leads to, in one slot, so the eye finds both in the same place. */}
              {acting?.id === c.id && acting.kind === "use" ? (
                <p role="status" className="mt-1 flex h-7 items-center justify-center gap-1 text-xs text-muted-foreground [@media(hover:none)]:h-11">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Saving…
                </p>
              ) : c.isActiveSource ? (
                <p className="mt-1 flex h-7 items-center justify-center gap-1 text-xs font-medium text-primary [@media(hover:none)]:h-11">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />In use
                </p>
              ) : (
                <Button type="button" variant="outline" disabled={busy} aria-label="Use this image as the artwork"
                  className="mt-1 h-7 w-full px-1 text-xs [@media(hover:none)]:h-11"
                  onClick={() => void act(c.id, "use", activateCandidate(cardId, c.id), USE_FAILED)}>
                  Use this
                </Button>
              )}
            </li>
          ))}
          {/* One skeleton per not-yet-landed file: the active upload spins, queued
              ones pulse. Replaced by real thumbnails as each per-file refresh lands. */}
          {progress !== null &&
            Array.from({ length: pendingTiles(progress, candidates.length) }, (_, i) => (
              <li key={`uploading-${i}`} aria-hidden="true"
                className="flex aspect-square w-full animate-pulse items-center justify-center rounded-md border border-dashed bg-muted/40">
                {i === 0 && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />}
              </li>
            ))}
        </ul>
      )}

      {cropping && (
        <CropCandidateModal cardId={cardId} candidateId={cropping}
          imageUrl={candidateUrl(cardId, cropping)} cardName={cardName}
          onClose={() => setCropping(null)}
          onApplied={() => { setCropping(null); setActing({ id: cropping, kind: "use" }); settle(); }} />
      )}

      {editingSource && (
        <SourceLinkDialog cardId={cardId} candidateId={editingSource}
          sourceUrl={candidates.find((c) => c.id === editingSource)?.sourceUrl ?? null}
          onClose={() => setEditingSource(null)}
          onSaved={() => { setEditingSource(null); router.refresh(); }} />
      )}

      <ConfirmationDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) void act(id, "delete", deleteArtCandidate(cardId, id), DELETE_FAILED); }}
        variant="destructive"
        title="Delete this image?"
        description="Removes it from this card's gallery. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
