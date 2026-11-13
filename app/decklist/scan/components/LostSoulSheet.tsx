'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useFocusTrap } from '@/app/collection/scan/hooks/useFocusTrap';
import { DECK_COPY, fill } from '../copy';
import type { LostSoulOption } from '../lib/lostSouls';

// lostSouls.ts pulls the card catalog: it loads when the sheet opens, once.
let lostSoulsModule: Promise<typeof import('../lib/lostSouls')> | null = null;
const loadLostSouls = () => (lostSoulsModule ??= import('../lib/lostSouls'));

const MAX = 4;

interface Props {
  /** Card keys of the rows already in the tray: a Lost Soul among them shows as already listed. */
  inTray: string[];
  /** Lost Souls the photo showed but could not name: how many there are to pick. */
  placeholders: number;
  picks: { key: string; qty: number }[];
  /**
   * The picks as they stand. Closing the sheet any way keeps them; `finished` is the player pressing Done or
   * Skip, which settles the count even when it is short of what the photo showed.
   */
  onCommit: (picks: { key: string; qty: number }[], finished?: boolean) => void;
  onClose: () => void;
}

const stepButton =
  'flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-40';

export default function LostSoulSheet({ inTray, placeholders, picks, onCommit, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);
  const [mod, setMod] = useState<typeof import('../lib/lostSouls') | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(picks.map(p => [p.key, p.qty])));
  // Versions that stay listed with All versions off: the ones picked when it was turned off.
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(picks.map(p => p.key)));
  const listed = useMemo(() => new Set(inTray), [inTray]);

  useEffect(() => {
    let live = true;
    void loadLostSouls().then(m => live && setMod(m));
    // A keyboard is there to type with; on a phone it would cover the list.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
    return () => { live = false; };
  }, []);

  // A new search starts at its first match.
  useEffect(() => {
    listRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [query, showAll]);

  const picked = Object.values(qty).reduce((n, v) => n + v, 0);

  const { list, older } = useMemo(() => {
    if (!mod) return { list: [] as LostSoulOption[], older: 0 };
    const every = mod.matchLostSouls(query, mod.lostSoulOptions(true));
    if (showAll) return { list: every, older: 0 };
    // One row per soul: its current version, plus any version already picked or read from the photo. The same
    // soul two or three times over, told apart only by a set name, asks a question most players cannot answer.
    const soulOf = (o: LostSoulOption) => `${o.title}|${o.reference}`;
    const seen = new Set(every.filter(o => pinned.has(o.key) || listed.has(o.key)).map(soulOf));
    const shown = every.filter(o => {
      if (pinned.has(o.key) || listed.has(o.key)) return true;
      const soul = soulOf(o);
      if (!o.rotation || seen.has(soul)) return false;
      seen.add(soul);
      return true;
    });
    // A search that only an older card answers lists it, rather than "no match" above a link to more.
    if (shown.length === 0 && query.trim()) return { list: every, older: 0 };
    return { list: shown, older: every.length - shown.length };
  }, [mod, query, showAll, pinned, listed]);

  const set = (key: string, n: number) =>
    setQty(q => {
      const next = { ...q };
      const v = Math.max(0, Math.min(MAX, n));
      if (v > 0) next[key] = v; else delete next[key];
      return next;
    });

  const toggleOlder = () => {
    if (showAll) setPinned(new Set(Object.keys(qty)));
    setShowAll(v => !v);
  };

  const current = () => Object.entries(qty).map(([key, v]) => ({ key, qty: v }));
  // Nothing ticked is ever thrown away: the X, Escape and a tap outside keep the picks too.
  const dismiss = () => { onCommit(current()); onClose(); };
  const finish = () => { onCommit(current(), true); onClose(); };

  const renderOption = (o: LostSoulOption) => {
    const n = qty[o.key] ?? 0;
    const inDeck = listed.has(o.key);
    return (
      <li key={o.key} className="flex items-stretch">
        <button
          type="button"
          aria-pressed={n > 0}
          onClick={() => set(o.key, n > 0 ? 0 : 1)}
          // With no stepper beside it the row is the whole width: nothing to the right of the name is dead.
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted focus:outline-none ${n > 0 ? '' : 'pr-[92px]'}`}
        >
          {/* Green is a pick made here, and the count in the footer. A soul the photo already read is ticked grey. */}
          <span
            aria-hidden
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
              n > 0 ? 'border-primary bg-primary text-primary-foreground'
                : inDeck ? 'border-border bg-muted text-muted-foreground'
                : 'border-muted-foreground/50'
            }`}
          >
            {(n > 0 || inDeck) && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
          <span className="flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
            {o.imgFile && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getCardImageUrl(o.imgFile)} alt="" loading="lazy" className="h-full w-full object-contain" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{o.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{inDeck ? DECK_COPY.sheetInDeck : o.detail}</span>
          </span>
        </button>
        {/* Its width is held by the row's padding until then, so picking a row never moves its text. */}
        <span className={`w-[84px] shrink-0 items-center ${n > 0 ? 'flex' : 'hidden'}`}>
          <button type="button" className={stepButton} aria-label={`One fewer ${o.title}`} onClick={() => set(o.key, n - 1)}>
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <span className="w-3 text-center text-sm tabular-nums">{n}</span>
          <button type="button" className={stepButton} aria-label={`One more ${o.title}`} disabled={n >= MAX} onClick={() => set(o.key, n + 1)}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </li>
    );
  };

  const over = placeholders > 0 && picked > placeholders;

  return (
    <Dialog open onOpenChange={o => !o && dismiss()}>
      <DialogContent
        size="md"
        // One height whatever the list holds, as the card picker has: sized to its content it grew, shrank and re-centred with every search.
        className="fixed inset-x-0 bottom-0 mx-0 h-[85dvh] max-w-none rounded-b-none rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:static sm:mx-4 sm:h-[min(40rem,calc(100dvh-2rem))] sm:max-w-md sm:rounded-lg sm:pb-0"
      >
        <div ref={trapRef} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{DECK_COPY.sheetTitle}</DialogTitle>
              <button
                type="button"
                aria-label="Close"
                onClick={dismiss}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  // Escape empties a search before it closes the sheet; the phone keyboard's search key puts it away.
                  if (e.key === 'Escape' && query) { e.stopPropagation(); e.preventDefault(); setQuery(''); }
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                autoComplete="off"
                placeholder={DECK_COPY.sheetSearch}
                aria-label={DECK_COPY.sheetSearch}
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base focus:border-foreground/40 focus:outline-none focus:ring-0 sm:text-sm"
              />
              <button
                type="button"
                aria-pressed={showAll}
                onClick={toggleOlder}
                className={`h-11 shrink-0 whitespace-nowrap rounded-md border px-3 text-sm focus:outline-none ${
                  showAll ? 'border-foreground/40 bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {DECK_COPY.sheetOlder}
              </button>
            </div>
          </DialogHeader>
          <DialogBody className="flex-1 overscroll-contain px-2 py-2">
            <div ref={listRef}>
              {!mod ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {list.length > 0 && !query.trim() && (
                    <p className="px-2 pb-1 text-xs text-muted-foreground">{DECK_COPY.sheetHint}</p>
                  )}
                  {list.length > 0 && <ul className="space-y-1">{list.map(renderOption)}</ul>}
                  {list.length === 0 && (
                    <p className="px-2 pb-2 pt-6 text-center text-sm text-muted-foreground">{DECK_COPY.sheetEmpty}</p>
                  )}
                  {older > 0 && query.trim() !== '' && (
                    <button
                      type="button"
                      onClick={toggleOlder}
                      className="mx-auto mt-1 block min-h-11 rounded-md px-3 text-sm font-medium underline-offset-4 hover:underline focus:outline-none"
                    >
                      {fill(DECK_COPY.sheetShowOlder, { n: older })}
                    </button>
                  )}
                </>
              )}
            </div>
          </DialogBody>
          <div className="flex shrink-0 items-center gap-3 border-t border-[hsl(var(--dialog-border))] px-4 py-3">
            <p
              aria-live="polite"
              className={`min-w-0 flex-1 text-sm tabular-nums ${over ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
            >
              {placeholders === 0
                ? fill(picked === 1 ? DECK_COPY.lostSoulDoneOne : DECK_COPY.lostSoulDone, { n: picked })
                : fill(over ? DECK_COPY.sheetOver : DECK_COPY.sheetCount, { picked, target: placeholders })}
            </p>
            <button
              type="button"
              onClick={finish}
              disabled={!mod}
              // Green once every one the photo showed is picked: until then Done still works, and does not look finished.
              className={`min-h-11 shrink-0 rounded-md px-5 text-sm font-medium focus:outline-none disabled:opacity-50 ${
                picked > 0 && picked >= placeholders
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : picked > 0
                    ? 'border border-border hover:bg-muted'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {picked > 0 ? DECK_COPY.sheetDone : DECK_COPY.sheetSkip}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
