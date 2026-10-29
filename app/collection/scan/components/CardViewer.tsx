'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { COPY } from '../copy';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface Props {
  name: string;
  set: string;
  legality: string;
  imgSrc: string;
  /** The row's unit price, or null when YTG has no listing. */
  price: number | null;
  qty: number;
  showPrices: boolean;
  onClose: () => void;
}

/**
 * A scanned card at full size with its set and price. A tap on the row's
 * thumbnail opens it; a tap outside, Close, or Escape dismisses it.
 */
export default function CardViewer({ name, set, legality, imgSrc, price, qty, showPrices, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <div ref={trapRef} className="flex w-full max-w-sm flex-col gap-2 px-4" onClick={e => e.stopPropagation()}>
        {/* The same URL as the row's thumbnail, so the browser already has it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imgSrc} alt={name} className="max-h-[70dvh] w-full rounded-lg object-contain" />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background py-1 pl-3 pr-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {set}
              {legality && ` · ${legality}`}
            </p>
          </div>
          {showPrices && (
            <span className="shrink-0 text-sm tabular-nums">
              {price != null ? (
                <>
                  ${price.toFixed(2)}
                  {qty > 1 && <span className="text-xs text-muted-foreground"> {COPY.each}</span>}
                </>
              ) : (
                <a
                  href={`https://www.yourturngames.biz/search?q=${encodeURIComponent(name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline focus:outline-none"
                >
                  {COPY.unpriced}
                </a>
              )}
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
