'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { abandonBracketGameAction, startBracketGameAction } from '@/app/brackets/actions';
import { stdbFormatFor, writeHostGameParams, writeSoloGameParams, type BracketGameParams } from '@/app/play/lib/bracketGameParams';

export type BracketRecoveryReason = 'no-result' | 'other-device';

const COPY: Record<BracketRecoveryReason, { title: string; body: string }> = {
  'no-result': {
    title: 'This game ended without a result',
    body: 'It was left for more than 30 minutes, so no winner was recorded.',
  },
  'other-device': {
    title: 'This game was started on another device',
    body: 'A solo game can only be played in the browser that started it.',
  },
};

/**
 * Shown instead of the table when a bracket game can't continue here: it
 * finished with no result, or (solo) it belongs to another browser's identity.
 */
export function BracketRecoveryScreen({ reason, bracket, displayName, supabaseUserId, background }: {
  reason: BracketRecoveryReason;
  bracket: BracketGameParams;
  displayName: string;
  supabaseUserId: string;
  background: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the old game is gone, so a retry after a failed start skips abandon.
  const abandonedRef = useRef(false);
  const { title, body } = COPY[reason];

  const startOver = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (!abandonedRef.current) {
      const abandoned = await abandonBracketGameAction(bracket.gameId);
      if (abandoned.ok === false) { setError(abandoned.error); setBusy(false); return; }
      abandonedRef.current = true;
    }
    const started = await startBracketGameAction(bracket.matchId, bracket.mode);
    if (started.ok === false) { setError(started.error); setBusy(false); return; }
    const g = started.data;
    const next: BracketGameParams = {
      ...bracket,
      gameId: g.gameId,
      gameNumber: g.gameNumber,
      bestOf: g.bestOf,
      entryAId: g.entryAId,
      entryBId: g.entryBId,
      deckAName: g.deckAName,
      deckBName: g.deckBName,
      hostSide: 'a',
    };
    if (bracket.mode === 'online') {
      // The host lands in the new waiting room; the friend needs the new invite link.
      writeHostGameParams(g.code, {
        deckAId: g.deckAId,
        deckAName: g.deckAName,
        displayName,
        supabaseUserId,
        format: stdbFormatFor(g.format),
        bracket: next,
      });
    } else {
      writeSoloGameParams(g.code, {
        deckAId: g.deckAId,
        deckBId: g.deckBId,
        displayName,
        supabaseUserId,
        format: stdbFormatFor(g.format),
        firstSeat: g.firstSeat,
        bracket: next,
      });
    }
    router.replace('/play/' + g.code);
  };

  const buttonClass =
    'min-h-11 w-full rounded-md border px-5 py-2.5 font-cinzel text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50';

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black">
      <div
        className="absolute inset-0 bg-cover bg-no-repeat opacity-40"
        style={{ backgroundImage: background, backgroundPosition: 'center 70%' }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)' }}
      />
      <div className="relative z-10 mx-4 w-full max-w-sm rounded-xl border border-amber-200/20 bg-black/60 p-8 text-center backdrop-blur-sm">
        <p className="mb-2 font-cinzel text-base font-semibold text-amber-200/90">{title}</p>
        <p className="text-sm text-amber-200/50">{body}</p>
        {error && <p role="alert" className="mt-4 text-sm text-red-400/90">{error}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={startOver}
            disabled={busy}
            className={`${buttonClass} border-amber-200/45 bg-amber-200/15 text-amber-200/90 hover:bg-amber-200/25`}
          >
            {busy ? 'Starting…' : `Start game ${bracket.gameNumber} over`}
          </button>
          <button
            type="button"
            // Once the old game is abandoned its row is gone, so ?record= would
            // name nothing: open the bracket page alone.
            onClick={() => router.push(abandonedRef.current ? bracket.returnTo : `${bracket.returnTo}?record=${bracket.gameId}`)}
            disabled={busy}
            className={`${buttonClass} border-amber-200/20 text-amber-200/70 hover:bg-amber-200/10`}
          >
            Record result by hand
          </button>
          <button
            type="button"
            onClick={() => router.push(bracket.returnTo)}
            disabled={busy}
            className={`${buttonClass} border-amber-200/20 text-amber-200/70 hover:bg-amber-200/10`}
          >
            Back to bracket
          </button>
        </div>
      </div>
    </div>
  );
}
