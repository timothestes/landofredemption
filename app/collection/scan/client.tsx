'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useCollectionState } from '../hooks/useCollectionState';
import { useShowPrices } from '../../../hooks/useShowPrices';
import { useCardPrices } from '../../decklist/card-search/hooks/useCardPrices';
import ToastNotification from '@/components/ui/toast-notification';
import { COPY, fill } from './copy';
import { useScanTray } from './hooks/useScanTray';
import { useScanQueue } from './hooks/useScanQueue';
import CaptureButtons from './components/CaptureButtons';
import PhotoGroup from './components/PhotoGroup';
import DetectionRow from './components/DetectionRow';
import PrintingPicker, { type PickerMode } from './components/PrintingPicker';
import CommitBar from './components/CommitBar';
import SuccessPanel from './components/SuccessPanel';

/**
 * The tray reads sessionStorage in its initializer, so nothing below renders
 * on the server: the first client render is the mount gate, then the tray.
 */
export default function ScanClient({ userId }: { userId: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <ScanTray userId={userId} />;
}

function ScanTray({ userId }: { userId: string }) {
  const [state, dispatch] = useScanTray(userId);
  const queue = useScanQueue(dispatch);
  const { quantities, reload } = useCollectionState();
  const [showPrices] = useShowPrices();
  const { getPrice } = useCardPrices();
  const chooseInputRef = useRef<HTMLInputElement>(null);
  const [pickerRow, setPickerRow] = useState<{ rowId: string; mode: PickerMode } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const editable = state.phase === 'editing';
  const empty = state.photos.length === 0 && state.rows.length === 0;
  const waitingOffline = !queue.online && state.photos.some(p => p.status === 'queued');

  const detectionsByPhoto = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of state.rows) for (const s of r.sources) m.set(s.photoId, (m.get(s.photoId) ?? 0) + 1);
    return m;
  }, [state.rows]);
  const rowsOf = (photoId: string) => state.rows.filter(r => r.photoId === photoId && r.removedAs === null);
  const picked = pickerRow && editable ? state.rows.find(r => r.rowId === pickerRow.rowId) ?? null : null;

  const scanMore = () => {
    setPickerRow(null);
    queue.clear();
    dispatch({ type: 'scanMore' });
  };
  const onUndone = (removed: number) => {
    setToast(removed === 1 ? COPY.undoDoneOne : fill(COPY.undoDone, { n: removed }));
    dispatch({ type: 'undoDone' });
    void reload();
  };

  return (
    <div className="mt-2 space-y-6">
      {empty && <p className="text-sm text-muted-foreground">{COPY.firstRun}</p>}

      <div className="space-y-3">
        <CaptureButtons addFiles={queue.addFiles} chooseInputRef={chooseInputRef} disabled={!editable} />
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-3 hover:text-foreground focus:outline-none">
            {COPY.retentionSummary}
          </summary>
          <p>
            {COPY.retentionNote}{' '}
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
        {state.photos.length === 0 ? (
          <p className="border-t border-border/60 py-6 text-center text-sm text-muted-foreground">{COPY.emptyTray}</p>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {state.photos.map(photo => (
              <PhotoGroup
                key={photo.photoId}
                photo={photo}
                thumb={queue.thumbs.get(photo.photoId)}
                detectionCount={detectionsByPhoto.get(photo.photoId) ?? 0}
                editable={editable}
                canRetry={queue.hasFile(photo.photoId)}
                onRetry={() => queue.retry(photo.photoId)}
                onRemove={() => queue.remove(photo.photoId)}
                onChooseAnother={() => chooseInputRef.current?.click()}
              >
                {rowsOf(photo.photoId).map(r => (
                  <DetectionRow
                    key={r.rowId}
                    row={r}
                    owned={r.key ? quantities.get(r.key) ?? 0 : 0}
                    catalogPrice={r.key ? getPrice(r.key)?.price ?? null : null}
                    showPrices={showPrices}
                    editable={editable}
                    dispatch={dispatch}
                    onOpenPicker={(rowId, mode) => setPickerRow({ rowId, mode })}
                  />
                ))}
              </PhotoGroup>
            ))}
          </div>
        )}
      </div>

      {state.phase === 'committed' && state.committed ? (
        <SuccessPanel committed={state.committed} onUndone={onUndone} onScanMore={scanMore} />
      ) : (
        state.rows.length > 0 && (
          <CommitBar
            state={state}
            dispatch={dispatch}
            showPrices={showPrices}
            onCommitted={() => void reload()}
            onScanMore={scanMore}
          />
        )
      )}

      {picked && pickerRow && (
        <PrintingPicker
          key={picked.rowId}
          row={picked}
          mode={pickerRow.mode}
          quantities={quantities}
          showPrices={showPrices}
          getPrice={key => getPrice(key)?.price ?? null}
          onPick={(key, via, candidates) => dispatch({ type: 'setKey', rowId: picked.rowId, key, via, candidates })}
          onClose={() => setPickerRow(null)}
        />
      )}

      <ToastNotification message={toast ?? ''} show={toast !== null} onClose={closeToast} />
    </div>
  );
}
