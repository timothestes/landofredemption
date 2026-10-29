'use client';

import { Plus } from 'lucide-react';
import { DECK_COPY } from '../copy';

/** The last row of every group: a card the photo missed, found with the same search, joins this group. */
export default function AddCardRow({ disabled, onAdd }: { disabled: boolean; onAdd: () => void }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="flex min-h-11 w-full items-center gap-2 rounded-md pl-2 text-left text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex w-11 justify-center">
          <Plus className="h-4 w-4" aria-hidden />
        </span>
        {DECK_COPY.addCard}
      </button>
    </li>
  );
}
