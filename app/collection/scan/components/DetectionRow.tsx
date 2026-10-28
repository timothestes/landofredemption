'use client';

import { useId, useState } from 'react';
import { ChevronRight, Minus, Plus, X } from 'lucide-react';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { COPY, fill } from '../copy';
import { rowPrice, type TrayAction, type TrayRow } from '../lib/trayReducer';
import type { PickerMode } from './PrintingPicker';

interface Props {
  row: TrayRow;
  owned: number;
  /** Price from the catalog price map, used when the row's key has no matching candidate. */
  catalogPrice: number | null;
  showPrices: boolean;
  /** False once the tray is committing or committed. */
  editable: boolean;
  dispatch: React.Dispatch<TrayAction>;
  onOpenPicker: (rowId: string, mode: PickerMode) => void;
}

const chipClass =
  'shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400';

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50';

function checkReason(row: TrayRow, set: string): string | null {
  // With a provisional key the row is added as our guess unless the player changes it: say what the guess is.
  if (row.key !== null) return fill(COPY.reasonPrintingGuess, { set });
  switch (row.detection.printingReason) {
    case 'identity_ambiguous':
      return COPY.reasonNameAmbiguous;
    case 'reference_missing':
      return COPY.reasonScripture;
    case 'reference_ambiguous':
      return COPY.reasonLostSouls;
    default:
      return null;
  }
}

