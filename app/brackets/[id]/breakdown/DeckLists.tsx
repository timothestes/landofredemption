'use client';

import { useMemo, useState } from 'react';
import type { BracketEntry } from '@/lib/bracket/types';
import type { StandingRow } from '@/lib/bracket/standings';
import type { BreakdownCard } from '@/lib/tournament/breakdown';
import { brigadeRank, brigadeSwatch } from '@/lib/tournament/brigadeColors';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { cn } from '@/lib/utils';
import { DeckThumb } from '../../components/DeckThumb';
import { sharedCore, signatureCards, twinsAndLoners, unplayedBrigades } from '../../lib/deckStats';
import type { DeckListsData } from './load';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CORE_PREVIEW = 20;
const SIGNATURE_PREVIEW = 4;

const list = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const range = (values: number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? String(min) : `${min}–${max}`;
};

/**
 * What the lists share and what sets each apart.
 *
 * Every figure is a count over the visible decks; the field is 2–16 decks, so
 * "5 of 8" says what "62%" would only pretend to. The one percentage on the
 * page is the overlap between two lists, which is not a rate over the field.
 * When some lists are hidden, every claim is worded over the visible ones.
 */
export function DeckLists({ data, entries, rows, isOwner }: {
  data: DeckListsData;
  entries: BracketEntry[];
  rows: StandingRow[];
  isOwner: boolean;
}) {
  const { breakdown } = data;
  // Hidden lists exist, so "every deck" and "no other deck" would overclaim.
  const partial = data.privateNames.length + data.deletedNames.length > 0;
  const notes: string[] = [];
  if (data.privateNames.length > 0) {
    notes.push(isOwner
      ? `${list(data.privateNames)} ${data.privateNames.length === 1 ? 'is' : 'are'} no longer public, so ${data.privateNames.length === 1 ? 'its list is' : 'their lists are'} hidden.`
      : `${data.privateNames.length} of ${entries.length} lists ${data.privateNames.length === 1 ? 'is' : 'are'} private; only the owner can see ${data.privateNames.length === 1 ? 'it' : 'them'}.`);
  }
  if (data.deletedNames.length > 0) {
    notes.push(`${list(data.deletedNames)} ${data.deletedNames.length === 1 ? 'was' : 'were'} deleted, so ${data.deletedNames.length === 1 ? 'its list is' : 'their lists are'} missing.`);
  }

  const intro = (
    <>
      <h2 className="text-lg font-semibold">Decklists</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        What the decks share and what sets each apart, from the lists as they are today.
      </p>
      {notes.map(note => (
        <p key={note} className="mt-1 max-w-prose text-sm text-muted-foreground">{note}</p>
      ))}
    </>
  );

  if (!breakdown) {
    return (
      <section>
        {intro}
        <p className="mt-4 text-sm text-muted-foreground">
          {data.unavailable ? 'The lists could not be loaded right now.' : 'This needs at least two visible lists.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      {intro}
      <p className="mt-3 text-sm text-muted-foreground tabular-nums">
        {breakdown.deckCount} lists · {breakdown.distinctCards} distinct cards · main {range(breakdown.decks.map(d => d.mainSize))}
        {breakdown.decks.some(d => d.reserveSize > 0) ? ` · reserve ${range(breakdown.decks.map(d => d.reserveSize))}` : ''}
        {breakdown.decks.some(d => d.lostSouls > 0) ? ` · Lost Souls ${range(breakdown.decks.map(d => d.lostSouls))}` : ''}
      </p>

      <div className="mt-8 space-y-10">
        <SharedCore breakdown={breakdown} partial={partial} />
        <Signatures breakdown={breakdown} entries={entries} rows={rows} editedEntryIds={data.editedEntryIds} partial={partial} />
        <TwinsAndLoners breakdown={breakdown} rows={rows} />
        <Brigades breakdown={breakdown} entries={entries} rows={rows} partial={partial} />
      </div>
    </section>
  );
}

function Group({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className={cn(LABEL, 'border-b border-border/60 pb-1.5')}>{title}</h3>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function CardThumb({ card }: { card: BreakdownCard }) {
  const url = card.imgFile ? getCardImageUrl(card.imgFile) : null;
  return (
    <span className="h-11 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
      )}
    </span>
  );
}

/** One dot per deck in bracket order; filled when that deck runs the card. */
function Pips({ runs, names }: { runs: boolean[]; names: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {runs.map((on, i) => (
        <span
          key={i}
          aria-hidden
          title={names[i]}
          className={cn('h-2 w-2 rounded-full', on ? 'bg-foreground/70' : 'bg-foreground/[0.12]')}
        />
      ))}
      <span className="sr-only">In {list(names.filter((_, i) => runs[i]))}</span>
    </span>
  );
}

function SharedCore({ breakdown, partial }: { breakdown: DeckListsData['breakdown'] & {}; partial: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const core = useMemo(() => sharedCore(breakdown), [breakdown]);
  const names = breakdown.decks.map(d => d.playerName ?? 'Deck');
  const visible = showAll ? core : core.slice(0, CORE_PREVIEW);
  const inEvery = core.filter(r => r.count === breakdown.deckCount).length;
  const every = partial ? 'every visible list' : 'every deck';

  return (
    <Group
      title="Shared core"
      blurb={`Cards in at least two decks, most shared first. One dot per deck in bracket order, filled when that deck runs the card.${inEvery > 0 ? ` ${inEvery} card${inEvery === 1 ? ' is' : 's are'} in ${every}.` : ''}`}
    >
      {core.length === 0 ? (
        <p className="text-sm text-muted-foreground">No card appears in more than one deck.</p>
      ) : (
        <>
          <ol className="divide-y divide-border/60 border-y border-border/60">
            {visible.map(row => (
              <li key={row.card.key} className="flex items-center gap-3 py-2">
                <CardThumb card={row.card} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.card.name}</span>
                  <span className="mt-1 block"><Pips runs={row.runs} names={names} /></span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="font-semibold">{row.count}</span>
                  <span className="text-muted-foreground"> of {breakdown.deckCount}</span>
                </span>
              </li>
            ))}
          </ol>
          {core.length > CORE_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              className="mt-2 inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAll ? 'Show fewer' : `Show all ${core.length} shared cards`}
            </button>
          )}
        </>
      )}
    </Group>
  );
}

function Signatures({ breakdown, entries, rows, editedEntryIds, partial }: {
  breakdown: DeckListsData['breakdown'] & {};
  entries: BracketEntry[];
  rows: StandingRow[];
  editedEntryIds: string[];
  partial: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const signatures = useMemo(() => {
    const byEntry = new Map(signatureCards(breakdown).map(s => [s.deck.participantId, s]));
    // Standings order, so the champion's signature reads first.
    return rows.map(r => byEntry.get(r.entry.id)).filter((s): s is NonNullable<typeof s> => !!s);
  }, [breakdown, rows]);
  const entryById = new Map(entries.map(e => [e.id, e]));
  const edited = new Set(editedEntryIds);

  return (
    <Group
      title="Signature cards"
      blurb={`What no other ${partial ? 'visible list' : 'deck in the bracket'} runs. Tap a deck for its full list.`}
    >
      <ol className="divide-y divide-border/60 border-y border-border/60">
        {signatures.map(sig => {
          const entry = entryById.get(sig.deck.participantId) ?? null;
          const isOpen = open === sig.deck.participantId;
          const preview = sig.cards.slice(0, SIGNATURE_PREVIEW).map(c => c.name);
          const more = sig.cards.length - preview.length;
          const shape = [
            `${sig.deck.mainSize} main`,
            sig.deck.reserveSize > 0 ? `${sig.deck.reserveSize} reserve` : null,
            sig.deck.lostSouls > 0 ? `${sig.deck.lostSouls} Lost Souls` : null,
            edited.has(sig.deck.participantId) ? 'edited since the bracket began' : null,
          ].filter(Boolean).join(' · ');
          return (
            <li key={sig.deck.participantId}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : sig.deck.participantId)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <DeckThumb entry={entry} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{sig.deck.playerName}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">{shape}</span>
                </span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums sm:w-28">
                  <span className="font-semibold">{sig.cards.length}</span>
                  <span className="text-muted-foreground"> unique</span>
                </span>
              </button>
              <div className={cn('px-3 pb-3 text-sm sm:pl-[3.25rem]', !isOpen && 'hidden')}>
                {sig.cards.length === 0 ? (
                  <p className="text-muted-foreground">Nothing unique: every card here is in another {partial ? 'visible list' : 'deck'} too.</p>
                ) : (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {sig.cards.map(card => (
                      <li key={card.key} className="tabular-nums">
                        {card.name}{card.copies > 1 ? <span className="text-muted-foreground"> ×{card.copies}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {!isOpen && sig.cards.length > 0 && (
                <p className="-mt-1 truncate px-3 pb-2 text-xs text-muted-foreground sm:pl-[3.25rem]">
                  {preview.join(', ')}{more > 0 ? `, +${more} more` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </Group>
  );
}

function TwinsAndLoners({ breakdown, rows }: { breakdown: DeckListsData['breakdown'] & {}; rows: StandingRow[] }) {
  const { pair, loner } = useMemo(() => twinsAndLoners(breakdown), [breakdown]);
  const meeting = useMemo(() => {
    if (!pair) return null;
    const row = rows.find(r => r.entry.id === pair.a.participantId);
    const series = row?.road.find(s => s.opponentId === pair.b.participantId && s.won !== null);
    if (!row || !series) return null;
    const winner = series.won ? pair.a.playerName : pair.b.playerName;
    return `They met in ${series.label}: ${winner} won${row.road.length && series.wins + series.losses > 1 ? ` ${Math.max(series.wins, series.losses)}–${Math.min(series.wins, series.losses)}` : ''}.`;
  }, [pair, rows]);

  return (
    <Group
      title="Twins and loners"
      blurb="How alike the lists are. Overlap is the share of the two lists' combined distinct cards that both of them run."
    >
      <div className="space-y-1 text-sm">
        {pair ? (
          <p>
            Most alike: <span className="font-medium">{pair.a.playerName}</span> and{' '}
            <span className="font-medium">{pair.b.playerName}</span>, a{' '}
            <span className="tabular-nums">{pct(pair.similarity)}</span> overlap.
            {meeting ? ` ${meeting}` : ''}
          </p>
        ) : (
          <p>No two decks share a card.</p>
        )}
        {loner && (
          <p>
            Most distinct: <span className="font-medium">{loner.deck.playerName}</span>, with no more than a{' '}
            <span className="tabular-nums">{pct(loner.nearest)}</span> overlap with any other deck.
          </p>
        )}
      </div>
    </Group>
  );
}

function Brigades({ breakdown, entries, rows, partial }: {
  breakdown: DeckListsData['breakdown'] & {};
  entries: BracketEntry[];
  rows: StandingRow[];
  partial: boolean;
}) {
  const entryById = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const deckById = useMemo(() => new Map(breakdown.decks.map(d => [d.participantId, d])), [breakdown.decks]);
  // Standings order. Segments and the printed counts share one order (good
  // brigades, then neutral, then evil), so the bar is a mnemonic and the text
  // beside it is the reading: nothing depends on telling two hues apart.
  const perDeck = useMemo(
    () => rows.flatMap(row => {
      const deck = deckById.get(row.entry.id);
      if (!deck) return [];
      const slices = [...deck.brigades].sort((a, b) => brigadeRank(a.label) - brigadeRank(b.label));
      return [{ entry: entryById.get(row.entry.id) ?? null, deck, slices, total: slices.reduce((n, s) => n + s.copies, 0) }];
    }),
    [rows, deckById, entryById],
  );
  const field = useMemo(
    () => [...breakdown.brigades].sort((a, b) => b.copies - a.copies || brigadeRank(a.label) - brigadeRank(b.label)),
    [breakdown.brigades],
  );
  const maxCopies = Math.max(...field.map(s => s.copies), 1);
  const unplayed = useMemo(() => unplayedBrigades(breakdown), [breakdown]);

  return (
    <Group
      title="Brigades"
      blurb="Each deck's cards by brigade, good brigades first. A multi-brigade card counts toward every brigade it names; Lost Souls and other brigadeless cards are left out."
    >
      <ol className="divide-y divide-border/60 border-y border-border/60">
        {perDeck.map(({ entry, deck, slices, total }) => (
          <li key={deck.participantId} className="flex items-start gap-3 py-2.5">
            <DeckThumb entry={entry} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{deck.playerName}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{total} cards</span>
              </div>
              {slices.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">No brigade cards.</p>
              ) : (
                <>
                  <span aria-hidden className="mt-1.5 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.06]">
                    {slices.map(slice => (
                      <Swatch
                        key={slice.label}
                        label={slice.label}
                        title={`${slice.label} · ${slice.copies} cards`}
                        className="block h-full min-w-[3px]"
                        style={{ flex: `${slice.copies} 1 0%` }}
                      />
                    ))}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {slices.map(slice => `${slice.label} ${slice.copies}`).join(' · ')}
                  </p>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      <h4 className={cn(LABEL, 'mt-6')}>Across the field</h4>
      {field.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No brigade cards found.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {field.map(slice => (
            <li key={slice.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[9rem_1fr_auto]">
              <span className="flex items-center gap-2 truncate text-xs" title={slice.label}>
                <Swatch label={slice.label} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" />
                <span className="truncate">{slice.label}</span>
              </span>
              <span className="h-2 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
                <Swatch
                  label={slice.label}
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max((slice.copies / maxCopies) * 100, 1)}%` }}
                />
              </span>
              <span className="w-28 shrink-0 text-right text-xs tabular-nums">
                <span className="font-semibold text-foreground">{slice.copies}</span>
                <span className="text-muted-foreground"> · {slice.decks} of {breakdown.deckCount} decks</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {unplayed.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Not in any {partial ? 'visible list' : 'deck'}: {unplayed.join(', ')}.
        </p>
      )}
      {/* Global rather than scoped: styled-jsx scopes to the component that renders the
          tag, and the swatches render in a child. The class name is namespaced instead. */}
      <style jsx global>{`
        .bracket-brigade-swatch {
          background-color: var(--swatch-light);
        }
        .dark .bracket-brigade-swatch,
        .jayden .bracket-brigade-swatch {
          background-color: var(--swatch-dark);
        }
      `}</style>
    </Group>
  );
}

/** A brigade's own colour, stepped per theme: a mnemonic beside a printed value, never the reading. */
function Swatch({ label, className, style, title }: {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}) {
  const swatch = brigadeSwatch(label);
  return (
    <span
      aria-hidden
      title={title}
      className={cn('bracket-brigade-swatch', className)}
      style={{ ...style, '--swatch-light': swatch.light, '--swatch-dark': swatch.dark } as React.CSSProperties}
    />
  );
}
