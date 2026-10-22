'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import type { EnrichedCard } from '@/app/decklist/[deckId]/enrichDeckCards';
import type { Card } from '@/app/decklist/card-search/utils';
import type { BracketEntry } from '@/lib/bracket/types';
import { getFormatDef } from '@/lib/formats';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import CardTile from '@/components/ui/CardTile';
import { DeckThumb } from '../../../components/DeckThumb';
import { cardKey, groupDeck } from '../../../lib/matchup';

export interface MatchupSide {
  entry: BracketEntry;
  status: 'ok' | 'deleted' | 'private';
  deck: { id: string; name: string; format: string | null; paragon: string | null; ownerName: string | null } | null;
  /** Empty unless `status` is 'ok'. */
  cards: EnrichedCard[];
}

export const MAX_KEY_CARDS = 12;

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-4';
const KEY_GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4';
const CHIP = 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground';

function Tile({ card, isKey, onClick }: { card: EnrichedCard; isKey: boolean; onClick?: () => void }) {
  return (
    <div className={cn('relative rounded-md', isKey && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
      <CardTile card={card} compact onClick={onClick} />
      {isKey && (
        <span aria-label="Key card" className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/75 p-0.5 text-white">
          <Star className="h-3 w-3 fill-current" />
        </span>
      )}
    </div>
  );
}

/**
 * One deck of the matchup: header from the bracket's snapshot, the key-card
 * strip, then the main deck in canonical type buckets and the reserve. The
 * owner can switch the column into choose mode, where tapping a tile stars
 * or unstars it and the whole list is saved at once.
 */
export function DeckColumn({ side, isOwner, onOpenCard, onSaveKeyCards, onError, className }: {
  side: MatchupSide;
  isOwner: boolean;
  onOpenCard: (card: Card, list: Card[]) => void;
  onSaveKeyCards: (entryId: string, keys: string[]) => Promise<{ ok: boolean; error?: string }>;
  onError: (message: string) => void;
  className?: string;
}) {
  const { entry, status, deck, cards } = side;
  const [keys, setKeys] = useState<string[]>(entry.keyCards);
  const [choosing, setChoosing] = useState(false);

  const { main, reserve } = useMemo(() => groupDeck(cards), [cards]);
  const ordered = useMemo(() => [...main.flatMap(g => g.cards), ...reserve], [main, reserve]);
  const navList = useMemo(() => ordered.flatMap(c => (c.fullCard ? [c.fullCard] : [])), [ordered]);
  const keySet = useMemo(() => new Set(keys), [keys]);
  const keyCards = useMemo(() => {
    const seen = new Set<string>();
    return ordered.filter(c => {
      const k = cardKey(c);
      if (!keySet.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [ordered, keySet]);

  const mainCount = main.reduce((n, g) => n + g.count, 0);
  const reserveCount = reserve.reduce((n, c) => n + c.quantity, 0);

  const toggle = async (card: EnrichedCard) => {
    const key = cardKey(card);
    const has = keySet.has(key);
    const next = has ? keys.filter(k => k !== key) : [...keys, key];
    if (!has && next.length > MAX_KEY_CARDS) { onError(`Up to ${MAX_KEY_CARDS} key cards per deck.`); return; }
    const prev = keys;
    setKeys(next);
    const res = await onSaveKeyCards(entry.id, next);
    if (!res.ok) { setKeys(prev); onError(res.error ?? 'Could not save the key cards.'); }
  };

  const tile = (card: EnrichedCard, i: number) => (
    <Tile
      key={`${cardKey(card)}-${card.zone}-${i}`}
      card={card}
      isKey={keySet.has(cardKey(card))}
      onClick={choosing ? () => void toggle(card) : card.fullCard ? () => onOpenCard(card.fullCard!, navList) : undefined}
    />
  );

  const formatId = getFormatDef(deck?.format ?? entry.deckFormat).id;
  const paragon = deck?.paragon ?? entry.paragon;
  const showKeyStrip = status === 'ok' && (isOwner || keyCards.length > 0);

  return (
    <section className={cn('min-w-0', className)} aria-label={entry.deckName}>
      <header className="flex items-start gap-3 border-b border-border/60 pb-3">
        <DeckThumb entry={entry} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight">
            {status === 'ok' && deck ? (
              <Link href={`/decklist/${deck.id}`} className="underline-offset-2 hover:underline">{deck.name}</Link>
            ) : entry.deckName}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className={CHIP}>{formatId}</span>
            {deck?.ownerName && <span className="truncate">by {deck.ownerName}</span>}
            {paragon && <span className="truncate">Paragon: {paragon}</span>}
          </p>
          {status === 'ok' && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {mainCount} main{reserveCount > 0 ? ` · ${reserveCount} reserve` : ''}
            </p>
          )}
        </div>
      </header>

      {status === 'deleted' && (
        <p className="py-6 text-sm text-muted-foreground">This deck was deleted. The bracket keeps its name and art, but the cards are gone.</p>
      )}
      {status === 'private' && (
        <p className="py-6 text-sm text-muted-foreground">This deck is private. Only its owner can see the cards.</p>
      )}

      {showKeyStrip && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border/60 pb-1">
            <h3 className={LABEL}>
              Key cards{keyCards.length > 0 && <span className="ml-1.5 font-normal tabular-nums">({keyCards.length})</span>}
            </h3>
            {isOwner && (
              <Button
                variant={choosing ? 'default' : 'outline'}
                size="sm"
                className="min-h-11"
                aria-pressed={choosing}
                onClick={() => setChoosing(c => !c)}
              >
                {choosing ? 'Done' : 'Choose key cards'}
              </Button>
            )}
          </div>
          {choosing && <p className="mb-2 text-xs text-muted-foreground">Tap cards to mark them as key.</p>}
          {keyCards.length > 0 ? (
            <div className={KEY_GRID}>{keyCards.map(tile)}</div>
          ) : (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No key cards yet. Star the cards this deck&rsquo;s plan turns on.
            </p>
          )}
        </div>
      )}

      {status === 'ok' && (
        <div className="mt-4 space-y-4">
          {main.map(group => (
            <div key={group.key}>
              <h3 className={cn(LABEL, 'mb-1.5 border-b border-border/60 pb-1')}>
                {group.name}<span className="ml-1.5 font-normal tabular-nums">({group.count})</span>
              </h3>
              <div className={GRID}>{group.cards.map(tile)}</div>
            </div>
          ))}
          {reserve.length > 0 && (
            <div>
              <h3 className={cn(LABEL, 'mb-1.5 border-b border-border/60 pb-1')}>
                Reserve<span className="ml-1.5 font-normal tabular-nums">({reserveCount})</span>
              </h3>
              <div className={GRID}>{reserve.map(tile)}</div>
            </div>
          )}
          {main.length === 0 && reserve.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">This deck has no cards.</p>
          )}
        </div>
      )}
    </section>
  );
}
