import type { BracketEntry } from '@/lib/bracket/types';
import { getCardImageUrlOrNull } from '@/app/shared/utils/cardImageUrl';
import { cn } from '@/lib/utils';

/** The cover image for an entry: the paragon for Paragon decks, else preview card 1. */
export function deckCoverUrl(entry: BracketEntry): string | null {
  if (entry.paragon) return `/paragons/Paragon ${entry.paragon}.png`;
  return getCardImageUrlOrNull(entry.previewCard1);
}

/**
 * `portrait` shows the whole card at its own proportions (card 5:7, Paragon art 7:5; `size` tall)
 * instead of the default square crop, which cuts a card down to a sliver of art.
 */
export function DeckThumb({ entry, size = 40, dimmed, portrait }: { entry: BracketEntry | null; size?: number; dimmed?: boolean; portrait?: boolean }) {
  const url = entry ? deckCoverUrl(entry) : null;
  const box = { width: portrait ? Math.round(entry?.paragon ? (size * 7) / 5 : (size * 5) / 7) : size, height: size };
  if (!url) {
    return <div aria-hidden className={cn('shrink-0 rounded-sm bg-muted', dimmed && 'opacity-60')} style={box} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      width={box.width}
      height={box.height}
      className={cn('shrink-0 rounded-sm bg-muted object-cover object-[50%_30%]', dimmed && 'opacity-60')}
      style={box}
    />
  );
}
