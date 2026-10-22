'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import type { BracketEntry } from '@/lib/bracket/types';
import { getCardImageUrlOrNull } from '@/app/shared/utils/cardImageUrl';
import { deckCoverUrl } from './DeckThumb';

const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const;

export function ChampionPanel({ entry, path, animate, breakdownHref }: {
  entry: BracketEntry;
  path: string[];
  animate: boolean;
  /** The breakdown page: where the whole bracket's story lives. */
  breakdownHref?: string;
}) {
  // Paragon decks lead with the paragon, then preview card 1; others show both preview cards.
  const images = (entry.paragon
    ? [deckCoverUrl(entry), getCardImageUrlOrNull(entry.previewCard1)]
    : [getCardImageUrlOrNull(entry.previewCard1), getCardImageUrlOrNull(entry.previewCard2)]
  ).filter((u): u is string => !!u);

  const body = (
    <>
      <div className="flex gap-3">
        {images.length > 0
          ? images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-40 w-auto rounded-sm" />
            ))
          : <div aria-hidden className="h-40 w-28 rounded-sm bg-muted" />}
      </div>
      <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Champion</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{entry.deckName}</p>
      {path.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground tabular-nums">
          {path.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {breakdownHref && (
        <Link
          href={breakdownHref}
          className="mt-3 inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          See the breakdown
        </Link>
      )}
    </>
  );

  const className = 'rounded-md bg-card p-6';
  if (!animate) return <div className={className}>{body}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_QUART }}
    >
      {body}
    </motion.div>
  );
}
