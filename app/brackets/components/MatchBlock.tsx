'use client';

import { useEffect, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import type { BracketGame } from '@/lib/bracket/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { MatchView } from '../lib/view';
import { DeckThumb } from './DeckThumb';

export interface MatchCallbacks {
  onPlay?: (matchId: string) => void;
  onPlayOnline?: (matchId: string) => void;
  onResume?: (game: BracketGame) => void;
  onRecord?: (matchId: string) => void;
  onAbandon?: (game: BracketGame) => void;
  onReset?: (matchId: string) => void;
  /** Creation page only: a remove control on each filled row. */
  onRemoveEntry?: (entryId: string) => void;
}

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const WRITE_IN = 'transition-[color,opacity,border-color] duration-500 [transition-timing-function:var(--ease-out-quart)]';

/**
 * The write-in. When `highlight === 'write-in'` (this match was just decided) or
 * `writeInSlot` names a side (that slot was just fed by the decided match), the
 * block renders one frame in its "before" look (winner row un-accented, fed slot
 * content transparent) with `data-written="false"`, then flips to
 * `data-written="true"` and the transition classes carry it to the final look.
 * It replays whenever `highlight`/`writeInSlot` change to a truthy value.
 *
 * `key` is the trigger: truthy means "play". It starts armed when the key is
 * truthy on the first render, so the server and the hydrating client both
 * render the "before" look (no flash of the final look, no mismatch). A key
 * that later changes to a new truthy value re-arms during render, so the
 * "before" look is what commits. The release happens after mount, in an effect.
 */
export function useWriteIn(key: string | boolean | null | undefined): boolean {
  const [armed, setArmed] = useState(() => !!key);
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    if (key) setArmed(true);
  }
  useEffect(() => {
    if (!armed) return;
    // Two frames: let the browser paint the "before" look, then release it.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArmed(false));
    });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [armed]);
  return armed;
}

export function MatchBlock(props: MatchCallbacks & {
  view: MatchView;
  isOwner: boolean;
  highlight?: 'write-in' | null;
  /** Set on the block in the next round whose slot the decided match fed. */
  writeInSlot?: 'a' | 'b' | null;
  canReset?: boolean;
}) {
  const { view, isOwner, highlight, writeInSlot, canReset } = props;
  const { match, state, series } = view;
  const writeIn = highlight === 'write-in' || !!writeInSlot;
  const armed = useWriteIn(writeIn);
  const bestOfOne = series.needed === 1;
  const game = series.inProgress;

  const status =
    state === 'live' ? `Game ${series.nextGameNumber} live`
    : !bestOfOne && series.winsA + series.winsB > 0 ? `${series.winsA}–${series.winsB}`
    : null;

  const row = (side: 'a' | 'b') => {
    const entry = side === 'a' ? view.a : view.b;
    const wins = side === 'a' ? series.winsA : series.winsB;
    const winner = state === 'done' && !!entry && match.winnerEntryId === entry.id;
    const loser = state === 'done' && !!entry && !winner;
    const accented = winner && !(armed && highlight === 'write-in');
    const fed = writeInSlot === side;
    return (
      <div
        className={cn(
          'flex min-h-11 items-center gap-2 border-l-2 border-transparent pl-2.5 pr-3',
          accented && 'border-primary text-primary',
          loser && 'text-muted-foreground',
          winner && highlight === 'write-in' && WRITE_IN,
        )}
      >
        {entry ? (
          <div className={cn('flex min-w-0 flex-1 items-center gap-2', fed && WRITE_IN, fed && armed && 'opacity-0')}>
            <DeckThumb entry={entry} dimmed={loser} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.deckName}</span>
            {state !== 'bye' && state !== 'waiting' && (
              <span className="text-sm tabular-nums">{wins}</span>
            )}
            {props.onRemoveEntry && (
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 min-h-11 min-w-11 text-muted-foreground"
                aria-label={`Remove ${entry.deckName}`}
                onClick={() => props.onRemoveEntry!(entry.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DeckThumb entry={null} />
            <span className="truncate text-sm text-muted-foreground">{side === 'a' ? view.placeholderA : view.placeholderB}</span>
          </div>
        )}
      </div>
    );
  };

  const items: { label: string; run: () => void }[] = [];
  if (isOwner && state === 'ready') {
    if (props.onPlayOnline && view.canPlay) items.push({ label: 'Play online with a friend', run: () => props.onPlayOnline!(match.id) });
    if (props.onRecord) items.push({ label: 'Record result by hand', run: () => props.onRecord!(match.id) });
  } else if (isOwner && state === 'live') {
    if (props.onRecord) items.push({ label: 'Record result by hand', run: () => props.onRecord!(match.id) });
    if (props.onAbandon && game) items.push({ label: 'Abandon this game', run: () => props.onAbandon!(game) });
  } else if (isOwner && state === 'done' && canReset && props.onReset) {
    items.push({ label: 'Reset match', run: () => props.onReset!(match.id) });
  }

  let primary: React.ReactNode = null;
  if (isOwner && (state === 'ready' || state === 'live')) {
    if (!view.canPlay) {
      primary = <span className="flex-1 text-sm text-muted-foreground">Deck no longer available</span>;
    } else if (state === 'ready' && props.onPlay) {
      primary = (
        <Button className="min-h-11 flex-1" onClick={() => props.onPlay!(match.id)}>
          {bestOfOne ? 'Play' : `Play game ${series.nextGameNumber}`}
        </Button>
      );
    } else if (state === 'live' && props.onResume && game) {
      primary = (
        <Button className="min-h-11 flex-1" onClick={() => props.onResume!(game)}>
          Resume game {game.gameNumber}
        </Button>
      );
    }
  }

  return (
    <div
      data-written={writeIn ? String(!armed) : undefined}
      className={cn('rounded-md border border-border/60 bg-card', state === 'bye' && 'opacity-70')}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className={LABEL}>{view.label}</span>
        {status && <span className={cn(LABEL, 'tabular-nums')}>{status}</span>}
      </div>
      <div className="divide-y divide-border/60 border-t border-border/60">
        {row('a')}
        {row('b')}
      </div>
      {view.firstToPlayName && (
        <p className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          {view.firstToPlayName} goes first
        </p>
      )}
      {(primary || items.length > 0) && (
        <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
          {primary ?? <span className="flex-1" />}
          {items.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`More actions for ${view.label}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {items.map(item => (
                  <DropdownMenuItem key={item.label} className="min-h-11" onSelect={item.run}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}

