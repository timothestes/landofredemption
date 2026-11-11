'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { COPY, fill } from '../copy';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { Candidate } from '../types';
import { moveActive, onePerCard } from '../lib/pickerRows';
import type { PickerHit } from '../lib/pickerSearch';

// The search pulls the whole card catalog, so it loads on the first keystroke, once.
let searchModule: Promise<typeof import('../lib/pickerSearch')> | null = null;
const loadSearch = () => (searchModule ??= import('../lib/pickerSearch'));

/** candidates: a Check row with no provisional pick chooses which card among its candidates. */
export type PickerMode = 'printing' | 'search' | 'candidates';

interface Props {
  subject: { readTitle: string | null; candidates: Candidate[]; currentKey: string | null };
  /** Shown above the results under a Suggestions heading; one tap picks via 'search'. */
  suggestions?: PickerHit[];
  /** Focus the field and select its text on open. */
  selectQueryOnOpen?: boolean;
  title?: string;
  /** List each card once instead of once per printing, cards legal in Limited first (a deck asks which card, not which printing). */
  oneRowPerCard?: boolean;
  mode: PickerMode;
  quantities: Map<string, number>;
  showPrices: boolean;
  getPrice: (key: string) => number | null;
  onPick: (key: string, via: 'candidates' | 'search', candidates?: Candidate[]) => void;
  onClose: () => void;
}


