'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { MoreHorizontal, Pencil, Share2 } from 'lucide-react';
import { nextSlot, resetMatchAllowed, roundCount, canEditBracket } from '@/lib/bracket';
import type { BracketGame } from '@/lib/bracket/types';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ToastNotification from '@/components/ui/toast-notification';
import {
  abandonBracketGameAction, deleteBracketAction, resetMatchAction, startBracketGameAction,
} from '../actions';
import { BracketTabs } from '../components/BracketTabs';
import { BracketView } from '../components/BracketView';
import { ChampionPanel } from '../components/ChampionPanel';
import { DECIDED_KEY, stdbFormatFor, writeHostGameParams, writeSoloGameParams } from '../lib/gameParams';
import { bracketMeta, buildMatchViews, championPath, firstActionableMatchId, type MatchView } from '../lib/view';
import type { BracketPageData } from '../types';
import { RecordResultDialog } from './RecordResultDialog';

type Toast = { message: string; type: 'success' | 'error' };
type Confirm = {
  title: string; body: string; action: string;
  /** `navigated` skips the refresh when the action already left the page. */
  run: () => Promise<{ ok: boolean; error?: string; navigated?: boolean }>;
};

/** How long the write-in runs before the URL param is stripped (the transition is 500 ms). */
const WRITE_IN_MS = 600;

