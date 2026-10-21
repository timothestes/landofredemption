'use client';

import type { BracketSize } from '@/lib/bracket/types';
import { nextSlot, roundNames } from '@/lib/bracket';
import { cn } from '@/lib/utils';
import type { MatchView } from '../lib/view';
import { MatchBlock, type MatchCallbacks } from './MatchBlock';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';

/*
 * Desktop layout: one flex column per round, all stretched to the height of
 * round 1. Each match sits in a `flex-1` wrapper that centers its block, so a
 * round-(r+1) wrapper spans exactly its two feeders and its block lands on
 * their midpoint. Connectors are the wrappers' pseudo-elements, in the 2rem
 * column gap: `after:` is an elbow (out of the block's middle, then down to
 * the wrapper's bottom edge for a top feeder, up to its top edge for a bottom
 * feeder), and `before:` is the stub into the next round's block.
 */
const GAP = 'gap-8';
const ELBOW_TOP =
  "after:absolute after:-right-4 after:top-1/2 after:h-1/2 after:w-4 after:border-r after:border-t after:border-border after:content-['']";
const ELBOW_BOTTOM =
  "after:absolute after:-right-4 after:top-0 after:h-1/2 after:w-4 after:border-b after:border-r after:border-border after:content-['']";
const STUB_IN =
  "before:absolute before:-left-4 before:top-1/2 before:w-4 before:border-t before:border-border before:content-['']";
// The write-in: the decided match's outgoing connector and the stub into the
// slot it fed fill to the accent, on the same 500 ms curve as MatchBlock.
const CONNECTOR_FILL =
  'after:transition-[border-color] after:duration-500 after:[transition-timing-function:var(--ease-out-quart)] data-[decided=true]:after:border-primary ' +
  'before:transition-[border-color] before:duration-500 before:[transition-timing-function:var(--ease-out-quart)] data-[fed=true]:before:border-primary';
const STUB_OUT_TO_CHAMPION =
  "after:absolute after:-right-8 after:top-1/2 after:w-8 after:border-t after:border-border after:content-['']";

export function BracketView(props: MatchCallbacks & {
  views: MatchView[][];
  size: BracketSize;
  isOwner: boolean;
  /** The match whose result plays the write-in (see MatchBlock). */
  decidedMatchId?: string | null;
  canReset?: (matchId: string) => boolean;
  /** Drawn in the Champion column on desktop and above round 1 on phones. */
  champion?: React.ReactNode;
}) {
  const { views, size, isOwner, decidedMatchId, canReset, champion, ...callbacks } = props;
  const names = roundNames(size);
  const last = views.length - 1;

  const decided = views.flat().find(v => v.match.id === decidedMatchId);
  const fed = decided && decided.match.round <= last ? nextSlot(decided.match.round, decided.match.position) : null;

  const block = (view: MatchView) => (
    <MatchBlock
      view={view}
      isOwner={isOwner}
      highlight={view.match.id === decidedMatchId ? 'write-in' : null}
      writeInSlot={fed && view.match.round === fed.round && view.match.position === fed.position ? fed.side : null}
      canReset={canReset?.(view.match.id) ?? false}
      {...callbacks}
    />
  );

  return (
    <>
      {/* Desktop: round columns with connector lines. Scrolls sideways at 16 decks. */}
      <div className="hidden overflow-x-auto pb-2 md:block">
        <div className={cn('flex min-w-max', GAP)}>
          {views.map((round, r) => (
            <div key={r} className="flex w-60 shrink-0 flex-col">
              <h3 className={cn(LABEL, 'mb-2')}>{names[r]}</h3>
              <div className="flex flex-1 flex-col">
                {round.map(view => (
                  <div
                    key={view.match.id}
                    data-decided={view.match.id === decidedMatchId ? 'true' : undefined}
                    data-fed={fed && view.match.round === fed.round && view.match.position === fed.position ? 'true' : undefined}
                    className={cn(
                      'relative flex flex-1 flex-col justify-center py-2',
                      CONNECTOR_FILL,
                      r > 0 && STUB_IN,
                      r < last ? (view.match.position % 2 === 0 ? ELBOW_TOP : ELBOW_BOTTOM) : STUB_OUT_TO_CHAMPION,
                    )}
                  >
                    {block(view)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex w-72 shrink-0 flex-col">
            <h3 className={cn(LABEL, 'mb-2')}>Champion</h3>
            <div className="flex flex-1 flex-col justify-center py-2">
              {champion ?? <p className="pl-1 text-sm text-muted-foreground">To be decided</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Phone: one sheet, rounds stacked, first round on top. */}
      <div className="space-y-6 md:hidden">
        {champion}
        {views.map((round, r) => (
          <section key={r}>
            <h3 className={cn(LABEL, 'mb-3 border-b border-border/60 pb-1.5')}>{names[r]}</h3>
            <div className="space-y-3">
              {round.map(view => (
                <div key={view.match.id} id={`match-${view.match.id}`} className="scroll-mt-24">
                  {block(view)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
