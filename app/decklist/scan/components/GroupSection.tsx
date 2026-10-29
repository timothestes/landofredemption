'use client';

import type { ReactNode } from 'react';
import { DECK_COPY, fill } from '../copy';
import type { DeckPhoto, Zone } from '../types';
import AddCardRow from './AddCardRow';
import GroupStrip, { SHOW_GROUP_STRIPS } from './GroupStrip';

interface Props {
  /** Display number, in reading order across the tray. */
  index: number;
  photoN: number;
  /** The model's group, or null for the orphan group (reads with no group of their own). */
  group: DeckPhoto['groups'][number] | null;
  /** Cards the scan read in this group. */
  readCount: number;
  zone: Zone;
  /** The prepared photo's object URL; absent after a reload, so no strip. */
  thumb?: string;
  editable: boolean;
  onZone: (zone: Zone) => void;
  onAdd: () => void;
  children: ReactNode;
}

const ZONES: { zone: Zone; label: string }[] = [
  { zone: 'main', label: DECK_COPY.zoneMain },
  { zone: 'reserve', label: DECK_COPY.zoneReserve },
];

export default function GroupSection({
  index, photoN, group, readCount, zone, thumb, editable, onZone, onAdd, children,
}: Props) {
  const estimate = group?.cardCount ?? readCount;
  const heading = estimate !== readCount && estimate > 0
    ? fill(DECK_COPY.groupHeaderEstimate, { i: index, n: readCount, m: estimate })
    : fill(DECK_COPY.groupHeader, { i: index, n: readCount });
  const sideways = group !== null && group.orientation !== 'upright';
  const label = `Group ${index}`;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-sm font-medium tabular-nums">
          {!thumb && <span className="text-muted-foreground">Photo {photoN} · </span>}
          {heading}
          {sideways && <span className="font-normal text-muted-foreground"> · sideways</span>}
        </h3>
        <div role="group" aria-label={`${label} zone`} className="flex shrink-0 rounded-md border border-border p-0.5">
          {ZONES.map(z => (
            <button
              key={z.zone}
              type="button"
              aria-pressed={zone === z.zone}
              disabled={!editable}
              onClick={() => zone !== z.zone && onZone(z.zone)}
              className={`min-h-11 rounded px-3 text-sm focus:outline-none disabled:pointer-events-none ${
                zone === z.zone ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>
      {SHOW_GROUP_STRIPS && thumb && group && (
        <div className="mt-2">
          <GroupStrip photoUrl={thumb} group={group} label={label} />
        </div>
      )}
      <ul className="mt-2 divide-y divide-border/60">
        {children}
        <AddCardRow disabled={!editable} onAdd={onAdd} />
      </ul>
    </li>
  );
}
