'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { adjustCollectionQuantitiesAction } from '../../actions';
import { COPY, fill } from '../copy';
import type { TrayState } from '../lib/trayReducer';

interface Props {
  committed: NonNullable<TrayState['committed']>;
  /** Called after a successful undo with the number of cards the server removed. */
  onUndone: (removed: number) => void;
  onScanMore: () => void;
}

const buttonClass = 'min-h-11 flex-1 px-2 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0';

export default function SuccessPanel({ committed, onUndone, onScanMore }: Props) {
  const [busy, setBusy] = useState(false);
  // `blocked`: the server will not undo this commit from here; `signIn`: the session expired.
  const [note, setNote] = useState<{ text: string; blocked: boolean; signIn?: boolean } | null>(null);

  const undo = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await adjustCollectionQuantitiesAction(committed.commitId);
      // tsconfig is strict:false, so `ok` does not narrow the union; `in` does.
      if ('removed' in res) {
        onUndone(res.removed);
        return;
      }
      if (res.code === 'superseded') setNote({ text: COPY.undoSuperseded, blocked: true });
      else if (res.code === 'not_found') setNote({ text: COPY.undoUnavailable, blocked: true });
      // A partial undo recorded what is left; tapping Undo again finishes it.
      else if (res.code === 'partial') setNote({ text: COPY.undoPartial, blocked: false });
      else if (res.code === 'unauthorized') setNote({ text: COPY.commitSignedOut, blocked: false, signIn: true });
      else setNote({ text: COPY.undoFailed, blocked: false });
    } catch {
      setNote({ text: COPY.undoFailed, blocked: false });
    } finally {
      setBusy(false);
    }
  };

  const success = committed.added === 1 ? COPY.successOne : fill(COPY.success, { n: committed.added });
  const viewHref = `/collection?format=Unlimited&added=${committed.scanIds.join(',')}`;

  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="space-y-2 py-3">
        <div role="status" className="space-y-1">
          <p className="text-sm font-medium">{success}</p>
          {note && (
            <p className="text-xs text-muted-foreground">
              {note.text}
              {note.signIn && (
                <>
                  {' '}
                  <Link href="/sign-in?redirectTo=/collection/scan" className="font-medium text-foreground underline underline-offset-4 focus:outline-none">
                    {COPY.signIn}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className={buttonClass}
            disabled={busy || !!note?.blocked}
            onClick={() => void undo()}
          >
            {COPY.undo}
          </Button>
          <Button asChild variant="outline" className={buttonClass}>
            <Link href={viewHref}>{COPY.viewCollection}</Link>
          </Button>
          <Button type="button" className={buttonClass} disabled={busy} onClick={onScanMore}>
            {COPY.scanMore}
          </Button>
        </div>
      </div>
    </div>
  );
}
