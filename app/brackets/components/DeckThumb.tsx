import type { BracketEntry } from '@/lib/bracket/types';
import { getCardImageUrlOrNull } from '@/app/shared/utils/cardImageUrl';
import { cn } from '@/lib/utils';

/** The cover image for an entry: the paragon for Paragon decks, else preview card 1. */
export function deckCoverUrl(entry: BracketEntry): string | null {
  if (entry.paragon) return `/paragons/Paragon ${entry.paragon}.png`;
  return getCardImageUrlOrNull(entry.previewCard1);
}

export function DeckThumb({ entry, size = 40, dimmed }: { entry: BracketEntry | null; size?: number; dimmed?: boolean }) {
  const url = entry ? deckCoverUrl(entry) : null;
  const box = { width: size, height: size };
  if (!url) {
    return <div aria-hidden className={cn('shrink-0 rounded-sm bg-muted', dimmed && 'opacity-60')} style={box} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      className={cn('shrink-0 rounded-sm bg-muted object-cover object-[50%_30%]', dimmed && 'opacity-60')}
      style={box}
    />
  );
}
