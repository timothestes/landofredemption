'use client';

import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { DECK_COPY } from '../copy';
import type { Chip } from '../lib/suggest';

const chipClass =
  'inline-flex min-h-12 max-w-full items-center gap-2 rounded-lg border border-border text-left text-sm hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-50';

/** `name|set|imgFile`: the image file is what follows the last pipe. */
const imgFileOf = (key: string) => key.slice(key.lastIndexOf('|') + 1);

interface Props {
  chips: Chip[];
  disabled: boolean;
  onPick: (chip: Chip) => void;
  /** Open the picker, as a tap on the row's name does. */
  onOther: () => void;
}

/**
 * One-tap fixes under a flagged row: the likeliest cards, each with its picture (players know the art better
 * than the exact name), then Other… for the picker.
 */
export default function SuggestionChips({ chips, disabled, onPick, onOther }: Props) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <button key={c.key} type="button" disabled={disabled} onClick={() => onPick(c)} className={`${chipClass} py-1 pl-1 pr-3`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getCardImageUrl(imgFileOf(c.key))} alt="" loading="lazy" className="h-10 w-[29px] shrink-0 rounded-sm bg-muted object-cover" />
          <span className="min-w-0 truncate">{c.label}</span>
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={onOther} className={`${chipClass} px-3 text-muted-foreground`}>
        {DECK_COPY.chipOther}
      </button>
    </div>
  );
}
