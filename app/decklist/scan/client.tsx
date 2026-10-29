'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { COPY } from '@/app/collection/scan/copy';
import { useScanQueue } from '@/app/collection/scan/hooks/useScanQueue';
import CaptureButtons from '@/app/collection/scan/components/CaptureButtons';
import DeckTray from './components/DeckTray';
import HandoffBar from './components/HandoffBar';
import { DECK_COPY } from './copy';
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
          <DeckTray
            state={state}
            dispatch={dispatch}
            thumbs={queue.thumbs}
            editable={editable}
            online={queue.online}
            canRetry={queue.hasFile}
            onRetry={queue.retry}
            onRemovePhoto={queue.remove}
            onChooseAnother={() => chooseInputRef.current?.click()}
          />
        )}
      </div>

      {!empty && <HandoffBar state={state} dispatch={dispatch} userId={userId} />}
    </div>
  );
}
