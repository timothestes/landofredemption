'use client';

import { useToastKeyboardNav, toastFocusShadow } from '@/app/shared/components/toastKeyboardNav';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
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
}

function Pips({ wins, needed }: { wins: number; needed: number }) {
  return (
    <span className="flex gap-1">
      {Array.from({ length: needed }, (_, i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full"
          style={i < wins
            ? { background: 'rgba(var(--gf-accent-rgb), 0.85)' }
            : { border: '1px solid rgba(var(--gf-accent-rgb), 0.45)' }}
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
    options.push({ label: 'Retry', onClick: onRetry });
    options.push({ label: 'Back to bracket', onClick: onBack });
  } else if (!series.decided) {
    options.push({ label: `Play game ${series.series.nextGameNumber}`, onClick: onPlayNext });
    options.push({ label: 'Back to bracket', onClick: onBack });
  } else {
    const winner = series.series.winner === 'b' ? bracket.deckBName : bracket.deckAName;
    statusLine = series.champion
      ? `${winner} is the champion`
      : `${winner} advances to ${series.nextRoundName ?? 'the next round'}`;
    options.push({ label: 'Back to bracket', onClick: onBack });
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

  // The play table's own palette, copied from GameOverOverlay (not site
  // tokens: those turn the card white over the dark table in light mode).
  const gold = 'rgba(var(--gf-accent-rgb), 0.5)';
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        // Same inset as GameOverOverlay: dodge the desktop loupe column; touch is full-width.
        right: isTouch ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(var(--gf-deep-rgb), 0.7)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        role="dialog"
        aria-label="Game over"
        style={{
          background: 'rgba(var(--gf-bg-dark-rgb), 0.97)',
          border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
          borderRadius: 10,
          padding: '32px 36px',
          textAlign: 'center',
          maxWidth: 340,
          width: '100%',
          boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--gf-accent-rgb), 0.08)',
        }}
      >
        <h2 style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 18,
          fontWeight: 700,
          color: 'var(--gf-text-bright)',
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
        }}>
          {result.winnerName} wins game {bracket.gameNumber}
        </h2>

        {data && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'Georgia, serif', fontSize: 13 }}>
            <p style={{ color: gold }}>
              Series {data.series.winsA}–{data.series.winsB}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--gf-text-bright)' }}>
              <span className="truncate">{bracket.deckAName}</span>
              <Pips wins={data.series.winsA} needed={data.series.needed} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: 'var(--gf-text-bright)' }}>
              <span className="truncate">{bracket.deckBName}</span>
              <Pips wins={data.series.winsB} needed={data.series.needed} />
            </div>
          </div>
        )}

        {series === 'pending' && (
          <p style={{ marginTop: 12, fontFamily: 'Georgia, serif', fontSize: 13, color: gold }}>Saving…</p>
        )}
        {statusLine && (
          <p
            role={series === 'failed' ? 'alert' : undefined}
            style={{ marginTop: 16, fontFamily: 'Georgia, serif', fontSize: 13, color: 'var(--gf-text-bright)' }}
          >
            {statusLine}
          </p>
        )}

        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              onClick={o.onClick}
              onMouseEnter={() => setFocusedIndex(i)}
              style={{
                width: '100%',
                padding: '10px 16px',
                minHeight: isTouch ? 44 : undefined,
                borderRadius: 4,
                border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
                background: focusedIndex === i ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
                color: 'var(--gf-text-bright)',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: focusedIndex === i ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
                transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
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
