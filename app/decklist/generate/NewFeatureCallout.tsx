"use client";

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { DECK_COPY } from "../scan/copy";

const KEY = "generate-photo-callout:v1";

/** Retire the callout: the player has read a photo on this page. */
export function markPhotoCalloutDone(): void {
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    /* storage unavailable: the callout shows again next time */
  }
}

/** One band under the page's lead that points at the photo source, until the player has used it. */
export default function NewFeatureCallout({ onRead }: { onRead: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "done");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-md bg-card px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Camera className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
              {DECK_COPY.pillNew}
            </span>
            {DECK_COPY.calloutHeading}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{DECK_COPY.calloutBody}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRead}
        className="min-h-11 w-full shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none sm:w-auto"
      >
        {DECK_COPY.calloutButton}
      </button>
    </div>
  );
}
