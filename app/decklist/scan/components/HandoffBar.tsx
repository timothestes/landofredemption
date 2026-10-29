'use client';

import { useCallback, useMemo, useRef, useState, type Dispatch } from 'react';
import { useRouter } from 'next/navigation';
import ToastNotification from '@/components/ui/toast-notification';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { COPY } from '@/app/collection/scan/copy';
import { createDeckFromScanAction } from '@/app/decklist/actions';
import { DECK_COPY, fill } from '../copy';
import { buildDeckText } from '../lib/deckText';
import type { DeckTrayAction } from '../lib/deckTrayReducer';
import { deckFormat, deckName, deckOutcomes, saveRows, totals } from '../lib/handoff';
import type { DeckTrayState } from '../types';

interface Props {
  state: DeckTrayState;
  dispatch: Dispatch<DeckTrayAction>;
}

type Note = { text: string; type: 'success' | 'error'; seq: number };

/** Sticky footer: copy the deck as text, or save it and open it in the deck builder. */
export default function HandoffBar({ state, dispatch }: Props) {
  const router = useRouter();
  const saving = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const t = useMemo(() => totals(state), [state]);
  const saved = t.main + t.reserve;
  // A photo still queued or reading would be dropped from the saved deck: hold both buttons until all are in.
  const reading = state.photos.some(p => p.status === 'queued' || p.status === 'reading');
  const busy = state.phase !== 'editing' || reading;
  const closeNote = useCallback(() => setNote(null), []);
  const notify = (text: string, type: Note['type']) => setNote(n => ({ text, type, seq: (n?.seq ?? 0) + 1 }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDeckText(state));
      notify(DECK_COPY.copied, 'success');
    } catch {
      notify(DECK_COPY.copyFailed, 'error');
    }
  };

  const open = async () => {
    setConfirming(false);
    if (saving.current) return;
    saving.current = true;
    dispatch({ type: 'saving' });
    try {
      const res = await createDeckFromScanAction({
        rows: saveRows(state),
        outcomesByScanId: deckOutcomes(state),
        name: deckName(new Date()),
        format: deckFormat(t.main),
      });
      if (!res.ok) throw new Error('save failed');
      dispatch({ type: 'saved', deckId: res.deckId });
      router.push(`/decklist/card-search?deckId=${res.deckId}`);
    } catch {
      saving.current = false;
      dispatch({ type: 'saveFailed' });
      notify(COPY.server, 'error');
    }
  };

  return (
    <>
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {t.leftOut > 0 && (
          <p className="pb-2 text-sm text-amber-600 dark:text-amber-400">{fill(DECK_COPY.leftOut, { n: t.leftOut })}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            disabled={busy || saved === 0}
            className="min-h-11 flex-1 rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus:outline-none disabled:opacity-50"
          >
            {DECK_COPY.copy}
          </button>
          <button
            type="button"
            onClick={() => (t.leftOut > 0 ? setConfirming(true) : void open())}
            disabled={busy || saved === 0}
            className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none disabled:opacity-50"
          >
            {DECK_COPY.open}
          </button>
        </div>
      </div>

      {confirming && (
        <Dialog open onOpenChange={o => !o && setConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{fill(DECK_COPY.openConfirm, { n: saved })}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-muted-foreground">{fill(DECK_COPY.leftOut, { n: t.leftOut })}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void open()}
                  className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none"
                >
                  Open
                </button>
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      <ToastNotification
        key={note?.seq ?? 0}
        message={note?.text ?? ''}
        show={note !== null}
        onClose={closeNote}
        type={note?.type ?? 'info'}
        duration={3000}
      />
    </>
  );
}
