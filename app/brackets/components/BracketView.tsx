'use client';

import type { BracketMatch, Shape, Target } from '@/lib/bracket/types';
import { loserTarget, stageRoundName, winnerTarget } from '@/lib/bracket';
import { cn } from '@/lib/utils';
import type { MatchView, StageViews } from '../lib/view';
import { MatchBlock, useWriteIn, type MatchCallbacks } from './MatchBlock';

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
// A losers round that takes in winners-bracket drops keeps its match count, so its feeders run straight across.
const STRAIGHT_OUT =
  "after:absolute after:-right-4 after:top-1/2 after:w-4 after:border-t after:border-border after:content-['']";
const STUB_OUT_TO_CHAMPION =
  "after:absolute after:-right-8 after:top-1/2 after:w-8 after:border-t after:border-border after:content-['']";

export function BracketView(props: MatchCallbacks & {
  views: StageViews;
  shape: Shape;
  isOwner: boolean;
  /** The match whose result plays the write-in (see MatchBlock). */
  decidedMatchId?: string | null;
  canReset?: (matchId: string) => boolean;
  /** Drawn in the Champion column on desktop and above round 1 on phones. */
  champion?: React.ReactNode;
  /** Set on the bracket page so seated matches link to their matchup preview. */
  bracketId?: string;
}) {
  const { views, shape, isOwner, decidedMatchId, canReset, champion, bracketId, ...callbacks } = props;
  const { winners, losers, final } = views;

  const decided = [...winners.flat(), ...losers.flat(), ...(final ? [final] : [])]
    .find(v => v.match.id === decidedMatchId);
  // A decided match writes its winner forward and, from the winners side of a
  // losers bracket, its loser down.
  const fedTargets = decided
    ? [winnerTarget(shape, decided.match), loserTarget(shape, decided.match)]
      .filter((t): t is Target => !!t && t !== 'champion')
    : [];
  const fedSide = (m: BracketMatch) =>
    fedTargets.find(t => t.stage === m.stage && t.round === m.round && t.position === m.position)?.side ?? null;
  // The connectors hold their un-accented look until the write-in releases, in step with MatchBlock.
  const connectorArmed = useWriteIn(decidedMatchId);

  const block = (view: MatchView) => (
    <MatchBlock
      view={view}
      isOwner={isOwner}
      highlight={view.match.id === decidedMatchId ? 'write-in' : null}
      writeInSlot={fedSide(view.match)}
      canReset={canReset?.(view.match.id) ?? false}
      bracketId={bracketId}
      {...callbacks}
    />
  );

  /** One stage's round columns. `outgoing` draws the connector out of a match in column r. */
  const columns = (rounds: MatchView[][], outgoing: (r: number, view: MatchView) => string | false) =>
    rounds.map((round, r) => (
      <div key={r} className="flex w-60 shrink-0 flex-col">
        <h3 className={cn(LABEL, 'mb-2')}>{stageRoundName(shape, round[0]?.match.stage ?? 'winners', r + 1)}</h3>
        <div className="flex flex-1 flex-col">
          {round.map(view => (
            <div
              key={view.match.id}
              data-decided={!connectorArmed && view.match.id === decidedMatchId ? 'true' : undefined}
              data-fed={!connectorArmed && fedSide(view.match) ? 'true' : undefined}
              className={cn(
                'relative flex flex-1 flex-col justify-center py-2',
                CONNECTOR_FILL,
                r > 0 && STUB_IN,
                outgoing(r, view),
                view.empty && 'invisible',
              )}
            >
              {block(view)}
            </div>
          ))}
        </div>
      </div>
    ));

  const elbow = (view: MatchView) => (view.match.position % 2 === 0 ? ELBOW_TOP : ELBOW_BOTTOM);
  const lastWinners = winners.length - 1;
  const lastLosers = losers.length - 1;

  const phoneSection = (title: string, round: MatchView[], key: string) => (
    <section key={key}>
      <h3 className={cn(LABEL, 'mb-3 border-b border-border/60 pb-1.5')}>{title}</h3>
      <div className="space-y-3">
        {round.filter(view => !view.empty).map(view => (
          <div key={view.match.id} id={`match-${view.match.id}`} className="scroll-mt-24">
            {block(view)}
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
      {/* Desktop: round columns with connector lines. Scrolls sideways at 16 decks. */}
      <div className="hidden overflow-x-auto pb-2 md:block">
        <div className={cn('flex min-w-max', GAP)}>
          {columns(winners, (r, view) => (r < lastWinners ? elbow(view) : STUB_OUT_TO_CHAMPION))}
          {final && (
            <div className="flex w-60 shrink-0 flex-col">
              <h3 className={cn(LABEL, 'mb-2')}>{final.label}</h3>
              <div
                data-decided={!connectorArmed && final.match.id === decidedMatchId ? 'true' : undefined}
                data-fed={!connectorArmed && fedSide(final.match) ? 'true' : undefined}
                className={cn('relative flex flex-1 flex-col justify-center py-2', CONNECTOR_FILL, STUB_OUT_TO_CHAMPION)}
              >
                {block(final)}
              </div>
            </div>
          )}
          <div className="flex w-72 shrink-0 flex-col">
            <h3 className={cn(LABEL, 'mb-2')}>Champion</h3>
            <div className="flex flex-1 flex-col justify-center py-2">
              {champion ?? <p className="pl-1 text-sm text-muted-foreground">To be decided</p>}
            </div>
          </div>
        </div>
        {losers.length > 0 && (
          <div className="mt-8 border-t border-border/60 pt-6">
            <h2 className="mb-4 text-sm font-semibold">Losers bracket</h2>
            <div className={cn('flex min-w-max', GAP)}>
              {columns(losers, (r, view) => {
                if (r === lastLosers) return false;
                return losers[r + 1].length === losers[r].length ? STRAIGHT_OUT : elbow(view);
              })}
            </div>
          </div>
        )}
      </div>

      {/* Phone: one sheet, rounds stacked, first round on top. */}
      <div className="space-y-6 md:hidden">
        {champion}
        {winners.map((round, r) => phoneSection(stageRoundName(shape, 'winners', r + 1), round, `w${r}`))}
        {losers.map((round, r) => phoneSection(stageRoundName(shape, 'losers', r + 1), round, `l${r}`))}
        {final && phoneSection(final.label, [final], 'final')}
      </div>
    </>
  );
}
