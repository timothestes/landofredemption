"use client";

import { useState } from "react";
import { ExternalLink, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useInputMode } from "@/app/shared/hooks/useInputMode";
import { cn } from "@/lib/utils";
import { getCardImageUrl } from "@/lib/card-images";
import { getFormatDef } from "@/lib/formats";

export type DeckOption = {
  id: string;
  name: string;
  format: string | null;
  card_count: number | null;
  username?: string | null;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  paragon?: string | null;
  last_played_at?: string | null;
};

interface DeckPickerCardProps {
  deck: DeckOption;
  onClick: () => void;
  selected?: boolean;
  /** Overlay shown top-right of the image header (e.g. a multi-select check). */
  badge?: React.ReactNode;
  /**
   * A secondary "open this deck" control at the tile's bottom-right. Opens in a
   * new tab: the pickers that show it (bracket setup, the play lobby) hold
   * unsaved state the player would lose by navigating away.
   */
  link?: { href: string; label: string; kind: "edit" | "view" };
}

function formatDeckType(format: string | null): string {
  return getFormatDef(format).id;
}

export function DeckPickerCard({ deck, onClick, selected, badge, link }: DeckPickerCardProps) {
  const isTouch = useInputMode() === "touch";
  const [img1Error, setImg1Error] = useState(false);
  const [img2Error, setImg2Error] = useState(false);

  const deckType = formatDeckType(deck.format);
  const isParagon = deckType === "Paragon" && deck.paragon;

  const img1Url = getCardImageUrl(deck.preview_card_1);
  const img2Url = getCardImageUrl(deck.preview_card_2);
  const hasPreviewImages =
    (img1Url && !img1Error) || (img2Url && !img2Error);

  const card = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-full w-full text-left rounded-lg border",
        selected
          ? "border-primary"
          : "border-border [.jayden_&]:border-primary/30",
        "bg-gradient-to-br from-card to-muted/40",
        "[.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)]",
        "hover:border-primary/70",
        "transition-colors cursor-pointer",
        "flex flex-col overflow-hidden",
      )}
    >
      {/* Image Header */}
      {isParagon ? (
        <div className="h-24 overflow-hidden bg-muted">
          <img
            src={`/paragons/Paragon ${deck.paragon}.png`}
            alt={deck.paragon!}
            className="w-full h-full object-cover object-top"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : hasPreviewImages ? (
        <div className="h-24 overflow-hidden flex items-center justify-center gap-1 px-2 py-2">
          {img1Url && !img1Error && (
            <img
              src={img1Url}
              alt=""
              className="h-full object-contain rounded shadow-md"
              onError={() => setImg1Error(true)}
            />
          )}
          {img2Url && !img2Error && (
            <img
              src={img2Url}
              alt=""
              className="h-full object-contain rounded shadow-md"
              onError={() => setImg2Error(true)}
            />
          )}
        </div>
      ) : (
        <div className="h-12 bg-muted flex items-center justify-center">
          <svg
            className="w-5 h-5 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
            />
          </svg>
        </div>
      )}

      {/* Body — right padding keeps the text clear of the link control. */}
      <div className={cn("px-3 py-2 flex flex-col gap-0.5 min-w-0", link && (isTouch ? "pr-12" : "pr-10"))}>
        <span className="text-sm font-medium text-foreground truncate">
          {deck.name}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 leading-4"
          >
            {deckType}
          </Badge>
          {deck.card_count != null && (
            <span>{deck.card_count} cards</span>
          )}
        </div>
        {deck.username && (
          <span className="text-xs text-muted-foreground truncate">
            by {deck.username}
          </span>
        )}
      </div>
      {badge && (
        <span className="absolute top-1.5 right-1.5 pointer-events-none">{badge}</span>
      )}
    </button>
  );

  if (!link) return card;

  // The link is a sibling of the button (an anchor cannot live inside a
  // button). The wrapper and the button are both h-full so the tile still
  // stretches to the grid row like the plain card does.
  const Icon = link.kind === "edit" ? Pencil : ExternalLink;
  return (
    <div className="relative h-full">
      {card}
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={link.label}
        title={`${link.label} (opens in a new tab)`}
        className={cn(
          "absolute bottom-1.5 right-1.5 inline-flex items-center justify-center rounded-md",
          "text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
          isTouch ? "h-11 w-11" : "h-9 w-9",
        )}
      >
        <Icon className="h-4 w-4" />
      </a>
    </div>
  );
}