export function BracketClient({ data, isOwner, viewer, searchParams }: {
  data: BracketPageData;
  isOwner: boolean;
  viewer: { id: string; displayName: string } | null;
  searchParams: { decided: string | null; record: string | null };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { bracket, entries, matches, games } = data;
  const views = useMemo(() => buildMatchViews(data), [data]);
  const viewById = useMemo(() => new Map(views.flat().map(v => [v.match.id, v])), [views]);

  // Seeded from ?decided= so the server renders the write-in's "before" look.
  const [decidedMatchId, setDecidedMatchId] = useState<string | null>(searchParams.decided);
  const [recordMatchId, setRecordMatchId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  // A hand-recorded result waits here until the refreshed data arrives, so the
  // write-in plays against the new rows rather than the old ones.
  const pendingDecided = useRef<string | null>(null);

  const closeToast = useCallback(() => setToast(null), []);
  const fail = (message: string) => setToast({ message, type: 'error' });

  // Deep links, once on mount: ?decided= (or the overlay's sessionStorage hand-off) and ?record=.
  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(DECIDED_KEY); } catch { /* storage blocked */ }
    const decided = searchParams.decided ?? stored;
    if (decided) setDecidedMatchId(decided);
    if (searchParams.record) {
      const game = games.find(g => g.id === searchParams.record);
      // Only an unfinished game can be recorded; the dialog records on the match's live game.
      if (game && !game.winnerEntryId && isOwner) setRecordMatchId(game.matchId);
    }

    if (window.innerWidth < 768) {
      const id = firstActionableMatchId(views);
      if (id) document.getElementById('match-' + id)?.scrollIntoView({ block: 'center' });
    }

    if (!decided && !searchParams.record) return;
    const t = setTimeout(() => {
      try { sessionStorage.removeItem(DECIDED_KEY); } catch { /* storage blocked */ }
      if (searchParams.decided || searchParams.record) router.replace(pathname, { scroll: false });
    }, WRITE_IN_MS);
    return () => clearTimeout(t);
    // Mount only: the params are stripped afterwards and must not replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingDecided.current) return;
    setDecidedMatchId(pendingDecided.current);
    pendingDecided.current = null;
  }, [data]);

  const bracketParams = (view: MatchView, game: { id: string; gameNumber: number; mode: 'solo' | 'online' }) => ({
    gameId: game.id,
    bracketId: bracket.id,
    matchId: view.match.id,
    gameNumber: game.gameNumber,
    bestOf: bracket.bestOf,
    mode: game.mode,
    entryAId: view.a!.id,
    entryBId: view.b!.id,
    deckAName: view.a!.deckName,
    deckBName: view.b!.deckName,
    returnTo: `/brackets/${bracket.id}`,
  });

  const onPlay = async (matchId: string) => {
    const view = viewById.get(matchId);
    if (!viewer || !view || busy) return;
    setBusy(true);
    const res = await startBracketGameAction(matchId, 'solo');
    if (res.ok === false) { setBusy(false); fail(res.error); return; }
    const g = res.data;
    writeSoloGameParams(g.code, {
      deckAId: g.deckAId,
      deckBId: g.deckBId,
      displayName: viewer.displayName,
      supabaseUserId: viewer.id,
      format: stdbFormatFor(g.format),
      firstSeat: g.firstSeat,
      bracket: bracketParams(view, { id: g.gameId, gameNumber: g.gameNumber, mode: 'solo' }),
    });
    router.push('/play/' + g.code);
  };

  const onPlayOnline = async (matchId: string) => {
    const view = viewById.get(matchId);
    if (!viewer || !view || busy) return;
    setBusy(true);
    const res = await startBracketGameAction(matchId, 'online');
    if (res.ok === false) { setBusy(false); fail(res.error); return; }
    const g = res.data;
    writeHostGameParams(g.code, {
      deckAId: g.deckAId,
      deckAName: g.deckAName,
      displayName: viewer.displayName,
      supabaseUserId: viewer.id,
      format: stdbFormatFor(g.format),
      bracket: bracketParams(view, { id: g.gameId, gameNumber: g.gameNumber, mode: 'online' }),
    });
    router.push('/play/' + g.code);
  };

  const onResume = (game: BracketGame) => {
    const view = viewById.get(game.matchId);
    if (!viewer || !view || !game.code || !view.a?.deckId || !view.b?.deckId) return;
    if (game.mode === 'online') {
      // The host resumes their own waiting room; the friend rejoins from the invite link.
      const hostEntry = game.hostSide === 'b' ? view.b : view.a;
      if (!hostEntry?.deckId) return;
      writeHostGameParams(game.code, {
        deckAId: hostEntry.deckId,
        deckAName: hostEntry.deckName,
        displayName: viewer.displayName,
        supabaseUserId: viewer.id,
        format: stdbFormatFor(bracket.format),
        bracket: { ...bracketParams(view, { id: game.id, gameNumber: game.gameNumber, mode: 'online' }), hostSide: game.hostSide },
      });
      router.push('/play/' + game.code);
      return;
    }
    writeSoloGameParams(game.code, {
      deckAId: view.a.deckId,
      deckBId: view.b.deckId,
      displayName: viewer.displayName,
      supabaseUserId: viewer.id,
      format: stdbFormatFor(bracket.format),
      firstSeat: game.firstEntryId === view.match.entryBId ? 1 : 0,
      bracket: bracketParams(view, { id: game.id, gameNumber: game.gameNumber, mode: 'solo' }),
    });
    router.push('/play/' + game.code);
  };

  const onAbandon = (game: BracketGame) => setConfirm({
    title: `Abandon game ${game.gameNumber}?`,
    body: 'The game in progress is discarded. You can start it again from the bracket.',
    action: 'Abandon game',
    run: async () => {
      const res = await abandonBracketGameAction(game.id);
      return res.ok === false ? { ok: false, error: res.error } : { ok: true };
    },
  });

  const onReset = (matchId: string) => {
    const view = viewById.get(matchId);
    if (!view) return;
    const winner = view.match.winnerEntryId === view.a?.id ? view.a : view.b;
    const winnerName = winner?.deckName ?? 'the winner';
    const body = view.match.round === roundCount(bracket.size)
      ? `This clears the ${view.label} result and removes ${winnerName} as champion.`
      : (() => {
          const next = nextSlot(view.match.round, view.match.position);
          const nextLabel = views[next.round - 1]?.[next.position]?.label ?? 'the next round';
          return `This clears the ${view.label} result and removes ${winnerName} from ${nextLabel}.`;
        })();
    setConfirm({
      title: `Reset ${view.label}?`,
      body,
      action: 'Reset match',
      run: async () => {
        const res = await resetMatchAction(matchId);
        return res.ok === false ? { ok: false, error: res.error } : { ok: true };
      },
    });
  };

  const onDelete = () => setConfirm({
    title: 'Delete this bracket?',
    body: `“${bracket.name}” and all of its results are deleted. This cannot be undone.`,
    action: 'Delete bracket',
    run: async () => {
      const res = await deleteBracketAction(bracket.id);
      if (res.ok === false) return { ok: false, error: res.error };
      router.push('/tracker/tournaments');
      return { ok: true, navigated: true };
    },
  });

  const runConfirm = async () => {
    if (!confirm || confirming) return;
    setConfirming(true);
    const res = await confirm.run();
    setConfirming(false);
    setConfirm(null);
    if (!res.ok) { fail(res.error ?? 'Something went wrong.'); return; }
    if (!res.navigated) router.refresh();
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + pathname);
      setToast({ message: 'Link copied', type: 'success' });
    } catch {
      fail('Could not copy the link.');
    }
  };

  const champion = bracket.status === 'complete' && bracket.championEntryId
    ? entries.find(e => e.id === bracket.championEntryId) ?? null
    : null;
  const decidedView = decidedMatchId ? viewById.get(decidedMatchId) : undefined;
  const championPanel = champion ? (
    <ChampionPanel
      entry={champion}
      path={championPath(data, champion.id)}
      animate={!!decidedView && decidedView.match.round === roundCount(bracket.size)}
      breakdownHref={`/brackets/${bracket.id}/breakdown`}
    />
  ) : undefined;

  const meta = bracketMeta(data);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-start justify-between gap-3 sm:mb-8">
        <div className="min-w-0">
          <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">{bracket.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isOwner && canEditBracket(games) && (
            <Button variant="outline" className="min-h-11" asChild>
              <Link href={`/brackets/${bracket.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
          )}
          <Button variant="outline" className="min-h-11" onClick={share}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Bracket actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11 text-destructive" onSelect={onDelete}>
                  Delete bracket
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <BracketTabs bracketId={bracket.id} active="bracket" />

      <BracketView
        views={views}
        size={bracket.size}
        isOwner={isOwner}
        decidedMatchId={decidedMatchId}
        champion={championPanel}
        bracketId={bracket.id}
        canReset={matchId => resetMatchAllowed(matches, games, matchId)}
        {...(isOwner ? { onPlay, onPlayOnline, onResume, onRecord: setRecordMatchId, onAbandon, onReset } : {})}
      />

      {isOwner && (
        <RecordResultDialog
          view={recordMatchId ? viewById.get(recordMatchId) ?? null : null}
          onClose={() => setRecordMatchId(null)}
          onSaved={matchId => {
            setRecordMatchId(null);
            setDecidedMatchId(null);
            pendingDecided.current = matchId;
            router.refresh();
          }}
        />
      )}

      <Dialog open={!!confirm} onOpenChange={open => { if (!open && !confirming) setConfirm(null); }}>
        {confirm && (
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-muted-foreground">{confirm.body}</p>
            </DialogBody>
            <DialogFooter>
              <Button variant="cancel" className="min-h-11" onClick={() => setConfirm(null)} disabled={confirming}>
                Cancel
              </Button>
              <Button variant="destructive" className="min-h-11" onClick={runConfirm} disabled={confirming}>
                {confirm.action}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <ToastNotification
        message={toast?.message ?? ''}
        show={!!toast}
        type={toast?.type}
        onClose={closeToast}
      />
    </div>
  );
}
