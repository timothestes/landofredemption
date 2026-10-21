'use client';

import { useToastKeyboardNav, toastFocusShadow } from '@/app/shared/components/toastKeyboardNav';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { cn } from '@/lib/utils';
import type { recordBracketGameResultAction } from '@/app/brackets/actions';
import type { BracketGameParams } from '@/app/play/lib/bracketGameParams';

/** The writeback's success payload (series state + what comes next). */
export type BracketRecordData = Extract<
  Awaited<ReturnType<typeof recordBracketGameResultAction>>,
  { ok: true }
>['data'];

export type BracketSeriesOutcome = BracketRecordData | 'pending' | 'failed';

interface Option {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

function Pips({ wins, needed }: { wins: number; needed: number }) {
  return (
    <span className="flex gap-1">
      {Array.from({ length: needed }, (_, i) => (
        <span
          key={i}
          className={cn('h-2 w-2 rounded-full', i < wins ? 'bg-primary' : 'border border-border')}
        />
      ))}
    </span>
  );
}

/**
 * The host's game-over surface for a bracket game: who won this game, the
 * series so far, and the way on (next game, next match, or back to the bracket).
 * Replaces GameOverOverlay — bracket games have no rematch.
 */
export default function BracketGameOverOverlay({
  bracket,
  result,
  series,
  onRetry,
  onPlayNext,
  onBack,
  onNextMatch,
}: {
  bracket: BracketGameParams;
  result: { winnerSeat: 0 | 1; winnerName: string };
  series: BracketSeriesOutcome;
  onRetry: () => void;
  onPlayNext: () => void;
  onBack: () => void;
  onNextMatch: (matchId: string) => void;
}) {
  const isTouch = useInputMode() === 'touch';
  const { isLoupeVisible } = useCardPreview();
  const data = typeof series === 'object' ? series : null;

  const options: Option[] = [];
  let statusLine: string | null = null;
  if (series === 'pending') {
    options.push({ label: 'Back to bracket', onClick: onBack });
  } else if (series === 'failed') {
    statusLine = 'Could not save this result.';
    options.push({ label: 'Retry', onClick: onRetry, primary: true });
    options.push({ label: 'Back to bracket', onClick: onBack });
  } else if (!series.decided) {
    options.push({ label: `Play game ${series.series.nextGameNumber}`, onClick: onPlayNext, primary: true });
    options.push({ label: 'Back to bracket', onClick: onBack });
  } else {
    const winner = series.series.winner === 'b' ? bracket.deckBName : bracket.deckAName;
    statusLine = series.champion
      ? `${winner} is the champion`
      : `${winner} advances to ${series.nextRoundName ?? 'the next round'}`;
    options.push({ label: 'Back to bracket', onClick: onBack, primary: true });
    const next = series.nextReadyMatch;
    if (next) {
      options.push({ label: `Next match: ${next.deckAName} vs ${next.deckBName}`, onClick: () => onNextMatch(next.id) });
    }
  }

  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: options.length,
    defaultIndex: 0,
    priority: 2,
    onSelect: (i) => options[i]?.onClick(),
    // Blocking surface: Escape does nothing rather than navigate away.
    onCancel: () => {},
  });

  return (
    <div
      className="fixed inset-0 z-[900] flex items-center justify-center bg-background/70 p-4 backdrop-blur-[3px]"
      // Same inset as GameOverOverlay: dodge the desktop loupe column; touch is full-width.
      style={{ right: isTouch ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px' }}
    >
      <div
        role="dialog"
        aria-label="Game over"
        className="w-full max-w-[340px] rounded-[10px] border border-border bg-card px-9 py-8 text-center text-card-foreground shadow-2xl"
      >
        <h2 className="text-xl font-semibold">
          {result.winnerName} wins game {bracket.gameNumber}
        </h2>

        {data && (
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-muted-foreground">
              Series {data.series.winsA}–{data.series.winsB}
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">{bracket.deckAName}</span>
              <Pips wins={data.series.winsA} needed={data.series.needed} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate">{bracket.deckBName}</span>
              <Pips wins={data.series.winsB} needed={data.series.needed} />
            </div>
          </div>
        )}

        {series === 'pending' && <p className="mt-3 text-sm text-muted-foreground">Saving…</p>}
        {statusLine && (
          <p role={series === 'failed' ? 'alert' : undefined} className="mt-4 text-sm font-medium">
            {statusLine}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              onClick={o.onClick}
              onMouseEnter={() => setFocusedIndex(i)}
              className={cn(
                'w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
                isTouch && 'min-h-11',
                o.primary
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border border-border hover:bg-muted',
              )}
              style={{
                boxShadow:
                  focusedIndex === i
                    ? toastFocusShadow('hsl(var(--primary))', 'hsl(var(--primary) / 0.35)')
                    : 'none',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