export default function PrintingPicker({
  subject, suggestions, selectQueryOnOpen, title: titleOverride, oneRowPerCard, mode, quantities, showPrices, getPrice, onPick, onClose,
}: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  // Find card on a not_found row starts from what was read off the card.
  const initialQuery = mode === 'search' ? (subject.readTitle ?? '').trim() : '';
  const latestQuery = useRef('');
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<PickerHit[] | null>(null);
  const [close, setClose] = useState(false);
  // The row Enter picks; the arrow keys move it.
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Cards whose printings were opened or closed by hand; the row's own card starts open, the rest closed.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  useFocusTrap(trapRef, true);

  const title = titleOverride ?? (mode === 'printing' ? COPY.pickerHeader : COPY.pickerNameHeader);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearch = async (value: string) => {
    setQuery(value);
    setActive(0);
    latestQuery.current = value;
    if (!value.trim()) {
      setHits(null);
      return;
    }
    const mod = await loadSearch();
    if (latestQuery.current !== value) return;
    const res = mod.searchPrintings(value);
    setHits(res.hits);
    setClose(res.close);
  };

  useEffect(() => {
    if (selectQueryOnOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    if (initialQuery) void onSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hits are priced at render, so they pick up the price map once it finishes loading.
  const priced = (h: PickerHit): Candidate => {
    const { identity: _identity, ...c } = h;
    return { ...c, price: getPrice(h.key) };
  };

  const searching = hits !== null;
  const typed = query.trim();
  // The catalog loads on the first search: say so instead of flashing "No cards match".
  const loading = typed !== '' && hits === null;
  // Suggestions answer the title that was read. Once the player types their own search, its results stand alone:
  // left above them, the suggestions pushed the card being searched for to the bottom of the list.
  const suggesting = !!suggestions?.length && (typed === '' || typed === initialQuery);
  const shown = suggesting ? suggestions : [];
  const found: { option: Candidate | PickerHit; printings: number; others: PickerHit[] }[] = !searching
    ? subject.candidates.map(option => ({ option, printings: 1, others: [] }))
    : oneRowPerCard
      ? onePerCard(hits, subject.currentKey).map(r => ({ option: r.hit, printings: r.printings, others: r.others }))
      : hits.map(option => ({ option, printings: 1, others: [] }));
  // The search opens on the read title, which is also what the suggestions come from: list a card once.
  const suggestedKeys = new Set(shown.map(c => c.key));
  const suggestedCards = new Set(shown.map(c => c.identity));
  // A card's other printings list under it when it is open: the card the row already has opens by itself, so a
  // wrong printing is one tap from the right one.
  const isOpen = (r: { option: Candidate | PickerHit; others: PickerHit[] }) =>
    r.others.length > 0 && 'identity' in r.option && flipped.has(r.option.identity) !== (r.option.key === subject.currentKey);
  const rest = found
    .filter(({ option }) =>
      !suggestedKeys.has(option.key) && !(oneRowPerCard && 'identity' in option && suggestedCards.has(option.identity)))
    .flatMap(r => [
      { ...r, sub: false, open: isOpen(r) },
      ...(isOpen(r) ? r.others.map(option => ({ option, printings: 1, others: [] as PickerHit[], sub: true, open: false })) : []),
    ]);
  const visible = [...shown.map(option => ({ option, pool: shown as PickerHit[] | undefined })), ...rest.map(r => ({ option: r.option, pool: undefined }))];
  const flip = (identity: string) => setFlipped(prev => {
    const next = new Set(prev);
    if (!next.delete(identity)) next.add(identity);
    return next;
  });

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (c: Candidate | PickerHit, pool: PickerHit[] = hits ?? []) => {
    if ('identity' in c) {
      const siblings = pool.filter(h => h.identity === c.identity).map(priced);
      onPick(c.key, 'search', siblings);
    } else {
      onPick(c.key, 'candidates');
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => moveActive(a, e.key === 'ArrowDown' ? 1 : -1, visible.length));
    } else if (e.key === 'Enter' && visible[active]) {
      e.preventDefault();
      pick(visible[active].option, visible[active].pool);
    }
  };

  const renderOption = (c: Candidate | PickerHit, index: number, pool?: PickerHit[], more?: { printings: number; sub: boolean; open: boolean }) => {
    const printings = more?.printings ?? 1;
    const current = c.key === subject.currentKey;
    const owned = quantities.get(c.key) ?? 0;
    const price = 'identity' in c ? getPrice(c.key) : c.price;
    return (
      <li key={c.key} className={`flex items-stretch gap-1 ${more?.sub ? 'pl-6' : ''}`}>
        <button
          type="button"
          aria-current={current ? 'true' : undefined}
          data-active={index === active}
          tabIndex={-1}
          onClick={() => pick(c, pool)}
          className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted focus:outline-none ${index === active ? 'bg-muted' : ''}`}
        >
          <span className="flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
            {c.imgFile && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={getCardImageUrl(c.imgFile)} alt="" loading="lazy" className="h-full w-full object-contain" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            {/* Printings of one card often differ only in the name's suffix, e.g. "(GoC UR+)". */}
            <span className="block truncate text-sm font-medium">{c.name}</span>
            <span className="block truncate text-sm">
              {c.officialSet || c.set}
              {c.legality && <span className="text-muted-foreground"> · {c.legality}</span>}
            </span>
            {owned > 0 && (
              <span className="block text-xs text-muted-foreground">
                {fill(COPY.pickerOwned, { n: owned })}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            {showPrices && (
              <span className="text-sm tabular-nums">
                {price != null ? `$${price.toFixed(2)}` : <span className="text-xs text-muted-foreground">{COPY.unpriced}</span>}
              </span>
            )}
            {current && <span className="text-xs font-medium text-muted-foreground">{COPY.pickerCurrent}</span>}
          </span>
        </button>
        {printings > 1 && 'identity' in c && (
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={!!more?.open}
            onClick={() => flip(c.identity)}
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
          >
            {fill(COPY.pickerPrintings, { n: printings })}
            <ChevronDown className={`h-3.5 w-3.5 ${more?.open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        )}
      </li>
    );
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="md"
        // One height whatever the list holds: sized to its content, the dialog grew, shrank and re-centred on every keystroke.
        className="fixed inset-x-0 bottom-0 mx-0 h-[85dvh] max-w-none rounded-b-none rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:static sm:mx-4 sm:h-[min(40rem,calc(100dvh-2rem))] sm:max-w-md sm:rounded-lg sm:pb-0"
      >
        <div ref={trapRef} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{title}</DialogTitle>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => void onSearch(e.target.value)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              placeholder={COPY.pickerSearch}
              aria-label={COPY.pickerSearch}
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-base focus:border-foreground/40 focus:outline-none focus:ring-0 sm:text-sm"
            />
          </DialogHeader>
          <DialogBody className="flex-1 px-2 py-2">
            <div ref={listRef}>
              {searching && close && hits.length > 0 && !suggesting && (
                <p className="px-2 pb-1 text-xs text-muted-foreground">{COPY.pickerClose}</p>
              )}
              {suggesting && (
                <div className="pb-2">
                  <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Suggestions</p>
                  <ul className="space-y-1">{shown.map((c, i) => renderOption(c, i, shown))}</ul>
                </div>
              )}
              {suggesting && rest.length > 0 && (
                <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{COPY.pickerMore}</p>
              )}
              {rest.length > 0 ? (
                <ul className="space-y-1">
                  {rest.map((r, i) => renderOption(r.option, shown.length + i, undefined, r))}
                </ul>
              ) : !suggesting && (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {loading ? COPY.pickerSearching : searching ? COPY.pickerEmpty : COPY.pickerSearch}
                </p>
              )}
            </div>
          </DialogBody>
        </div>
      </DialogContent>
    </Dialog>
  );
}
