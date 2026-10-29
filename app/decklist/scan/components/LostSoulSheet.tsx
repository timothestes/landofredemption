'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
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
  /** Resolved rows already in the tray; the ones that are Lost Souls count and show checked. */
  trayRows: { key: string; qty: number }[];
  /** Lost Soul placeholders the scan counted. */
  placeholders: number;
  picks: { key: string; qty: number }[];
  onDone: (picks: { key: string; qty: number }[]) => void;
  onSkip: () => void;
  onClose: () => void;
}

const stepButton =
  'flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-40';

export default function LostSoulSheet({ trayRows, placeholders, picks, onDone, onSkip, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);
  const [mod, setMod] = useState<typeof import('../lib/lostSouls') | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  // Lost Souls the tray already holds as rows: they stay counted, and Done writes only what is added to them.
  const [fixed, setFixed] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    void loadLostSouls().then(m => {
      if (!live) return;
      const known = new Set(m.lostSoulOptions(true).map(o => o.key));
      const inTray: Record<string, number> = {};
      for (const r of trayRows) if (known.has(r.key)) inTray[r.key] = (inTray[r.key] ?? 0) + r.qty;
      const start = { ...inTray };
      for (const p of picks) start[p.key] = (start[p.key] ?? 0) + p.qty;
      setFixed(inTray);
      setQty(start);
      setMod(m);
    });
    return () => { live = false; };
    // Once per opening: the props are the state the sheet starts from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked = Object.values(qty).reduce((n, v) => n + v, 0);
  const target = placeholders + Object.values(fixed).reduce((n, v) => n + v, 0);

  const list = useMemo(() => {
    if (!mod) return [];
    // A chosen non-Rotation printing stays listed after Show all printings is turned off.
    const base = mod.lostSoulOptions(true).filter(o => showAll || o.rotation || (qty[o.key] ?? 0) > 0);
    return mod.matchLostSouls(query, base);
  }, [mod, query, showAll, qty]);

  const set = (key: string, n: number) =>
    setQty(q => {
      const next = { ...q };
      const v = Math.max(fixed[key] ?? 0, Math.min(MAX, n));
      if (v > 0) next[key] = v; else delete next[key];
      return next;
    });

  const done = () => {
    const out: { key: string; qty: number }[] = [];
    for (const [key, v] of Object.entries(qty)) {
      const extra = v - (fixed[key] ?? 0);
      if (extra > 0) out.push({ key, qty: extra });
    }
    onDone(out);
    onClose();
  };

  const renderOption = (o: LostSoulOption) => {
    const n = qty[o.key] ?? 0;
    const locked = fixed[o.key] ?? 0;
    const label = o.nickname || o.reference || o.name;
    return (
      <li key={o.key} className="flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5">
        <input
          type="checkbox"
          checked={n > 0}
          disabled={locked > 0}
          onChange={() => set(o.key, n > 0 ? 0 : 1)}
          aria-label={label}
          className="h-5 w-5 shrink-0 accent-green-600 focus:outline-none"
        />
        <span className="flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
          {o.imgFile && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getCardImageUrl(o.imgFile)} alt="" loading="lazy" className="h-full w-full object-contain" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{o.nickname || o.reference}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {o.nickname && o.reference ? `${o.reference} · ` : ''}{o.set}
          </span>
        </span>
        {n > 0 && (
          <span className="flex shrink-0 items-center">
            <button type="button" className={stepButton} aria-label={`One fewer ${label}`} disabled={n <= locked} onClick={() => set(o.key, n - 1)}>
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="w-6 text-center text-sm tabular-nums">{n}</span>
            <button type="button" className={stepButton} aria-label={`One more ${label}`} disabled={n >= MAX} onClick={() => set(o.key, n + 1)}>
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </span>
        )}
      </li>
    );
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
              <DialogTitle className={`text-base tabular-nums ${picked > target ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {fill(DECK_COPY.sheetTitle, { picked, target })}
              </DialogTitle>
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
              onChange={e => setQuery(e.target.value)}
              placeholder="Search nickname, reference or set"
              aria-label="Search Lost Souls"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-base focus:outline-none sm:text-sm"
            />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
                className="h-5 w-5 accent-green-600 focus:outline-none"
              />
              Show all printings
            </label>
          </DialogHeader>
          <DialogBody className="px-2 py-2">
            {!mod ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No Lost Souls match.</p>
            ) : (
              <ul className="space-y-1">{list.map(renderOption)}</ul>
            )}
          </DialogBody>
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => { onSkip(); onClose(); }}
              className="min-h-11 rounded-md px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={done}
              disabled={!mod}
              className="min-h-11 rounded-md bg-green-600 px-5 text-sm font-medium text-white hover:bg-green-700 focus:outline-none disabled:opacity-50"
            >
              Done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