export default function DetectionRow({
  row, owned, catalogPrice, showPrices, editable, dispatch, onOpenPicker,
}: Props) {
  const lineTwoId = useId();
  const [stepperOpen, setStepperOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const card = row.key ? row.candidates.find(c => c.key === row.key) ?? null : null;
  const readTitle = row.detection.read.title ?? '';
  // A key with no candidate entry (search pick without candidates) still has its name in the key.
  const name = card?.name ?? (row.key ? row.key.split('|')[0] : readTitle);
  const set = card ? card.officialSet || card.set : row.key ? row.key.split('|')[1] : '';
  const imgFile = card?.imgFile ?? (row.key ? row.key.split('|')[2] : '');
  const thumbSrc = imgFile ? getCardImageUrl(imgFile) : '';

  // A Check row may have no provisional key (identity or reference ambiguous): it is unresolved, not Not found.
  const unpicked = row.key === null;
  const notFound = unpicked && row.detection.status !== 'check';
  // A player's correction resolves the row; the detection's own status no longer applies.
  const resolved = row.corrected !== 'none';
  const isCheck = !notFound && !resolved && !row.confirmed && row.detection.status === 'check';
  // Its candidates are different cards, so it keeps the Which card? picker after a pick too.
  const chooseCard = row.detection.status === 'check' && row.detection.chosenKey === null;
  const pickerMode: PickerMode = notFound ? 'search' : chooseCard ? 'candidates' : 'printing';
  const isFuzzy = !notFound && !resolved && !isCheck && row.detection.nameReason === 'fuzzy';
  const isEquivalent = !notFound && !resolved && !isCheck && row.detection.printingReason === 'equivalent';
  const reason = isCheck ? checkReason(row, set) : null;

  const price = rowPrice(row) ?? catalogPrice;
  const ownedText = owned > 0 ? ` · ${fill(COPY.owned, { n: owned })}` : '';

  const pickerLabel = notFound
    ? `${COPY.findCard}: ${readTitle}`
    : chooseCard
      ? `${COPY.pickerNameHeader} ${unpicked ? readTitle : name}`
      : `Change printing: ${name}, ${set}`;

  let lineTwo: React.ReactNode;
  if (notFound) {
    lineTwo = <span className={chipClass}>{COPY.chipNotFound}</span>;
  } else if (isCheck) {
    lineTwo = (
      <>
        <span className={chipClass}>{unpicked ? COPY.chipPick : COPY.chipCheck}</span>
        {reason && <span className="min-w-0 truncate text-muted-foreground">{reason}</span>}
      </>
    );
  } else if (isFuzzy) {
    lineTwo = (
      <span className="min-w-0 truncate text-muted-foreground">
        {fill(COPY.readAs, { title: readTitle })}{ownedText}
      </span>
    );
  } else {
    lineTwo = (
      <span className="min-w-0 truncate text-muted-foreground">
        {set}
        {isEquivalent && ` · ${fill(COPY.printings, { n: row.candidates.length })}`}
        {ownedText}
      </span>
    );
  }

  // Grid at 358 px: [thumb 44][text 194 = 8 + name | price][qty 64 = 8 + 56][remove 48 = 4 + 44].
  // The picker button is laid over the thumb and both text lines; the price link sits above it on
  // line one, and line two spans the name and price columns so it keeps the full text width.
  if (row.removedAs !== null) {
    return (
      <li id={`scan-row-${row.rowId}`} className="flex min-h-11 items-center justify-between gap-2 py-1 pl-[52px] text-sm text-muted-foreground">
        <span className="min-w-0 truncate">
          {COPY.removedRow}: <span className="line-through">{unpicked ? readTitle || '—' : name}</span>
        </span>
        {editable && (
          <button
            type="button"
            className="min-h-11 shrink-0 px-2 font-medium text-foreground underline-offset-4 hover:underline focus:outline-none"
            onClick={() => dispatch({ type: 'restoreRow', rowId: row.rowId })}
          >
            {COPY.restore}
          </button>
        )}
      </li>
    );
  }

  return (
    <li id={`scan-row-${row.rowId}`}>
      <div className="relative grid grid-cols-[44px_minmax(0,1fr)_auto_64px_48px] grid-rows-[auto_auto] py-2">
        <button
          type="button"
          className="col-start-1 col-end-4 row-start-1 row-end-3 min-h-11 rounded-md hover:bg-muted/40 focus:outline-none disabled:pointer-events-none"
          aria-label={pickerLabel}
          aria-describedby={lineTwoId}
          disabled={!editable}
          onClick={() => onOpenPicker(row.rowId, pickerMode)}
        />
        <span
          aria-hidden
          className="pointer-events-none col-start-1 row-start-1 row-end-3 flex h-[62px] w-11 items-center justify-center overflow-hidden rounded-sm bg-muted"
        >
          {thumbSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbSrc} alt="" loading="lazy" className="h-full w-full object-contain" />
          )}
        </span>
        <span
          aria-hidden
          className="pointer-events-none col-start-2 row-start-1 line-clamp-2 min-w-0 self-end break-words pl-2 text-sm font-medium leading-snug"
        >
          {unpicked ? readTitle || '—' : name}
          {isFuzzy && <span className="font-normal text-muted-foreground"> · {set}</span>}
        </span>
        {showPrices && !unpicked && (
          <span className="relative z-10 col-start-3 row-start-1 self-end pl-2 text-right text-sm tabular-nums">
            {price != null ? (
              <>
                ${price.toFixed(2)}
                {row.qty > 1 && <span className="text-xs text-muted-foreground"> {COPY.each}</span>}
              </>
            ) : (
              <a
                href={`https://www.yourturngames.biz/search?q=${encodeURIComponent(name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline focus:outline-none"
              >
                {COPY.unpriced}
              </a>
            )}
          </span>
        )}
        <span
          id={lineTwoId}
          aria-hidden
          className="pointer-events-none col-start-2 col-end-4 row-start-2 mt-0.5 flex min-w-0 items-center gap-2 self-start pl-2 text-xs"
        >
          {lineTwo}
          {editable && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </span>

        {unpicked ? (
          <button
            type="button"
            className="col-start-4 row-start-1 row-end-3 min-h-11 w-14 self-center justify-self-end rounded-md border border-border px-1 text-xs font-medium hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-50"
            disabled={!editable}
            onClick={() => onOpenPicker(row.rowId, pickerMode)}
          >
            {notFound ? COPY.findCard : COPY.pickerChoose}
          </button>
        ) : (
          <button
            type="button"
            className="col-start-4 row-start-1 row-end-3 min-h-11 w-14 self-center justify-self-end rounded-md border border-border text-sm font-medium tabular-nums hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:border-transparent"
            aria-label={`${COPY.quantity} ${row.qty}, change`}
            aria-expanded={stepperOpen}
            disabled={!editable}
            onClick={() => setStepperOpen(o => !o)}
          >
            ×{row.qty}
          </button>
        )}

        <button
          type="button"
          className={`col-start-5 row-start-1 row-end-3 self-center justify-self-end ${iconButton}`}
          aria-label={`${COPY.remove} ${name || readTitle}`}
          aria-expanded={removeOpen}
          disabled={!editable}
          onClick={() => setRemoveOpen(o => !o)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {editable && stepperOpen && !unpicked && (
        <div className="flex items-center justify-end gap-1 pb-2">
          <button
            type="button"
            className={`${iconButton} border border-border`}
            aria-label={`One fewer ${name}`}
            disabled={row.qty <= 1}
            onClick={() => dispatch({ type: 'setQty', rowId: row.rowId, qty: row.qty - 1 })}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums">{row.qty}</span>
          <button
            type="button"
            className={`${iconButton} border border-border`}
            aria-label={`One more ${name}`}
            disabled={row.qty >= 99}
            onClick={() => dispatch({ type: 'setQty', rowId: row.rowId, qty: row.qty + 1 })}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {editable && removeOpen && (
        <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
          <span className="text-xs text-muted-foreground">{COPY.removePrompt}</span>
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-muted focus:outline-none"
            onClick={() => dispatch({ type: 'removeRow', rowId: row.rowId, as: 'wrong' })}
          >
            {COPY.removeReasonWrong}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3 text-sm hover:bg-muted focus:outline-none"
            onClick={() => dispatch({ type: 'removeRow', rowId: row.rowId, as: 'unwanted' })}
          >
            {COPY.removeReasonUnwanted}
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-sm font-medium underline-offset-4 hover:underline focus:outline-none"
            onClick={() => {
              setRemoveOpen(false);
              onOpenPicker(row.rowId, pickerMode);
            }}
          >
            {COPY.removeFixInstead}
          </button>
        </div>
      )}
    </li>
  );
}
