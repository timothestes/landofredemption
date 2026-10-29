'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/app/collection/scan/copy';
import { useScanQueue } from '@/app/collection/scan/hooks/useScanQueue';
import CaptureButtons from '@/app/collection/scan/components/CaptureButtons';
import PhotoGroup from '@/app/collection/scan/components/PhotoGroup';
import { DECK_COPY, fill } from './copy';
import { useDeckTray } from './hooks/useDeckTray';
import { usePhotoDropPaste } from './hooks/usePhotoDropPaste';
import type { DeckScanResponse } from './types';

/**
 * The tray reads sessionStorage in its initializer, so nothing below renders
 * on the server: the first client render is the mount gate, then the tray.
 */
export default function DeckScanClient({ userId }: { userId: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <DeckScanTray userId={userId} />;
}

function DeckScanTray({ userId }: { userId: string }) {
  const [state, dispatch] = useDeckTray(userId);
  const queue = useScanQueue<DeckScanResponse>(dispatch, { mode: 'deck' });
  const chooseInputRef = useRef<HTMLInputElement>(null);

  const editable = state.phase === 'editing';
  const empty = state.photos.length === 0;
  const waitingOffline = !queue.online && state.photos.some(p => p.status === 'queued');
  const { dragging } = usePhotoDropPaste(queue.addFiles, editable);

  // Cards the scan read per photo (added cards have no original), for the photo's done line.
  const readByPhoto = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of state.entries) if (e.original !== null) m.set(e.photoId, (m.get(e.photoId) ?? 0) + 1);
    return m;
  }, [state.entries]);

  return (
    <div className="mt-2 space-y-6">
      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-primary bg-background/80"
        >
          <p className="text-lg font-medium">Drop photos to read them</p>
        </div>
      )}

      <div className="space-y-3">
        <CaptureButtons
          addFiles={queue.addFiles}
          chooseInputRef={chooseInputRef}
          accepting={editable}
          disabled={!editable}
          showTips={empty}
          tips={[DECK_COPY.tips]}
        />
        <p className="text-xs text-muted-foreground">
          <Link href="/collection/scan" className="underline underline-offset-4 hover:text-foreground focus:outline-none">
            {DECK_COPY.crossLinkHere}
          </Link>
        </p>
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3 hover:text-foreground focus:outline-none">
            {COPY.retentionSummary}
          </summary>
          <p>
            {DECK_COPY.privacy}{' '}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground focus:outline-none">
              Privacy
            </Link>
          </p>
        </details>
      </div>

      <div>
        {waitingOffline && (
          <p role="status" className="pb-2 text-sm text-muted-foreground">
            {COPY.offline}
          </p>
        )}
        {empty ? (
          <p className="border-t border-border/60 py-6 text-center text-sm text-muted-foreground">{COPY.emptyTray}</p>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {state.photos.map(photo => {
              const n = readByPhoto.get(photo.photoId) ?? 0;
              return (
                <PhotoGroup
                  key={photo.photoId}
                  photo={photo}
                  thumb={queue.thumbs.get(photo.photoId)}
                  detectionCount={n}
                  mergedCount={0}
                  doneLine={fill(DECK_COPY.readDone, { n, g: photo.groups.length })}
                  editable={editable}
                  online={queue.online}
                  canRetry={queue.hasFile(photo.photoId)}
                  onRetry={() => queue.retry(photo.photoId)}
                  onRemove={() => queue.remove(photo.photoId)}
                  onChooseAnother={() => chooseInputRef.current?.click()}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Task 7+: group sections, rows, the Lost Soul sheet and the hand-off bar render here. */}
    </div>
  );
}
