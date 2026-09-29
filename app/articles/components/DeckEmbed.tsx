"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import CardTile from "@/components/ui/CardTile";
import CardEnlargeModal from "@/components/ui/CardEnlargeModal";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import type { DeckEmbedCard, DeckEmbedData } from "@/lib/decks/embed";

// A deck URL alone on a paragraph renders as this: the deck grouped by type,
// tap a card to enlarge it and step through the rest. `not-prose` keeps the
// article's typography from restyling the grid.

const KICKER = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

export default function DeckEmbed({ id, deck }: { id: string; deck: DeckEmbedData | null }) {
  const href = `/decklist/${id}`;
  if (!deck) {
    return (
      <div className="article-embed not-prose my-6 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p>This deck isn’t available. It may be private or deleted.</p>
        <a
          href={href}
          className="mt-1 inline-flex min-h-11 items-center underline underline-offset-2 hover:text-foreground"
        >
          Open the deck page
        </a>
      </div>
    );
  }
  return <ResolvedDeck deck={deck} href={href} />;
}

function ResolvedDeck({ deck, href }: { deck: DeckEmbedData; href: string }) {
  const sections = [
    ...deck.groups.map((g) => ({
      label: g.label,
      count: g.count,
      cards: g.cards,
    })),
    ...(deck.reserve.length > 0 ? [{ label: "Reserve", count: deck.reserveCount, cards: deck.reserve }] : []),
  ];
  // Flat order for prev/next in the enlarge modal; `starts[i]` is the flat
  // index of section i's first card.
  const all: DeckEmbedCard[] = sections.flatMap((s) => s.cards);
  const starts = sections.reduce<number[]>(
    (acc, s, i) => [...acc, (acc[i - 1] ?? 0) + (sections[i - 1]?.cards.length ?? 0)],
    [],
  );
  const [index, setIndex] = useState<number | null>(null);
  const current = index !== null ? all[index] : null;
  const currentSrc = current ? getCardImageUrl(current.imgFile ?? "") : "";

  const meta = [
    deck.format,
    `${deck.cardCount} cards${deck.reserveCount > 0 ? ` + ${deck.reserveCount} reserve` : ""}`,
    deck.username ? `by ${deck.username}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <figure className="article-embed not-prose my-6 rounded-lg border border-border bg-card p-3 sm:p-4">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className={KICKER}>{meta}</p>
          <a href={href} className="text-lg font-semibold leading-tight text-foreground hover:text-primary">
            {deck.name}
          </a>
        </div>
        <a
          href={href}
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Open deck
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
      </figcaption>

      <div className="space-y-3">
        {sections.map((s, i) => (
          <section key={s.label} aria-label={s.label}>
            <h4 className={`${KICKER} mb-1.5`}>
              {s.label} <span className="text-muted-foreground/70">· {s.count}</span>
            </h4>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
              {s.cards.map((c, j) => (
                <CardTile
                  key={`${c.name}|${c.set ?? ""}|${j}`}
                  compact
                  card={{
                    card_name: c.name,
                    card_set: c.set ?? undefined,
                    card_img_file: c.imgFile,
                    quantity: c.quantity,
                    type: c.type,
                  }}
                  onClick={() => setIndex(starts[i] + j)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {current &&
        index !== null &&
        // Portaled to <body> so the article's prose styles and any transformed
        // ancestor can't affect the full-screen overlay.
        createPortal(
          <CardEnlargeModal
            onClose={() => setIndex(null)}
            name={current.name}
            qty={current.quantity}
            subtitle={current.set ?? undefined}
            nav={{
              index,
              total: all.length,
              onNavigate: (delta) => setIndex((i) => (i === null ? null : (i + delta + all.length) % all.length)),
            }}
          >
            {currentSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentSrc}
                alt={current.name}
                className="mx-auto w-full rounded-lg object-contain"
                style={{ aspectRatio: "2.5 / 3.5" }}
              />
            ) : (
              <div className="flex aspect-[2.5/3.5] w-full items-center justify-center rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">
                {current.name}
              </div>
            )}
          </CardEnlargeModal>,
          document.body,
        )}
    </figure>
  );
}
