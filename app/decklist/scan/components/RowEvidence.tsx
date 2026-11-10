'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useFocusTrap } from '@/app/collection/scan/hooks/useFocusTrap';
import type { Box } from '@/lib/scan/deckSchema';
import { DECK_COPY } from '../copy';
import { drawCrop } from '../lib/photoCrops';
import { titleStripPlan } from '../lib/titleCrop';

interface Props {
  /** The photo, decoded and turned the way the scan read it (useTurnedPhotos). */
  source: HTMLCanvasElement;
  /** The read's title band, normalized to `source`. */
  box: Box;
  /** The orientation of the read's group. */
  orientation: string;
}

/**
 * What the photo shows for this row: the card's title band, turned upright, above the name it was read as.
 * Cut on the client and never stored. Tap to see the whole photo with the band outlined.
 */
export default function RowEvidence({ source, box, orientation }: Props) {
  const [x0, y0, x1, y1] = box;
  const plan = useMemo(
    () => titleStripPlan([x0, y0, x1, y1], { w: source.width, h: source.height }, orientation),
    [x0, y0, x1, y1, source, orientation],
  );
  const strip = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (plan && strip.current) drawCrop(source, plan, strip.current);
  }, [plan, source]);

  if (!plan) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={DECK_COPY.stripLabel}
        className="mx-2 mb-1 block w-[calc(100%-1rem)] rounded-sm focus:outline-none sm:max-w-[240px]"
      >
        <canvas ref={strip} aria-hidden className="block h-auto max-h-16 w-full rounded-sm bg-muted object-cover" />
      </button>
      {open && <PhotoViewer source={source} box={[x0, y0, x1, y1]} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoViewer({ source, box, onClose }: { source: HTMLCanvasElement; box: Box; onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLCanvasElement>(null);
  useFocusTrap(trapRef, true);

  useEffect(() => {
    const canvas = photo.current;
    if (!canvas) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
  }, [source]);

  const pct = (n: number) => `${n * 100}%`;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <div ref={trapRef} className="flex max-h-[100dvh] w-full max-w-3xl flex-col items-end gap-2 px-4" onClick={e => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground hover:text-foreground focus:outline-none"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex w-full justify-center">
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg">
            <canvas ref={photo} role="img" aria-label="The photo, with this card's title outlined" className="block max-h-[80dvh] max-w-full" />
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-2 border-primary shadow-[0_0_0_2px_rgba(0,0,0,0.55)]"
              style={{ left: pct(box[0]), top: pct(box[1]), width: pct(box[2] - box[0]), height: pct(box[3] - box[1]) }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
