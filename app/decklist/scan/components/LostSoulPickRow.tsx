'use client';

import { Minus, Plus } from 'lucide-react';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

const stepButton =
  'flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-40';

/** `name|set|imgFile`, split on the last two pipes. */
function parts(key: string) {
  const b = key.lastIndexOf('|');
  const a = b > 0 ? key.lastIndexOf('|', b - 1) : -1;
  return a < 1 ? { name: key, set: '', imgFile: '' } : { name: key.slice(0, a), set: key.slice(a + 1, b), imgFile: key.slice(b + 1) };
}

/** A picked Lost Soul, listed under the summary row; qty 0 removes it. */
export default function LostSoulPickRow({
  pick, editable, onQty,
}: { pick: { key: string; qty: number }; editable: boolean; onQty: (qty: number) => void }) {
  const { name, set, imgFile } = parts(pick.key);
  return (
    <li>
      <div className="grid grid-cols-[44px_minmax(0,1fr)_36px_28px_36px] items-center border-l-2 border-transparent py-1.5 pl-1.5">
        <span className="flex h-[62px] w-11 items-center justify-center overflow-hidden rounded-sm bg-muted">
          {imgFile && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getCardImageUrl(imgFile)} alt="" loading="lazy" className="h-full w-full object-contain" />
          )}
        </span>
        <span className="flex min-w-0 flex-col px-2">
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{name}</span>
          <span className="truncate text-xs text-muted-foreground">{set}</span>
        </span>
        <button type="button" className={stepButton} aria-label={`One fewer ${name}`} disabled={!editable} onClick={() => onQty(pick.qty - 1)}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span className="text-center text-sm tabular-nums">{pick.qty}</span>
        <button type="button" className={stepButton} aria-label={`One more ${name}`} disabled={!editable || pick.qty >= 4} onClick={() => onQty(pick.qty + 1)}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
