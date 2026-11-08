"use client";

import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { applyCrop, activateCandidate } from "@/app/forge/lib/artCandidates";
import { cropBackgroundStyle, type CropRect } from "@/app/forge/lib/cropPreview";
import { withDeadline } from "@/app/forge/lib/withDeadline";

// Redemption card art is square or portrait (never landscape), so those are the
// two frame shapes on offer. Square default.
const ASPECTS = [
  { key: "square", label: "Square", value: 1 },
  { key: "portrait", label: "Portrait", value: 3 / 4 },
] as const;

const APPLY_FAILED = "Couldn’t save that. Check your connection and try again.";

export default function CropCandidateModal({
  cardId, candidateId, imageUrl, cardName, onClose, onApplied,
}: {
  cardId: string;
  candidateId: string;
  imageUrl: string;
  cardName: string | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState<number>(ASPECTS[0].value);
  // react-easy-crop reports croppedArea in PERCENTAGES of the source image.
  const [rect, setRect] = useState<CropRect | null>(null);
  const [busy, setBusy] = useState<"crop" | "full" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(kind: "crop" | "full") {
    if (kind === "crop" && !rect) return;
    setErr(null);
    setBusy(kind);
    const r = await withDeadline(
      kind === "crop" ? applyCrop(cardId, candidateId, rect!) : activateCandidate(cardId, candidateId),
      { ok: false, error: APPLY_FAILED },
    );
    setBusy(null);
    if (r.ok === false) setErr(r.error ?? "Something went wrong");
    else onApplied();
  }

  return (
    // Cancel is off while saving, so Esc and the backdrop are too: closing can't stop the save,
    // and it would take away the only sign of it.
    <Dialog open={true} onOpenChange={(open) => { if (!open && busy === null) onClose(); }}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Crop artwork</p>
          <div className="flex gap-1">
            {ASPECTS.map((a) => (
              <Button key={a.key} size="sm" variant={aspect === a.value ? "secondary" : "outline"}
                className="h-7 text-xs" onClick={() => setAspect(a.value)}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:min-w-0 sm:flex-1" style={{ aspectRatio: "3 / 2", background: "black" }}>
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(area: Area) =>
                setRect({ x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 })
              }
            />
          </div>

          {/* Live preview: exactly the framed subrect, at the chosen aspect. */}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Preview</p>
            <div className="w-40 overflow-hidden rounded-md border">
              <div
                style={{
                  aspectRatio: String(aspect),
                  backgroundImage: `url(${imageUrl})`,
                  backgroundRepeat: "no-repeat",
                  ...(rect ? cropBackgroundStyle(rect) : { backgroundSize: "cover", backgroundPosition: "center" }),
                }}
              />
              <p className="truncate px-2 py-1 text-xs font-semibold">{cardName?.trim() || "Untitled"}</p>
            </div>
          </div>
        </div>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={() => run("full")} disabled={busy !== null}>
            {busy === "full" ? "Saving…" : "Use uncropped"}
          </Button>
          <Button size="sm" onClick={() => run("crop")} disabled={busy !== null || !rect}>
            {busy === "crop" ? "Saving…" : "Use cropped"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
