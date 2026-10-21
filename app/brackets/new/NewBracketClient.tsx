'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { buildBracket, sizeFor } from '@/lib/bracket';
import type { BestOf, Bracket, BracketFormat, BracketMatch } from '@/lib/bracket/types';
import { getFormatDef } from '@/lib/formats';
import { DeckPickerContent } from '@/app/play/components/DeckPickerContent';
import type { DeckOption } from '@/app/play/components/DeckPickerCard';
import { createBracketAction } from '../actions';
import { MatchBlock } from '../components/MatchBlock';
import { DeckThumb } from '../components/DeckThumb';
import { buildMatchViews } from '../lib/view';
import {
  draftEntries, draftSummary, pruneForFamily, shuffleDraft, toggleDraftDeck, type DraftDeck,
} from '../lib/draft';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const FORMATS: BracketFormat[] = ['T1', 'T2', 'Paragon'];
const SERIES: { value: BestOf; label: string }[] = [
  { value: 1, label: 'Bo1' }, { value: 3, label: 'Bo3' }, { value: 5, label: 'Bo5' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function removedNote(n: number, format: BracketFormat): string {
  return n === 1
    ? `Removed 1 deck that is not a ${format} deck.`
    : `Removed ${n} decks that are not ${format} decks.`;
}

function toDraft(deck: DeckOption): DraftDeck {
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format,
    preview_card_1: deck.preview_card_1 ?? null,
    preview_card_2: deck.preview_card_2 ?? null,
    paragon: deck.paragon ?? null,
  };
}

function ChipRow<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{props.label}</span>
      <div role="group" aria-label={props.label} className="flex flex-wrap gap-2">
        {props.options.map(o => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === props.value}
            onClick={() => props.onChange(o.value)}
            className={cn(
              'min-h-11 rounded-full border border-border px-4 text-sm transition-colors',
              o.value === props.value ? 'bg-foreground text-background' : 'hover:bg-muted/40',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewBracketClient({ initialDecks, missingCount = 0 }: { initialDecks: DraftDeck[]; missingCount?: number }) {
  const router = useRouter();
  const [initial] = useState(() => {
    const format: BracketFormat = initialDecks.length > 0 ? getFormatDef(initialDecks[0].format).family : 'T1';
    const { kept, dropped } = pruneForFamily(initialDecks, format);
    const notes: string[] = [];
    if (dropped.length > 0) notes.push(removedNote(dropped.length, format));
    if (missingCount > 0) notes.push(`${plural(missingCount, 'deck')} could not be found.`);
    return { format, picked: kept, note: notes.length > 0 ? notes.join(' ') : null };
  });

  const [name, setName] = useState(
    () => `Deck Bracket · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
  );
  const [format, setFormat] = useState<BracketFormat>(initial.format);
  const [bestOf, setBestOf] = useState<BestOf>(3);
  const [picked, setPicked] = useState<DraftDeck[]>(initial.picked);
  const [note, setNote] = useState<{ text: string; key: number } | null>(
    initial.note ? { text: initial.note, key: 0 } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 5000);
    return () => clearTimeout(t);
  }, [note]);

  const changeFormat = (next: BracketFormat) => {
    if (next === format) return;
    setFormat(next);
    const { kept, dropped } = pruneForFamily(picked, next);
    setPicked(kept);
    if (dropped.length > 0) setNote({ text: removedNote(dropped.length, next), key: Date.now() });
  };

  const toggle = (deck: DeckOption) => setPicked(p => toggleDraftDeck(p, toDraft(deck)));
  const remove = (deckId: string) => setPicked(p => p.filter(d => d.id !== deckId));
  const removeEntry = (entryId: string) => remove(entryId.replace(/^draft-/, ''));

  const selectedDeckIds = useMemo(() => new Set(picked.map(d => d.id)), [picked]);
  const entries = useMemo(() => draftEntries(picked), [picked]);

  const roundOne = useMemo(() => {
    const size = sizeFor(Math.max(2, entries.length));
    let n = 0;
    const ids = () => `draft-match-${n++}`;
    const matches: BracketMatch[] = entries.length >= 2
      ? buildBracket(entries, ids)
      : [{ id: ids(), round: 1, position: 0, entryAId: entries[0]?.id ?? null, entryBId: null, winnerEntryId: null, isBye: false }];
    const bracket: Bracket = { id: 'draft', name, format, size, bestOf, status: 'active', championEntryId: null };
    const placeholder = entries.length <= size / 2 ? 'Tap a deck' : 'Bye';
    return buildMatchViews({ bracket, entries, matches, games: [] })[0].map(v => ({
      ...v,
      placeholderA: v.a ? '' : placeholder,
      placeholderB: v.b ? '' : placeholder,
    }));
  }, [entries, name, format, bestOf]);

  const canStart = picked.length >= 2 && !pending;
  const start = () => {
    setError(null);
    startTransition(async () => {
      const res = await createBracketAction({ name, format, bestOf, deckIds: picked.map(d => d.id) });
      if (res.ok === false) setError(res.error);
      else router.push('/brackets/' + res.data.id);
    });
  };

  const startButton = (
    <Button className="min-h-11 shrink-0" disabled={!canStart} onClick={start}>
      {pending ? 'Starting…' : 'Start bracket'}
    </Button>
  );
  const errorLine = error && <p role="alert" className="text-sm text-destructive">{error}</p>;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
      <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">New deck bracket</h1>

      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:gap-6">
        <div className="flex flex-col gap-1.5 md:w-72">
          <label htmlFor="bracket-name" className={LABEL}>Name</label>
          <Input id="bracket-name" className="min-h-11" value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </div>
        <ChipRow<BracketFormat> label="Format" options={FORMATS.map(f => ({ value: f, label: f }))} value={format} onChange={changeFormat} />
        <ChipRow<BestOf> label="Series" options={SERIES} value={bestOf} onChange={setBestOf} />
      </div>
      {note && <p key={note.key} role="status" className="mt-3 text-sm text-muted-foreground">{note.text}</p>}

      {/* Phone: sticky summary bar under the site header. */}
      <div className="sticky top-[65px] z-20 -mx-4 mt-6 border-b border-border/60 bg-background/95 px-4 py-2 md:hidden">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm tabular-nums">{draftSummary(picked.length)}</p>
          {startButton}
        </div>
        {entries.length > 0 && (
          <div className="-mx-1 mt-1 flex gap-1 overflow-x-auto">
            {entries.map(e => (
              <button
                key={e.id}
                type="button"
                aria-label={`Remove ${e.deckName}`}
                onClick={() => removeEntry(e.id)}
                className="flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <DeckThumb entry={e} size={36} />
              </button>
            ))}
          </div>
        )}
        {errorLine}
      </div>

      <div className="mt-6 md:grid md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-8">
        {/* Desktop: round 1 as it fills. */}
        <section aria-label="Round 1" className="hidden md:block">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(LABEL, 'tabular-nums')}>{draftSummary(picked.length)}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={picked.length < 2}
              onClick={() => setPicked(p => shuffleDraft(p, Math.random))}
            >
              <Shuffle className="mr-1.5 h-4 w-4" />
              Shuffle
            </Button>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {roundOne.map(view => (
              <MatchBlock key={view.match.id} view={view} isOwner={false} onRemoveEntry={removeEntry} />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {startButton}
            {errorLine}
          </div>
        </section>

        <section aria-label="Decks" className="min-w-0">
          <DeckPickerContent onSelect={toggle} selectedDeckIds={selectedDeckIds} lockedFamily={format} />
        </section>
      </div>
    </div>
  );
}
