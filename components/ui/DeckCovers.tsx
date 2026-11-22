"use client";

import { useState } from "react";
import Image from "next/image";
import { BookOpen } from "lucide-react";
import { getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";
import { getFormatDef } from "@/lib/formats";
import { cn } from "@/lib/utils";

export interface DeckCoverFields {
  format?: string | null;
  paragon?: string | null;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
}

// Two cards side by side at the 345x495 card aspect; a Paragon's 7:5 art fits the same slot.
const HEIGHT = 56;
const CARD_WIDTH = Math.round((HEIGHT * 345) / 495);
const GAP = 4;
const SLOT_WIDTH = CARD_WIDTH * 2 + GAP;
const PARAGON_WIDTH = Math.round((HEIGHT * 7) / 5);

function paragonOf(deck: DeckCoverFields): string | null {
  return getFormatDef(deck.format).id === "Paragon" && deck.paragon ? deck.paragon : null;
}

/** Whether the deck has anything to show: its Paragon, or a cover card. */
export function hasDeckCover(deck: DeckCoverFields): boolean {
  return !!(paragonOf(deck) || getCardImageUrlOrNull(deck.preview_card_1) || getCardImageUrlOrNull(deck.preview_card_2));
}

/**
 * A deck's two cover cards for a picker row, in a fixed slot so rows line up and nothing moves as
 * images load. Paragon decks show their Paragon, as the deck tiles do; no cover shows a blank slot.
 */
export function DeckCovers({ deck }: { deck: DeckCoverFields }) {
  const [failed, setFailed] = useState<string[]>([]);
  const paragon = paragonOf(deck);
  const urls = paragon
    ? []
    : [deck.preview_card_1, deck.preview_card_2]
        .map(getCardImageUrlOrNull)
        .filter((u): u is string => !!u && !failed.includes(u));
  const fail = (url: string) => () => setFailed((f) => [...f, url]);
  const shownParagon = paragon && !failed.includes(paragon) ? paragon : null;

  return (
    <div
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded", !shownParagon && urls.length === 0 && "bg-muted/60")}
      style={{ width: SLOT_WIDTH, height: HEIGHT, gap: GAP }}
    >
      {shownParagon ? (
        <Image
          src={`/paragons/Paragon ${shownParagon}.png`}
          alt=""
          width={PARAGON_WIDTH}
          height={HEIGHT}
          draggable={false}
          onError={fail(shownParagon)}
          className="h-full w-auto rounded-sm object-contain"
        />
      ) : urls.length > 0 ? (
        urls.map((url, i) => (
          <Image
            key={i}
            src={url}
            alt=""
            width={CARD_WIDTH}
            height={HEIGHT}
            draggable={false}
            onError={fail(url)}
            className="h-full w-auto rounded-sm object-contain shadow-sm"
          />
        ))
      ) : (
        <BookOpen className="h-4 w-4 text-muted-foreground/40" />
      )}
    </div>
  );
}
