'use client';

import { useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { COPY } from '@/app/collection/scan/copy';
import CardViewer from '@/app/collection/scan/components/CardViewer';
import { DECK_COPY, fill } from '../copy';
import type { TrayDeckRow } from '../lib/deckTrayReducer';
import { rowKeyAction } from '../lib/walker';
import type { Candidate, Zone } from '../types';
import RowMenu from './RowMenu';

/** Kinds that carry the amber edge and chip, and that the totals line's "N to check" walks. */
export const AMBER_KINDS = ['which', 'read_as', 'not_found', 'unread'];

const MAX_QTY = 99;
const SWIPE_PX = 80;

const chipClass =
  'shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400';

const stepButton =
  'flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-40';

/** `name|set|imgFile`, split on the last two pipes. */
function keyParts(key: string | null): { name: string; set: string; imgFile: string } | null {
  if (!key) return null;
  const b = key.lastIndexOf('|');
  const a = b > 0 ? key.lastIndexOf('|', b - 1) : -1;
  if (a < 1) return null;
  return { name: key.slice(0, a), set: key.slice(a + 1, b), imgFile: key.slice(b + 1) };
}

interface Props {
  row: TrayDeckRow;
  /** The read title of the row's first read (null for an added card or an unread one). */
  readTitle: string | null;
  candidates: Candidate[];
  /** The zone of the group the row is listed under. */
  groupZone: Zone;
  /** Lost Soul picks made so far; a Lost Soul row shows "N picked" once there are any. */
  lostSoulsPicked: number;
  editable: boolean;
  onOpenPicker: () => void;
  onChangePrinting: () => void;
  onQty: (qty: number) => void;
  onMove: (zone: Zone) => void;
  onRemove: () => void;
  onOpenLostSouls: () => void;
}

/** Focus the row `step` places from `from` among all rows on the page. */
function focusSibling(from: HTMLElement, step: 1 | -1): boolean {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
  const to = rows[rows.indexOf(from) + step];
  to?.focus();
  return !!to;
}

export default function DeckRow({
  row, readTitle, candidates, groupZone, lostSoulsPicked, editable,
  onOpenPicker, onChangePrinting, onQty, onMove, onRemove, onOpenLostSouls,
}: Props) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [stepping, setStepping] = useState(false);
  const stepCancelled = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const lostSoul = row.kind === 'lost_soul';
  const amber = AMBER_KINDS.includes(row.kind);
  const unresolved = row.kind === 'not_found' || row.kind === 'unread';
  const card = row.key ? candidates.find(c => c.key === row.key) ?? null : null;
  const parts = keyParts(row.key);
  const name = card?.name ?? parts?.name ?? '';
  const set = card ? card.officialSet || card.set : parts?.set ?? '';
  const legality = card?.legality ?? '';
  const imgFile = card?.imgFile ?? parts?.imgFile ?? '';
  const thumbSrc = !unresolved && imgFile ? getCardImageUrl(imgFile) : '';
  const label = unresolved ? readTitle || DECK_COPY.unread : name;

  let chip: string | null = null;
  if (row.kind === 'which') chip = DECK_COPY.whichCard;
  else if (row.kind === 'read_as') chip = fill(DECK_COPY.readAs, { title: readTitle ?? '' });
  else if (row.kind === 'not_found') chip = fill(DECK_COPY.notFound, { title: readTitle ?? '' });
  else if (row.kind === 'unread') chip = DECK_COPY.unread;

  const openRow = lostSoul ? onOpenLostSouls : onOpenPicker;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys on the row's own buttons (Enter on −, typing in the stepper) are theirs.
    if (e.target !== e.currentTarget) return;
    const action = rowKeyAction(e);
    if (!action) return;
    if (!editable && action !== 'next' && action !== 'prev') return;
    e.preventDefault();
    switch (action) {
      case 'open': openRow(); break;
      case 'inc': if (!lostSoul && row.quantity < MAX_QTY) onQty(row.quantity + 1); break;
      case 'dec': if (!lostSoul && row.quantity > 1) onQty(row.quantity - 1); break;
      case 'remove':
        if (lostSoul) break;
        // Keep the keyboard in the list: focus moves on before this row goes.
        if (!focusSibling(e.currentTarget, 1)) focusSibling(e.currentTarget, -1);
        onRemove();
        break;
      case 'next': focusSibling(e.currentTarget, 1); break;
      case 'prev': focusSibling(e.currentTarget, -1); break;
    }
  };

  // Swipe left is a shortcut for Remove; a mostly vertical move is a scroll.
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || !editable || lostSoul) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx < -SWIPE_PX && Math.abs(dy) < Math.abs(dx) / 2) onRemove();
  };

  const mainOnlyInReserve = row.mainOnly && groupZone === 'reserve';

  return (
    <li>
      <div
        data-row-id={row.rowKey}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`grid grid-cols-[44px_minmax(0,1fr)_36px_28px_36px_48px] items-center border-l-2 py-1.5 pl-1.5 focus:bg-muted/40 focus:outline-none ${
          amber ? 'border-amber-500' : 'border-transparent'
        }`}
      >
        {thumbSrc ? (
          <button
            type="button"
            tabIndex={-1}
            className="flex h-[62px] w-11 items-center justify-center overflow-hidden rounded-sm bg-muted focus:outline-none"
            aria-label={`${COPY.viewCard}: ${name}, ${set}`}
            onClick={() => setViewerOpen(true)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbSrc} alt="" loading="lazy" className="h-full w-full object-contain" />
          </button>
        ) : (
          <span aria-hidden className="h-[62px] w-11 rounded-sm bg-muted" />
        )}

        <button
          type="button"
          disabled={!editable}
          onClick={openRow}
          className={`flex min-h-11 min-w-0 flex-col justify-center rounded-md px-2 text-left hover:bg-muted/40 focus:outline-none disabled:pointer-events-none ${
            lostSoul ? 'col-span-5' : ''
          }`}
        >
          {lostSoul ? (
            <span className="truncate text-sm font-medium">
              {lostSoulsPicked > 0
                ? fill(DECK_COPY.lostSoulPicked, { n: lostSoulsPicked })
                : fill(DECK_COPY.lostSoulRow, { n: row.quantity })}
            </span>
          ) : (
            <>
              <span className={`line-clamp-2 break-words text-sm font-medium leading-snug ${unresolved ? 'underline underline-offset-4' : ''}`}>
                {unresolved ? COPY.findCard : label}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs">
                {chip ? (
                  <span className={`${chipClass} min-w-0 truncate`}>{chip}</span>
                ) : (
                  <span className="min-w-0 truncate text-muted-foreground">
                    {set}
                    {legality && ` · ${legality}`}
                  </span>
                )}
              </span>
            </>
          )}
        </button>

        {!lostSoul && (
          <>
            <button
              type="button"
              className={stepButton}
              aria-label={`One fewer ${label}`}
              disabled={!editable || row.quantity <= 1}
              onClick={() => onQty(row.quantity - 1)}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            {stepping && editable ? (
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_QTY}
                defaultValue={row.quantity}
                autoFocus
                onFocus={e => e.currentTarget.select()}
                aria-label={`${COPY.quantity} ${label}`}
                className="h-11 w-7 appearance-none rounded-md border border-border bg-background p-0 text-center text-sm tabular-nums focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    stepCancelled.current = true;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={e => {
                  const n = Number(e.currentTarget.value);
                  const cancelled = stepCancelled.current;
                  stepCancelled.current = false;
                  setStepping(false);
                  if (!cancelled && Number.isFinite(n) && n >= 1 && n !== row.quantity) onQty(Math.min(MAX_QTY, Math.round(n)));
                }}
              />
            ) : (
              <button
                type="button"
                  disabled={!editable}
                onClick={() => setStepping(true)}
                aria-label={`${COPY.quantity} ${row.quantity}, change`}
                className="h-11 w-7 rounded-md text-center text-sm font-semibold tabular-nums hover:bg-muted focus:outline-none disabled:pointer-events-none"
              >
                {row.quantity}
              </button>
            )}
            <button
              type="button"
              className={stepButton}
              aria-label={`One more ${label}`}
              disabled={!editable || row.quantity >= MAX_QTY}
              onClick={() => onQty(row.quantity + 1)}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <div className="flex justify-end">
              <RowMenu
                name={label}
                zone={row.zone}
                mainOnly={row.mainOnly}
                canChangePrinting={row.key !== null && !unresolved}
                disabled={!editable}
                onChangePrinting={onChangePrinting}
                onMove={onMove}
                onRemove={onRemove}
              />
            </div>
          </>
        )}
      </div>

      {mainOnlyInReserve && <p className="pb-1.5 pl-[60px] text-xs text-muted-foreground">Counted in main deck</p>}

      {viewerOpen && thumbSrc && (
        <CardViewer
          name={name}
          set={set}
          legality={legality}
          imgSrc={thumbSrc}
          price={null}
          qty={row.quantity}
          showPrices={false}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </li>
  );
}
