'use client';

import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import Link from 'next/link';
import { COPY } from '@/app/collection/scan/copy';
import { useScanQueue } from '@/app/collection/scan/hooks/useScanQueue';
import CaptureButtons from '@/app/collection/scan/components/CaptureButtons';
import DeckTray, { type TrayJumps } from './DeckTray';
import { DECK_COPY, SMALL_PHOTO_EDGE } from '../copy';
import { useDeckTray } from '../hooks/useDeckTray';
import { usePhotoDropPaste } from '../hooks/usePhotoDropPaste';
import type { DeckTrayAction } from '../lib/deckTrayReducer';
import type { DeckScanResponse, DeckTrayState } from '../types';

export interface DeckPhotoReaderProps {
  userId: string;
  /** Called after every tray change, and once on mount. */
  onChange?: (state: DeckTrayState) => void;
  /** The host's hand-off, rendered under the tray when it is not empty. */
  footer?: (ctx: { state: DeckTrayState; dispatch: Dispatch<DeckTrayAction>; jumps: TrayJumps }) => ReactNode;
  /** Where a signed-out error on a photo sends the player. */
  signInHref?: string;
  /** False while the host hides the reader: page-wide drop and paste are off. */
  active?: boolean;
  /** Extra classes on the tray's wrapper (a host with a padded panel bleeds the rows past it). */
  trayClassName?: string;
  /** Replaces the first-photo tips. */
  tips?: string[];
  /**
   * Shown above the capture buttons while the tray is empty, in place of the tips and the empty-tray note: for a
   * host where the reader is one step of a bigger job and a first-timer needs the steps, not a column of hints.
   */
  intro?: ReactNode;
  /** Drops the link to the collection scanner, for a host the player should not be led away from. */
  hideCrossLink?: boolean;
  /** Drops the tray's totals line, for a host whose footer already says what is left. */
  hideTotals?: boolean;
}

/**
 * The deck photo reader: capture buttons, drop and paste, the upload queue and the tray. Hosts supply the
 * hand-off. The tray reads sessionStorage in its initializer, so nothing renders on the server: the first
 * client render is the mount gate, then the tray.
 */
export default function DeckPhotoReader(props: DeckPhotoReaderProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Reader {...props} />;
}

function Reader({
  userId, onChange, footer, signInHref = '/sign-in?redirectTo=/decklist/scan', active = true, trayClassName = '',
  tips = [DECK_COPY.tips, DECK_COPY.captureTip], hideCrossLink = false, hideTotals, intro,
}: DeckPhotoReaderProps) {
  const [state, dispatch] = useDeckTray(userId);
  // Under SMALL_PHOTO_EDGE most titles go unread: the queue stops before the upload until the player says Scan anyway.
  const queue = useScanQueue<DeckScanResponse>(dispatch, { mode: 'deck', warnUnderEdge: SMALL_PHOTO_EDGE });
  const chooseInputRef = useRef<HTMLInputElement>(null);
  const trayJumps = useRef<TrayJumps | null>(null);
  const jumps = useRef<TrayJumps>({
    walk: () => trayJumps.current?.walk(),
    openLostSouls: () => trayJumps.current?.openLostSouls(),
  }).current;

  const editable = state.phase === 'editing';
  const empty = state.photos.length === 0;
  const waitingOffline = !queue.online && state.photos.some(p => p.status === 'queued');
  const { dragging } = usePhotoDropPaste(queue.addFiles, editable && active);

  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => report.current?.(state), [state]);

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
        {empty && intro}
        <CaptureButtons
          addFiles={queue.addFiles}
          chooseInputRef={chooseInputRef}
          accepting={editable}
          disabled={!editable}
          showTips={empty && !intro}
          tips={tips}
        />
        {!hideCrossLink && (
          <p className="text-xs text-muted-foreground">
            <Link href="/collection/scan" className="underline underline-offset-4 hover:text-foreground focus:outline-none">
              {DECK_COPY.crossLinkHere}
            </Link>
          </p>
        )}
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

      {/* With an intro and nothing to show, the tray's wrapper would only add a gap under the buttons. */}
      {!(empty && intro && !waitingOffline) && <div className={trayClassName}>
        {waitingOffline && (
          <p role="status" className="pb-2 text-sm text-muted-foreground">
            {COPY.offline}
          </p>
        )}
        {empty ? (
          !intro && <p className="border-t border-border/60 py-6 text-center text-sm text-muted-foreground">{COPY.emptyTray}</p>
        ) : (
          <DeckTray
            state={state}
            dispatch={dispatch}
            thumbs={queue.thumbs}
            editable={editable}
            online={queue.online}
            signInHref={signInHref}
            canRetry={queue.hasFile}
            onRetry={queue.retry}
            onRemovePhoto={queue.remove}
            onChooseAnother={() => chooseInputRef.current?.click()}
            jumps={trayJumps}
            hideTotals={hideTotals}
          />
        )}
      </div>}

      {!empty && footer?.({ state, dispatch, jumps })}
    </div>
  );
}
