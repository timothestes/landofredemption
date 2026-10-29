'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DECK_COPY } from '../copy';
import type { Zone } from '../types';

interface Props {
  name: string;
  zone: Zone;
  /** Lost Souls and Dominants are always main deck: no move item. */
  mainOnly: boolean;
  /** Only a row with a card can change printing. */
  canChangePrinting: boolean;
  disabled: boolean;
  onChangePrinting: () => void;
  onMove: (zone: Zone) => void;
  onRemove: () => void;
}

/** The row's ⋯: Change printing, Move to reserve / main deck, Remove. */
export default function RowMenu({ name, zone, mainOnly, canChangePrinting, disabled, onChangePrinting, onMove, onRemove }: Props) {
  const items: { label: string; run: () => void }[] = [];
  if (canChangePrinting) items.push({ label: DECK_COPY.menuPrinting, run: onChangePrinting });
  if (!mainOnly) {
    items.push(zone === 'main'
      ? { label: DECK_COPY.menuToReserve, run: () => onMove('reserve') }
      : { label: DECK_COPY.menuToMain, run: () => onMove('main') });
  }
  items.push({ label: DECK_COPY.menuRemove, run: onRemove });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`More for ${name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map(item => (
          // A tick later, so the menu has handed focus back before the picker takes it.
          <DropdownMenuItem key={item.label} className="min-h-11" onSelect={() => setTimeout(item.run, 0)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
