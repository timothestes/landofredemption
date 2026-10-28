'use client';

import { Children, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { COPY, doneLine, fill, qualityLine, readingLine, scanErrorView } from '../copy';
import type { TrayPhoto } from '../lib/trayReducer';

interface Props {
  photo: TrayPhoto;
  thumb?: string;
  /** Detections this photo returned (merged duplicates included). */
  detectionCount: number;
  /** Of those, how many raised the count of a row listed under an earlier photo. */
  mergedCount: number;
  /** False once the tray is committing or committed: no Retry, Remove or Choose another. */
  editable: boolean;
  online: boolean;
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

function doneText(n: number, merged: number, quality: string | undefined): string {
  const parts = [doneLine(n)];
  if (merged > 0) parts.push(merged === n ? COPY.mergedAboveAll : fill(COPY.mergedAbove, { n: merged }));
  if (quality === 'too_many_cards') parts.push(COPY.tooManyPartial);
  else {
    const q = quality && quality !== 'ok' ? qualityLine(quality) : null;
    if (q) parts.push(fill(COPY.qualityCheckNames, { q }));
  }
  return parts.join(' · ');
}

export default function PhotoGroup({
  photo, thumb, detectionCount, mergedCount, editable, online, canRetry, onRetry, onRemove, onChooseAnother, children,
}: Props) {
  const reading = photo.status === 'reading';
  const [now, setNow] = useState(() => Date.now());
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [reading]);

  let line: ReactNode;
  let actions: { retry: boolean; chooseAnother: boolean; signIn?: boolean } | null = null;
  // Remove is always offered while editing; a read photo asks first, since its cards go with it.
  let removeNeedsConfirm = false;
  if (photo.busy && photo.status === 'queued') {
    line = COPY.busy;
  } else if (photo.status === 'queued') {
    line = online ? COPY.waiting : COPY.waitingOffline;
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
    line = view.kind === 'busy' ? COPY.busyGaveUp : view.text;
    actions = { retry: view.retry, chooseAnother: view.chooseAnother, signIn: view.signIn };
  } else if (detectionCount === 0) {
    line = ZERO_TEXT[photo.photoQuality ?? ''] ?? COPY.noCards;
    // The same photo with too many cards would only be refused again: retake or choose another.
    actions = { retry: photo.photoQuality !== 'too_many_cards', chooseAnother: true };
  } else {
    line = doneText(detectionCount, mergedCount, photo.photoQuality);
    removeNeedsConfirm = true;
  }

  const remove = () => (removeNeedsConfirm ? setConfirmRemove(true) : onRemove());

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
          {actions?.signIn && (
            <>
              {' '}
              <Link href="/sign-in?redirectTo=/collection/scan" className="font-medium underline underline-offset-4 focus:outline-none">
                {COPY.signIn}
              </Link>
            </>
          )}
        </p>
        {editable && !actions && !confirmRemove && (
          <button type="button" className={`${actionClass} shrink-0 text-muted-foreground`} onClick={remove}>
            {removeNeedsConfirm ? COPY.removePhoto : COPY.remove}
          </button>
        )}
      </div>
      {editable && confirmRemove && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1 pl-14">
          <span className="text-sm">
            {detectionCount === 1 ? COPY.removePhotoConfirmOne : fill(COPY.removePhotoConfirm, { n: detectionCount })}
          </span>
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              setConfirmRemove(false);
              onRemove();
            }}
          >
            {COPY.remove}
          </button>
          <button type="button" className={actionClass} onClick={() => setConfirmRemove(false)}>
            {COPY.cancel}
          </button>
        </div>
      )}
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
