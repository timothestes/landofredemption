"use client";

import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { COVER_ASPECT, renderCrop, typeFromUrl } from "../lib/coverCrop";

// 16:9 crop of a cover image, before a picked file is uploaded (`file` set)
// or over a cover that is already uploaded (`file` null: the Blob URL is
// re-read through a CORS canvas). Either way the result is a File that goes
// down the same upload path as an uncropped pick.

const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

export default function CoverCropDialog({
  open,
  src,
  file,
  onCancel,
  onUseFull,
  onConfirm,
}: {
  open: boolean;
  /** Object URL of the picked file, or the existing cover's URL. */
  src: string | null;
  /** The picked file; null when adjusting a cover that is already uploaded. */
  file: File | null;
  onCancel: () => void;
  /** Upload the picked file as it is (new covers only). */
  onUseFull: () => void;
  onConfirm: (file: File) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // react-easy-crop's SECOND onCropComplete argument: the rect in source pixels.
  const [px, setPx] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on the render that opens the dialog (see DeckPicker).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPx(null);
      setBusy(false);
      setError(null);
    }
  }

  const confirm = async () => {
    if (!src || !px) return;
    setBusy(true);
    setError(null);
    try {
      onConfirm(await renderCrop(src, px, file?.type ?? typeFromUrl(src), file?.name ?? ""));
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't crop this image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Crop cover</DialogTitle>
          <DialogDescription>Article cards crop to this 16:9 frame. The article page shows the whole crop.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* Shorter on phones so the zoom slider stays above the fold. */}
          <div className="relative h-[40vh] max-h-[420px] overflow-hidden rounded-sm bg-muted sm:h-[55vh]">
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={COVER_ASPECT}
                objectFit="contain"
                showGrid={false}
                // onError: a cover whose host sends no CORS headers never loads here,
                // and without it the dialog would just sit empty with Use crop disabled.
                mediaProps={{ crossOrigin: "anonymous", onError: () => setError("Couldn't load this image.") }}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setPx(pixels)}
              />
            )}
          </div>
          {/* Pinch and wheel zoom work natively; the slider is the discoverable one. */}
          <label className={`${LABEL} mt-3`} htmlFor="cover-crop-zoom">
            Zoom
          </label>
          <input
            id="cover-crop-zoom"
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="mt-1 block w-full accent-primary"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="flex-wrap justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {file && (
            <Button type="button" variant="outline" className="min-h-11" onClick={onUseFull} disabled={busy}>
              Use full image
            </Button>
          )}
          <Button type="button" className="min-h-11" onClick={() => void confirm()} disabled={busy || !px}>
            {busy ? "Cropping…" : "Use crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
