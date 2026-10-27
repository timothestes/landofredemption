'use client';

import { useId, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { COPY } from '../copy';
import { rowPrice, type TrayAction, type TrayRow } from '../lib/trayReducer';

interface Props {
  row: TrayRow;
  owned: number;
  showPrices: boolean;
  /** False once the tray is committing or committed. */
  editable: boolean;
  dispatch: React.Dispatch<TrayAction>;
  onOpenPicker: (rowId: string, mode: 'printing' | 'search') => void;
}

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const chipClass =
  'shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400';

const iconButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50';

function checkReason(row: TrayRow): string | null {
  switch (row.detection.printingReason) {
    case 'printing_ambiguous': {
      const legalities = new Set(row.candidates.map(c => c.legality));
      return legalities.size > 1 ? COPY.reasonPrintingLegality : COPY.reasonPrintingPrice;
    }
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

export default function DetectionRow({ row, owned, showPrices, editable, dispatch, onOpenPicker }: Props) {
  const reasonId = useId();
  const [stepperOpen, setStepperOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const card = row.key ? row.candidates.find(c => c.key === row.key) ?? null : null;
  const readTitle = row.detection.read.title ?? '';
  // A key with no candidate entry (search pick without candidates) still has its name in the key.
  const name = card?.name ?? (row.key ? row.key.split('|')[0] : readTitle);
  const set = card ? card.officialSet || card.set : row.key ? row.key.split('|')[1] : '';
  const imgFile = card?.imgFile ?? (row.key ? row.key.split('|')[2] : '');
  const thumbSrc = imgFile ? getCardImageUrl(imgFile) : '';

  const notFound = row.key === null;
  // A player's correction resolves the row; the detection's own status no longer applies.
  const resolved = row.corrected !== 'none';
  const isCheck = !notFound && !resolved && row.detection.status === 'check';
  const isFuzzy = !notFound && !resolved && !isCheck && row.detection.nameReason === 'fuzzy';
  const isEquivalent = !notFound && !resolved && !isCheck && row.detection.printingReason === 'equivalent';
  const reason = isCheck ? checkReason(row) : null;

  const price = card ? rowPrice(row) : null;
  const ownedText = owned > 0 ? ` · ${fill(COPY.owned, { n: owned })}` : '';

  const pickerLabel = notFound ? `${COPY.findCard}: ${readTitle}` : `Change printing: ${name}, ${set}`;

  let lineTwo: React.ReactNode;
  if (notFound) {
    lineTwo = (
      <span className="flex min-w-0 items-center gap-2">
        <span className={chipClass}>{COPY.chipNotFound}</span>
      </span>
    );
  } else if (isCheck) {
    lineTwo = (
      <span className="flex min-w-0 items-center gap-2">
        <span className={chipClass}>{COPY.chipCheck}</span>
        {reason && (
          <span id={reasonId} className="min-w-0 truncate text-muted-foreground">
            {reason}
          </span>
        )}
      </span>
    );
  } else if (isFuzzy) {
    lineTwo = (
      <span className="block truncate text-muted-foreground">
        Read as &ldquo;{readTitle}&rdquo;{ownedText}
      </span>
    );
  } else {
    lineTwo = (
      <span className="block truncate text-muted-foreground">
        {set}
        {isEquivalent && ` · ${fill(COPY.printings, { n: row.candidates.length })}`}
        {ownedText}
      </span>
    );
  }

  return (
    <li>
      <div className="flex items-center py-2">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-muted/40 focus:outline-none disabled:pointer-events-none"
          aria-label={pickerLabel}
          aria-describedby={isCheck && reason ? reasonId : undefined}
          disabled={!editable}
          onClick={() => onOpenPicker(row.rowId, notFound ? 'search' : 'printing')}
        >
          <span className="flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
            {thumbSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc} alt="" loading="lazy" className="h-full w-full object-contain" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {notFound ? readTitle || '—' : name}
                {isFuzzy && <span className="font-normal text-muted-foreground"> · {set}</span>}
              </span>
            </span>
            <span className="mt-0.5 block text-xs">{lineTwo}</span>
          </span>
        </button>

        {showPrices && card && (
          <span className="ml-2 shrink-0 text-right text-sm tabular-nums">
            {price != null ? (
              `$${price.toFixed(2)}`
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

        {notFound ? (
          <button
            type="button"
            className="ml-2 min-h-11 shrink-0 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-50"
            disabled={!editable}
            onClick={() => onOpenPicker(row.rowId, 'search')}
          >
            {COPY.findCard}
          </button>
        ) : (
          <button
            type="button"
            className="ml-2 min-h-11 w-14 shrink-0 rounded-md text-sm font-medium tabular-nums hover:bg-muted focus:outline-none disabled:pointer-events-none"
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
          className={`ml-1 ${iconButton}`}
          aria-label={`${COPY.remove} ${name || readTitle}`}
          aria-expanded={removeOpen}
          disabled={!editable}
          onClick={() => setRemoveOpen(o => !o)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {editable && stepperOpen && !notFound && (
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
        <div className="flex items-center justify-end gap-2 pb-2">
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
        </div>
      )}
    </li>
  );
}
