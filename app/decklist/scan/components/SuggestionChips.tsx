'use client';

import { DECK_COPY } from '../copy';
import type { Chip } from '../lib/suggest';

const chipClass =
  'min-h-11 max-w-full truncate rounded-full border border-border px-3 text-sm hover:bg-muted focus:outline-none disabled:pointer-events-none disabled:opacity-50';

interface Props {
  chips: Chip[];
  disabled: boolean;
  onPick: (chip: Chip) => void;
  /** Open the picker, as a tap on the row's name does. */
  onOther: () => void;
}

/** One-tap fixes under a flagged row: the likeliest cards by name, then Other… for the picker. */
export default function SuggestionChips({ chips, disabled, onPick, onOther }: Props) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <button key={c.key} type="button" disabled={disabled} onClick={() => onPick(c)} className={chipClass}>
          {c.label}
        </button>
      ))}
      <button type="button" disabled={disabled} onClick={onOther} className={`${chipClass} text-muted-foreground`}>
        {DECK_COPY.chipOther}
      </button>
    </div>
  );
}
