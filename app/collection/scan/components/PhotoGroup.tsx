'use client';

import { Children, useEffect, useState, type ReactNode } from 'react';
import { COPY, doneLine, qualityLine, readingLine, scanErrorView } from '../copy';
import type { TrayPhoto } from '../lib/trayReducer';

interface Props {
  photo: TrayPhoto;
  thumb?: string;
  /** Detections this photo returned (merged duplicates included). */
  detectionCount: number;
  /** False once the tray is committing or committed: no Retry, Remove or Choose another. */
  editable: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onRemove: () => void;
  onChooseAnother: () => void;
  children?: ReactNode;
}

// Zero detections are a failure (R15): the full quality sentence, or No cards.
const ZERO_TEXT: Record<string, string> = {
  dark: COPY.tooDark,
  blurry: COPY.blurry,
  glare: COPY.glare,
  too_many_cards: COPY.tooMany,
};

const actionClass =
  'min-h-11 px-2 text-sm font-medium text-foreground underline-offset-4 hover:underline focus:outline-none';

export default function PhotoGroup({
  photo, thumb, detectionCount, editable, canRetry, onRetry, onRemove, onChooseAnother, children,
}: Props) {
  const reading = photo.status === 'reading' || photo.status === 'queued';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [reading]);

  let line: ReactNode;
  let actions: { retry: boolean; chooseAnother: boolean } | null = null;
  if (photo.busy && photo.status === 'queued') {
    line = COPY.busy;
  } else if (reading) {
    // Only "Reading…" is announced; the ticking seconds are hidden so the live region does not repeat.
    const full = readingLine(photo.startedAt ? Math.max(0, now - photo.startedAt) : 0);
    const seconds = full.slice(COPY.reading.length);
    line = (
      <>
        {COPY.reading}
        {seconds && <span aria-hidden="true">{seconds}</span>}
      </>
    );
  } else if (photo.status === 'failed') {
    const e = photo.error;
    const view = scanErrorView(
      e?.status ?? 0,
      e?.body ?? null,
      e?.retryAfter == null ? null : String(e.retryAfter),
      new Date(),
    );
    // Auto-retries are spent by the time a busy error lands here, so nothing is retrying.
    line = view.kind === 'busy' ? COPY.generic : view.text;
    actions = { retry: view.retry, chooseAnother: view.chooseAnother };
  } else if (detectionCount === 0) {
    line = ZERO_TEXT[photo.photoQuality ?? ''] ?? COPY.noCards;
    actions = { retry: true, chooseAnother: true };
  } else {
    const q = photo.photoQuality && photo.photoQuality !== 'ok' ? qualityLine(photo.photoQuality) : null;
    line = q ? `${doneLine(detectionCount)} · ${q}` : doneLine(detectionCount);
  }

  return (
    <section className="py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={`Photo ${photo.n}`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground">Photo {photo.n}</span>
          )}
        </div>
        <p
          role="status"
          className={`min-w-0 flex-1 text-sm ${actions ? 'text-foreground' : 'text-muted-foreground'} tabular-nums`}
        >
          {line}
        </p>
      </div>
      {actions && editable && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 pl-14">
          {actions.retry && canRetry && (
            <button type="button" className={actionClass} onClick={onRetry}>
              {COPY.retry}
            </button>
          )}
          <button type="button" className={actionClass} onClick={onRemove}>
            {COPY.remove}
          </button>
          {actions.chooseAnother && (
            <button type="button" className={actionClass} onClick={onChooseAnother}>
              {COPY.chooseAnother}
            </button>
          )}
        </div>
      )}
      {Children.count(children) > 0 && <ul className="mt-2 divide-y divide-border/60">{children}</ul>}
    </section>
  );
}
