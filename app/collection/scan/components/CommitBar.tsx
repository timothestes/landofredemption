'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { commitScanAction } from '../../actions';
import { COPY, fill, footerTotal } from '../copy';
import { buildCommitPayload } from '../lib/outcomes';
import { needsCheck, trayTotals, type TrayAction, type TrayState } from '../lib/trayReducer';
import { COMMIT_LIMITS, type CommitResult } from '../lib/commitCore';

const IN_PROGRESS_WAIT_MS = 1500;
const IN_PROGRESS_RETRIES = 3;

interface Props {
  state: TrayState;
  dispatch: React.Dispatch<TrayAction>;
  showPrices: boolean;
  onShowPrices: () => void;
  /** Catalog price for a row whose own candidates carry none. */
  priceOf: (key: string) => number | null;
  onCommitted: () => void;
  onScanMore: () => void;
}

/**
 * retry: Try again is offered. scanMore: the tray can never be added, start over.
 * collection: point at /collection (the save may have landed). signIn: show a Sign in link.
 */
interface CommitError { text: string; retry: boolean; scanMore?: boolean; collection?: boolean; signIn?: boolean }

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** What the player sees for a failed attempt, and whether the server said for certain nothing was saved. */
function failureOf(res: CommitResult | null): { error: CommitError; nothingSaved: boolean } {
  const code = res && 'code' in res ? res.code : null;
  switch (code) {
    case 'already_committed':
      return { error: { text: COPY.alreadyCommitted, retry: false, scanMore: true }, nothingSaved: true };
    case 'commit_failed':
      return { error: { text: COPY.commitFailed, retry: true }, nothingSaved: true };
    case 'bad_request':
      return { error: { text: COPY.commitStale, retry: false, scanMore: true }, nothingSaved: true };
    case 'unauthorized':
      return { error: { text: COPY.commitSignedOut, retry: true, signIn: true }, nothingSaved: true };
    case 'unconfirmed':
      return { error: { text: COPY.commitUnconfirmed, retry: false, scanMore: true, collection: true }, nothingSaved: false };
    default:
      // Thrown (response lost) or still in progress: the save may have landed. Keep the id and the lock.
      return { error: { text: COPY.commitUnsure, retry: true }, nothingSaved: false };
  }
}

const buttonClass = 'min-h-11 flex-1 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0';

export default function CommitBar({ state, dispatch, showPrices, onShowPrices, priceOf, onCommitted, onScanMore }: Props) {
  const [error, setError] = useState<CommitError | null>(null);
  const resumed = useRef(false);
  const totals = trayTotals(state, priceOf);
  const committing = state.phase === 'committing';
  // An earlier attempt may have saved (also after a reload): only the same id may be retried.
  const locked = state.phase === 'editing' && state.pendingCommitId !== null;
  const shownError = error ?? (locked ? failureOf(null).error : null);
  // A photo still reading is not in the payload yet; committing now would drop its cards.
  const reading = state.photos.some(p => p.status === 'queued' || p.status === 'reading');
  const tooManyRows = totals.rows > COMMIT_LIMITS.rows;

  const commit = async () => {
    const commitId = state.pendingCommitId ?? crypto.randomUUID();
    setError(null);
    dispatch({ type: 'commitStarted', commitId });
    let res: CommitResult | null = null;
    try {
      const payload = buildCommitPayload(state);
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
    const { error: next, nothingSaved } = failureOf(res);
    dispatch({ type: 'commitFailed', nothingSaved });
    setError(next);
  };

  // A reload mid-commit rehydrates as committing: finish it with the same id (the action is idempotent).
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    if (state.phase === 'committing' && state.pendingCommitId) void commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMe = () => {
    const target = state.rows.find(r => needsCheck(r) || (r.removedAs === null && r.key === null));
    const el = document.getElementById(`scan-row-${target?.rowId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // A brief amber wash marks which row was meant once it lands mid-screen.
    el.animate?.([{ backgroundColor: 'rgb(245 158 11 / 0.2)' }, { backgroundColor: 'transparent' }], { duration: 1800, delay: 300 });
  };

  const warnings: string[] = [];
  if (tooManyRows) warnings.push(fill(COPY.commitTooManyRows, { max: COMMIT_LIMITS.rows }));
  if (totals.unresolved > 0) {
    warnings.push(totals.unresolved === 1 ? COPY.unresolvedWarningOne : fill(COPY.unresolvedWarning, { n: totals.unresolved }));
  }
  if (totals.toCheck > 0) {
    warnings.push(totals.toCheck === 1 ? COPY.checkWarningOne : fill(COPY.checkWarning, { n: totals.toCheck }));
  }
  const canShowMe = totals.unresolved > 0 || totals.toCheck > 0;
  const blocked = !!shownError && !shownError.retry;

  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="space-y-2 py-3">
        <div aria-live="polite" className="space-y-1">
          {showPrices ? (
            <p className="text-sm font-medium tabular-nums" title={COPY.footerTooltip}>
              {footerTotal(totals.priced, totals.unpriced)}
            </p>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground focus:outline-none"
              onClick={onShowPrices}
            >
              {COPY.showPrices}
            </button>
          )}
          {reading ? (
            <p className="text-xs text-muted-foreground">{COPY.waitingForPhotos}</p>
          ) : (
            warnings.length > 0 && !shownError && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {warnings.join(' ')}
                {canShowMe && (
                  <>
                    {' '}
                    <button type="button" className="font-medium underline underline-offset-4 focus:outline-none" onClick={showMe}>
                      {COPY.showMe}
                    </button>
                  </>
                )}
              </p>
            )
          )}
          {shownError && (
            <p className="text-sm text-destructive">
              {shownError.text}
              {shownError.signIn && (
                <>
                  {' '}
                  <Link href="/sign-in?redirectTo=/collection/scan" className="font-medium underline underline-offset-4 focus:outline-none">
                    {COPY.signIn}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {shownError?.collection && (
            <Button asChild variant="outline" className={buttonClass}>
              <Link href="/collection">{COPY.viewCollection}</Link>
            </Button>
          )}
          {shownError?.scanMore ? (
            <Button type="button" className={buttonClass} onClick={onScanMore}>
              {COPY.scanMore}
            </Button>
          ) : (
            <Button
              type="button"
              className={buttonClass}
              disabled={totals.cards === 0 || committing || reading || blocked || tooManyRows}
              onClick={() => void commit()}
            >
              {committing ? COPY.committing : shownError?.retry ? COPY.tryAgain : fill(COPY.commit, { n: totals.cards })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
