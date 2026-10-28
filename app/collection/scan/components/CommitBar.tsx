'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { commitScanAction } from '../../actions';
import { COPY, fill, footerTotal } from '../copy';
import { buildCommitPayload } from '../lib/outcomes';
import { trayTotals, type TrayAction, type TrayState } from '../lib/trayReducer';
import type { CommitResult } from '../lib/commitCore';

const IN_PROGRESS_WAIT_MS = 1500;
const IN_PROGRESS_RETRIES = 3;

interface Props {
  state: TrayState;
  dispatch: React.Dispatch<TrayAction>;
  showPrices: boolean;
  onCommitted: () => void;
  onScanMore: () => void;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function CommitBar({ state, dispatch, showPrices, onCommitted, onScanMore }: Props) {
  // `final`: the server will never accept this tray (already committed), so no retry is offered.
  const [error, setError] = useState<{ text: string; final: boolean } | null>(null);
  const resumed = useRef(false);
  const totals = trayTotals(state);
  const committing = state.phase === 'committing';
  // A photo still reading is not in the payload yet; committing now would drop its cards.
  const reading = state.photos.some(p => p.status === 'queued' || p.status === 'reading');

  const commit = async () => {
    const commitId = state.pendingCommitId ?? crypto.randomUUID();
    setError(null);
    dispatch({ type: 'commitStarted', commitId });
    const payload = buildCommitPayload(state);
    let res: CommitResult | null = null;
    try {
      for (let retries = 0; ; retries++) {
        res = await commitScanAction(commitId, payload.rows, payload.outcomesByScanId);
        if (!('code' in res) || res.code !== 'in_progress' || retries >= IN_PROGRESS_RETRIES) break;
        await wait(IN_PROGRESS_WAIT_MS);
      }
    } catch {
      res = null;
    }
    if (res?.ok) {
      dispatch({ type: 'commitDone', commitId: res.commitId, added: res.added, scanIds: res.scanIds });
      onCommitted();
      return;
    }
    dispatch({ type: 'commitFailed' });
    setError(
      res && 'code' in res && res.code === 'already_committed'
        ? { text: COPY.alreadyCommitted, final: true }
        : { text: COPY.commitFailed, final: false },
    );
  };

  // A reload mid-commit rehydrates as committing: finish it with the same id (the action is idempotent).
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    if (state.phase === 'committing' && state.pendingCommitId) void commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warning =
    totals.unresolved === 0
      ? null
      : totals.unresolved === 1
        ? COPY.unresolvedWarningOne
        : fill(COPY.unresolvedWarning, { n: totals.unresolved });

  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="space-y-2 py-3">
        <div aria-live="polite" className="space-y-1">
          {showPrices && (
            <p className="text-sm font-medium tabular-nums">
              <span className="cursor-help" title={COPY.footerTooltip}>
                {footerTotal(totals.priced, totals.unpriced)}
              </span>
            </p>
          )}
          {reading ? (
            <p className="text-xs text-muted-foreground">{COPY.waitingForPhotos}</p>
          ) : (
            warning && <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {error.text}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {error?.final && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              onClick={onScanMore}
            >
              {COPY.scanMore}
            </Button>
          )}
          <Button
            type="button"
            className="min-h-11 flex-1 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={totals.cards === 0 || committing || reading || !!error?.final}
            onClick={() => void commit()}
          >
            {committing ? COPY.committing : fill(COPY.commit, { n: totals.cards })}
          </Button>
        </div>
      </div>
    </div>
  );
}
