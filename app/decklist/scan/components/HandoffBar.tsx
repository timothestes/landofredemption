'use client';

import { useCallback, useMemo, useRef, useState, type Dispatch } from 'react';
import Link from 'next/link';
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
import type { TrayJumps } from './DeckTray';

interface Props {
  state: DeckTrayState;
  dispatch: Dispatch<DeckTrayAction>;
  /** The tray's jumps: what is left to do is said as links to it. */
  jumps?: TrayJumps;
  /** `builderOnly` is the one secondary button a host with its own primary hand-off shows (the generate page). */
  variant?: 'sticky' | 'builderOnly';
}

type Note = { text: string; type: 'success' | 'error'; seq: number };

/** Sticky footer: copy the deck as text, or save it and open it in the deck builder. */
export default function HandoffBar({ state, dispatch, jumps, variant = 'sticky' }: Props) {
  const router = useRouter();
  const saving = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const t = useMemo(() => totals(state), [state]);
  const saved = t.main + t.reserve;
  // Lost Souls the photo showed and nobody picked are cards left out too, done picking or not.
  const leftOut = t.leftOut + t.lostSoulsShort;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const jumpClass =
    'min-h-9 whitespace-nowrap font-medium text-amber-600 underline-offset-4 hover:underline focus:outline-none dark:text-amber-400';
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
      {variant === 'builderOnly' ? (
        <button
          type="button"
          onClick={() => (leftOut > 0 ? setConfirming(true) : void open())}
          disabled={busy || saved === 0}
          className="min-h-11 w-full rounded-lg border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus:outline-none disabled:opacity-50 sm:w-auto"
        >
          {DECK_COPY.open}
        </button>
      ) : (
      <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {/* What the deck holds, then what is left to do, each a way to it. The buttons stay live: a deck can be finished in the builder. */}
        <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 pb-1 text-sm tabular-nums">
          <span className="text-muted-foreground">
            Main {t.main} · Reserve {t.reserve}
          </span>
          {t.toCheck > 0 && (
            <button type="button" onClick={() => jumps?.walk()} className={jumpClass}>
              {plural(t.toCheck, 'row', 'rows')} to check
            </button>
          )}
          {t.lostSoulsToPick > 0 && (
            <button type="button" onClick={() => jumps?.openLostSouls()} className={jumpClass}>
              {plural(t.lostSoulsToPick, 'Lost Soul', 'Lost Souls')} to pick
            </button>
          )}
          {t.lostSoulsToPick === 0 && t.lostSoulsShort > 0 && (
            <button type="button" onClick={() => jumps?.openLostSouls()} className={jumpClass}>
              {plural(t.lostSoulsCounted - t.lostSoulsShort, 'Lost Soul', 'Lost Souls')} picked · photo showed {t.lostSoulsCounted}
            </button>
          )}
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          {DECK_COPY.pdfLinkLead}{' '}
          <Link href="/decklist/generate?source=photo" className="underline underline-offset-4 hover:text-foreground focus:outline-none">
            {DECK_COPY.pdfLink}
          </Link>
        </p>
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
            onClick={() => (leftOut > 0 ? setConfirming(true) : void open())}
            disabled={busy || saved === 0}
            className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none disabled:opacity-50"
          >
            {DECK_COPY.open}
          </button>
        </div>
      </div>
      )}

      {confirming && (
        <Dialog open onOpenChange={o => !o && setConfirming(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{fill(DECK_COPY.openConfirm, { n: saved })}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-muted-foreground">{fill(DECK_COPY.leftOut, { n: leftOut })}</p>
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
