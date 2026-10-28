'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { COPY, fill } from '../copy';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { TrayRow } from '../lib/trayReducer';
import type { Candidate } from '../types';
import type { PickerHit } from '../lib/pickerSearch';

// The search pulls the whole card catalog, so it loads on the first keystroke, once.
let searchModule: Promise<typeof import('../lib/pickerSearch')> | null = null;
const loadSearch = () => (searchModule ??= import('../lib/pickerSearch'));

/** candidates: a Check row with no provisional pick chooses which card among its candidates. */
export type PickerMode = 'printing' | 'search' | 'candidates';

interface Props {
  row: TrayRow;
  mode: PickerMode;
  quantities: Map<string, number>;
  showPrices: boolean;
  getPrice: (key: string) => number | null;
  onPick: (key: string, via: 'candidates' | 'search', candidates?: Candidate[]) => void;
  onClose: () => void;
}


export default function PrintingPicker({ row, mode, quantities, showPrices, getPrice, onPick, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  // Find card on a not_found row starts from what was read off the card.
  const initialQuery = mode === 'search' ? (row.detection.read.title ?? '').trim() : '';
  const latestQuery = useRef('');
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<PickerHit[] | null>(null);
  useFocusTrap(trapRef, true);

  const title = mode === 'printing' ? COPY.pickerHeader : COPY.pickerNameHeader;

  const onSearch = async (value: string) => {
    setQuery(value);
    latestQuery.current = value;
    if (!value.trim()) {
      setHits(null);
      return;
    }
    const mod = await loadSearch();
    if (latestQuery.current !== value) return;
    setHits(mod.searchPrintings(value));
  };

  useEffect(() => {
    if (initialQuery) void onSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hits are priced at render, so they pick up the price map once it finishes loading.
  const priced = (h: PickerHit): Candidate => {
    const { identity: _identity, ...c } = h;
    return { ...c, price: getPrice(h.key) };
  };

  const searching = hits !== null;
  const options: (Candidate | PickerHit)[] = searching ? hits : row.candidates;

  const pick = (c: Candidate | PickerHit) => {
    if ('identity' in c) {
      const siblings = (hits ?? []).filter(h => h.identity === c.identity).map(priced);
      onPick(c.key, 'search', siblings);
    } else {
      onPick(c.key, 'candidates');
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        size="md"
        className="fixed inset-x-0 bottom-0 mx-0 max-h-[85vh] max-w-none rounded-b-none rounded-t-xl pb-[env(safe-area-inset-bottom)] sm:static sm:mx-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-lg sm:pb-0"
      >
        <div ref={trapRef} className="flex min-h-0 flex-col">
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
              type="search"
              value={query}
              onChange={e => void onSearch(e.target.value)}
              placeholder={COPY.pickerSearch}
              aria-label={COPY.pickerSearch}
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-base focus:outline-none sm:text-sm"
            />
          </DialogHeader>
          <DialogBody className="px-2 py-2">
            {options.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {searching ? COPY.pickerEmpty : COPY.pickerSearch}
              </p>
            ) : (
              <ul className="space-y-1">
                {options.map(c => {
                  const current = c.key === row.key;
                  const owned = quantities.get(c.key) ?? 0;
                  const price = 'identity' in c ? getPrice(c.key) : c.price;
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => pick(c)}
                        className={`flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted focus:outline-none ${current ? 'bg-muted/60' : ''}`}
                      >
                        <span className="flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
                          {c.imgFile && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={getCardImageUrl(c.imgFile)} alt="" loading="lazy" className="h-full w-full object-contain" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          {(mode !== 'printing' || searching) && (
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                          )}
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
                    </li>
                  );
                })}
              </ul>
            )}
          </DialogBody>
        </div>
      </DialogContent>
    </Dialog>
  );
}
