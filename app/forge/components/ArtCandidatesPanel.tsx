"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Trash2 } from "lucide-react";
import { upload } from "@vercel/blob/client";
import FilePicker from "@/app/forge/components/FilePicker";
import CropCandidateModal from "@/app/forge/components/CropCandidateModal";
import SourceLinkDialog from "@/app/forge/components/SourceLinkDialog";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { addArtCandidate, deleteArtCandidate, type ArtCandidate } from "@/app/forge/lib/artCandidates";
import { pendingTiles, uploadHint, type UploadBatch } from "@/app/forge/lib/artUploadProgress";

// Candidate blobs are immutable (a row is written once, never replaced), so a
// constant t cache-buster is enough for the proxy's immutable caching.
const candidateUrl = (cardId: string, id: string) => `/forge/api/art/${cardId}?candidate=${id}&t=c`;

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

  async function onDelete(id: string) {
    setErr(null);
    const r = await deleteArtCandidate(cardId, id);
    if (r.ok === false) setErr(r.error ?? "Could not delete image");
    router.refresh();
  }

  return (
    <div>
      <FilePicker label="Add images…" accept="image/jpeg,image/png,image/webp,.tif,.tiff,image/tiff" multiple
        disabled={progress !== null} onFiles={onFiles}
        hint={progress ? uploadHint(progress) : `${candidates.length}/12 · click an image to crop`} />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      {(candidates.length > 0 || progress !== null) && (
        <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {candidates.map((c) => (
            <li key={c.id} className="group relative">
              <button type="button" className="block w-full" onClick={() => setCropping(c.id)}
                aria-label={c.isActiveSource ? "Re-crop the current artwork's source" : "Crop this image"}>
                {/* eslint-disable-next-line @next/next/no-img-element -- forge art must use the authed proxy, never next/image */}
                <img src={candidateUrl(cardId, c.id)} alt="" loading="lazy" decoding="async"
                  className={`aspect-square w-full rounded-md border bg-muted/40 object-cover ${c.isActiveSource ? "ring-2 ring-primary" : ""}`} />
              </button>
              {c.isActiveSource ? (
                // On touch the link button below is larger and always shown, so this label moves
                // to the corner a source tile leaves free (it has no Delete).
                <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 text-[10px] font-medium [@media(hover:none)]:bottom-auto [@media(hover:none)]:top-1">Artwork source</span>
              ) : (
                <button type="button" aria-label="Delete image"
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
          onApplied={() => { setCropping(null); router.refresh(); }} />
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
        onConfirm={() => { const id = pendingDelete; setPendingDelete(null); if (id) void onDelete(id); }}
        variant="destructive"
        title="Delete this image?"
        description="Removes it from this card's gallery. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
