"use client";

import { useState } from "react";
import Image from "next/image";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";

/** Structural shape — accepts the public deck page's EnrichedCard/DeckCardData
 * and the tournament submission snapshot alike, so both render identical tiles. */
export interface CardTileCard {
  card_name: string;
  card_set?: string;
  card_img_file?: string | null;
  quantity: number;
  type?: string;
}

/**
 * One card in a visual deck grid: art, quantity badge, hover name overlay,
 * name-only fallback when the image is missing.
 *
 * Extracted from the public deck view so the host's submission modal renders
 * decks the same way players see them.
 */
export default function CardTile({
  card,
  onClick,
  onHover,
  compact,
  priority = false,
}: {
  card: CardTileCard;
  onClick?: () => void;
  onHover?: (card: { name: string; imgFile: string; set?: string; type?: string } | null) => void;
  compact?: boolean;
  /** Above-the-fold tile: eager + high fetch priority so it can be the LCP image. */
  priority?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const src = getCardImageUrl(card.card_img_file || "");
  // Only advertise interactivity when there is some. Callers that just display
  // cards (the tournament submission modal) were getting a pointer cursor and a
  // hover ring on every tile and nothing happened on click.
  const interactive = !!onClick;

  return (
    <div
      // Sizing is the caller's grid's job. This used to hardcode a 12-column
      // track plus a negative bottom margin, which pinned every tile to ~70px
      // at every breakpoint and overlapped each row onto the next.
      className={`relative group ${interactive ? "cursor-pointer" : ""}`}
      onClick={onClick}
      onMouseEnter={
        onHover
          ? () =>
              onHover({
                name: card.card_name,
                imgFile: card.card_img_file || "",
                set: card.card_set,
                type: card.type,
              })
          : undefined
      }
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      <div
        className={`relative w-full aspect-[2.5/3.5] bg-muted rounded-md overflow-hidden shadow-sm transition-all ${interactive ? "hover:shadow-md hover:ring-2 hover:ring-blue-500" : ""}`}
      >
        {imgError || !src ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground text-xs p-1">
            <div className="text-center font-medium text-[10px] leading-tight">{card.card_name}</div>
          </div>
        ) : (
          <Image
            src={src}
            alt={card.card_name}
            fill
            className="object-contain"
            sizes={
              compact
                ? "(max-width: 640px) 33vw, (max-width: 1024px) 17vw, 12vw"
                : "(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw"
            }
            loading={priority ? "eager" : "lazy"}
            priority={priority}
            fetchPriority={priority ? "high" : undefined}
            onError={() => setImgError(true)}
          />
        )}

        {/* Quantity badge */}
        {card.quantity > 1 && (
          <div
            className={`absolute top-0.5 right-0.5 bg-black/75 backdrop-blur-sm text-white rounded font-bold shadow-lg ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-xs"}`}
          >
            ×{card.quantity}
          </div>
        )}

        {/* Hover overlay with card name */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
          <div className="w-full p-1 text-white">
            <p className="text-[10px] font-semibold leading-tight truncate">{card.card_name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
