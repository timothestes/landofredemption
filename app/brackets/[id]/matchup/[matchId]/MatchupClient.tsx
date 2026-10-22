'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import type { Card } from '@/app/decklist/card-search/utils';
import type { BestOf } from '@/lib/bracket/types';
import { cn } from '@/lib/utils';
import ToastNotification from '@/components/ui/toast-notification';
import { setKeyCardsAction } from '../../../actions';
import { deckBreakdown } from '../../../lib/matchup';
import { DeckColumn, type MatchupSide } from './DeckColumn';
import { FaceOffTable } from './FaceOffTable';

// The deck builder's card viewer, with prev/next through the column's cards.
const ModalWithClose = dynamic(() => import('@/app/decklist/card-search/ModalWithClose'), { ssr: false });

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const CHIP = 'min-h-11 min-w-0 flex-1 truncate rounded-full border px-4 text-sm font-medium transition-colors';

export type { MatchupSide };

export function MatchupClient({ bracket, label, score, winnerName, a, b, isOwner }: {
  bracket: { id: string; name: string; bestOf: BestOf };
  label: string;
  /** '1–0' once a game has been won, else null. */
  score: string | null;
  winnerName: string | null;
  a: MatchupSide;
  b: MatchupSide;
  isOwner: boolean;
}) {
  const [active, setActive] = useState<'a' | 'b'>('a');
  const [modal, setModal] = useState<{ card: Card; list: Card[] } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const fail = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const breakdownA = useMemo(() => (a.status === 'ok' ? deckBreakdown(a.cards) : null), [a]);
  const breakdownB = useMemo(() => (b.status === 'ok' ? deckBreakdown(b.cards) : null), [b]);

  const save = useCallback((entryId: string, keys: string[]) => setKeyCardsAction(entryId, keys), []);
  const open = useCallback((card: Card, list: Card[]) => setModal({ card, list }), []);

  const kicker = [
    label,
    `Best of ${bracket.bestOf}`,
    score,
    winnerName ? `${winnerName} won` : null,
  ].filter(Boolean).join(' · ');

  const column = (side: MatchupSide, key: 'a' | 'b') => (
    <DeckColumn
      side={side}
      isOwner={isOwner}
      onOpenCard={open}
      onSaveKeyCards={save}
      onError={fail}
      className={cn(active !== key && 'hidden lg:block')}
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
      <header className="mb-6 sm:mb-8">
        <Link
          href={`/brackets/${bracket.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="truncate">{bracket.name}</span>
        </Link>
        <p className={cn(LABEL, 'mt-2 tabular-nums')}>{kicker}</p>
        <h1 className="mt-1 font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">
          {a.entry.deckName}{' '}
          <span className="mx-1 font-sans text-base font-normal text-muted-foreground sm:mx-2">vs</span>{' '}
          {b.entry.deckName}
        </h1>
      </header>

      <FaceOffTable a={breakdownA} b={breakdownB} nameA={a.entry.deckName} nameB={b.entry.deckName} />

      {/* Phones and tablets: one deck at a time, the switch stuck under the nav. */}
      <div className="sticky top-[65px] z-10 -mx-4 mt-6 border-b border-border/60 bg-background px-4 py-2 lg:hidden">
        <div className="flex gap-2" role="tablist" aria-label="Deck">
          {(['a', 'b'] as const).map(key => {
            const side = key === 'a' ? a : b;
            const selected = active === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(key)}
                className={cn(CHIP, selected ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted/40')}
              >
                {side.entry.deckName}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:mt-8 lg:grid-cols-2 lg:gap-10">
        {column(a, 'a')}
        {column(b, 'b')}
      </div>

      {modal && (
        <ModalWithClose
          modalCard={modal.card}
          setModalCard={card => setModal(card ? { card, list: modal.list } : null)}
          visibleCards={modal.list}
          allCards={modal.list}
          onAddCard={null}
          onRemoveCard={null}
          getCardQuantity={null}
          legalityFilter={null}
        />
      )}

      <ToastNotification message={toast?.message ?? ''} show={!!toast} type={toast?.type} onClose={closeToast} />
    </div>
  );
}
