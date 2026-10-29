'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useFocusTrap } from '@/app/collection/scan/hooks/useFocusTrap';
import { DECK_COPY } from '../copy';
import { cropPlan, cropToUrl } from '../lib/photoCrops';
import type { DeckPhoto } from '../types';

/**
 * Off after the E0 box check (2026-10-29): group boxes cut the fully visible card on the sharp photo, and every
 * sideways row came back `upright`, so its strip showed the titles sideways. Turn back on once the box check passes on every photo.
 */
export const SHOW_GROUP_STRIPS = false;

interface Props {
  /** Object URL of the prepared photo (the queue's thumb). */
  photoUrl: string;
  group: DeckPhoto['groups'][number];
  /** "Group 3", for the image's alt text. */
  label: string;
}

/**
 * The group's own crop of the photo, turned upright, 72 px tall and scrollable sideways when the
 * group is a row. Cut on the client and kept in memory only; tap to see it large.
 */
export default function GroupStrip({ photoUrl, group, label }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [x0, y0, x1, y1] = group.bbox;

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    const img = new Image();
    setFailed(false);
    img.onerror = () => { if (!cancelled) setFailed(true); };
    img.onload = () => {
      if (cancelled) return;
      const plan = cropPlan([x0, y0, x1, y1], { w: img.naturalWidth, h: img.naturalHeight }, group.orientation);
      cropToUrl(photoUrl, plan).then(
        u => {
          if (cancelled) URL.revokeObjectURL(u);
          else {
            made = u;
            setUrl(u);
          }
        },
        // No strip: the rows still read on their own.
        () => { if (!cancelled) setFailed(true); },
      );
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [photoUrl, x0, y0, x1, y1, group.orientation]);

  if (failed) return null;
  if (!url) return <div aria-hidden className="h-[72px] rounded-sm bg-muted/50" />;

  return (
    <>
      <div className="overflow-x-auto">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${label}: ${DECK_COPY.stripHint}`}
          className="block h-[72px] shrink-0 rounded-sm focus:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-[72px] w-auto max-w-none rounded-sm" />
        </button>
      </div>
      <p aria-hidden className="mt-1 text-[11px] text-muted-foreground">{DECK_COPY.stripHint}</p>
      {open && <StripViewer src={url} alt={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function StripViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);
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
        <div className="max-h-[80dvh] w-full overflow-auto rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="mx-auto max-h-[80dvh] w-auto max-w-full object-contain" />
        </div>
      </div>
    </Dialog>
  );
}
