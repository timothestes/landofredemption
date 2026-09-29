"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ALL_CARDS } from "../data/cardIndex";
import { CardThumb } from "../components/CardThumb";
import { useHoverPreview } from "../hooks/useHoverPreview";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { Card } from "../utils";
import {
  POOL_ID,
  addTier,
  addToPool,
  clearCards,
  createDefaultState,
  decodeShare,
  encodeShare,
  findContainer,
  fromSerializable,
  moveCard,
  removeCard,
  removeTier,
  renameTier,
  toSerializable,
  totalPlaced,
  type CardKey,
  type TierListState,
} from "@/lib/tierlist/state";

const STORAGE_KEY = "tier-list-maker";
const MAX_RESULTS = 30;
const MAX_TIERS = 12;

/**
 * Pointer-first collision detection.
 *
 * `closestCorners`/`closestCenter` compare corner distances, which a full-width
 * tier row always loses to the small card tiles sitting inside it — so a drop on
 * empty row space would resolve to whichever card happened to be nearest and land
 * the card in *that* card's row. Asking "which droppables contain the pointer?"
 * instead returns the row for empty space and the hovered tile when there is one,
 * which is exactly the two cases the drag handlers distinguish. `rectIntersection`
 * is the fallback for keyboard dragging, which has no pointer coordinates —
 * `closestCorners` rather than `rectIntersection` because a keyboard-lifted card
 * moves in fixed steps and may overlap nothing at all, which would leave the
 * arrow keys doing nothing.
 */
const collisionDetection: CollisionDetection = (args) => {
  const withinPointer = pointerWithin(args);
  return withinPointer.length > 0 ? withinPointer : closestCorners(args);
};

/** `name|set` -> card. First print wins, matching how the share keys are built. */
const CARD_BY_KEY: ReadonlyMap<CardKey, Card> = (() => {
  const map = new Map<CardKey, Card>();
  for (const c of ALL_CARDS) {
    const key = `${c.name}|${c.set}`;
    if (!map.has(key)) map.set(key, c);
  }
  return map;
})();

/** Matches the deck builder's search normalization so curly apostrophes hit. */
const norm = (s: string) => s.toLowerCase().replace(/[‘’‛′`]/g, "'");

function searchCards(query: string): Card[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const hits: Card[] = [];
  for (const card of ALL_CARDS) {
    const key = `${card.name}|${card.set}`;
    if (seen.has(key)) continue;
    if (!norm(card.name).includes(q)) continue;
    seen.add(key);
    hits.push(card);
  }
  hits.sort((a, b) => {
    // Prefix matches first — typing "angel" should surface "Angel of the Lord"
    // ahead of "Fallen Angel".
    const ap = norm(a.name).startsWith(q) ? 0 : 1;
    const bp = norm(b.name).startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name) || a.set.localeCompare(b.set);
  });
  return hits.slice(0, MAX_RESULTS);
}

/* ------------------------------------------------------------------ */
/*  Card tile                                                          */
/* ------------------------------------------------------------------ */

interface TileProps {
  cardKey: CardKey;
  card: Card;
  selected: boolean;
  onSelect: (key: CardKey) => void;
  onRemove: (key: CardKey) => void;
  hoverProps: (card: Card) => Record<string, unknown>;
}

function CardTile({ cardKey, card, selected, onSelect, onRemove, hoverProps }: TileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardKey,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative w-[64px] shrink-0 sm:w-[84px] ${isDragging ? "opacity-30" : ""}`}
      {...hoverProps(card)}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(cardKey);
        }}
        aria-label={`${card.name} (${card.set})`}
        className={`block w-full cursor-grab touch-none overflow-hidden rounded-sm border transition active:cursor-grabbing ${
          selected ? "border-primary ring-2 ring-primary" : "border-transparent hover:border-muted-foreground/60"
        }`}
      >
        <CardThumb
          card={card}
          alt={card.name}
          draggable={false}
          className="block w-full"
          style={{ aspectRatio: "2.5 / 3.5", objectFit: "cover" }}
        />
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(cardKey);
        }}
        aria-label={`Remove ${card.name}`}
        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-xs leading-none text-muted-foreground opacity-100 shadow-sm transition hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Droppable row                                                      */
/* ------------------------------------------------------------------ */

function DropArea({
  id,
  items,
  children,
  onPlace,
  emptyHint,
}: {
  id: string;
  items: CardKey[];
  children: React.ReactNode;
  onPlace: (rowId: string) => void;
  emptyHint: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        onClick={() => onPlace(id)}
        className={`flex min-h-[108px] flex-1 flex-wrap content-start gap-2 p-2 transition-colors sm:min-h-[136px] ${
          isOver ? "bg-primary/10" : ""
        }`}
      >
        {items.length === 0 && emptyHint ? (
          <span className="self-center px-1 text-xs text-muted-foreground">{emptyHint}</span>
        ) : (
          children
        )}
      </div>
    </SortableContext>
  );
}

/* ------------------------------------------------------------------ */
/*  Export modal                                                       */
/* ------------------------------------------------------------------ */

function ExportModal({
  state,
  title,
  onClose,
}: {
  state: TierListState;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/generate-tierlist-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || null,
            rows: state.tiers.map((t) => ({
              label: t.label,
              color: t.color,
              cards: (state.placements[t.id] ?? []).map((k) => {
                const [name, set] = k.split("|");
                return { name, set };
              }),
            })),
          }),
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.data?.downloadUrl) {
          setError(body?.message ?? "Could not generate the image.");
        } else {
          setUrl(body.data.downloadUrl);
        }
      } catch {
        if (!cancelled) setError("Could not reach the image service.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, title]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Tier list image</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {loading && <p className="py-8 text-center text-sm text-muted-foreground">Rendering your tier list…</p>}
        {error && <p className="py-8 text-center text-sm text-destructive">{error}</p>}
        {url && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Generated tier list" className="w-full rounded border border-border" />
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 items-center rounded border border-border bg-muted px-4 text-sm font-medium text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              >
                Open full size
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                className="flex h-9 items-center rounded border border-border bg-muted px-4 text-sm font-medium text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              >
                {copied ? "Link copied" : "Copy image link"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Long-press or right-click the image to save it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TierListClient() {
  const searchParams = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { hoverProps, clear: clearHover, overlay } = useHoverPreview(isDesktop);

  const [state, setState] = React.useState<TierListState>(createDefaultState);
  const [title, setTitle] = React.useState("");
  const [hydrated, setHydrated] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<CardKey | null>(null);
  const [dragging, setDragging] = React.useState<CardKey | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Hydrate from the share link first, then the local draft.
  React.useEffect(() => {
    const shared = searchParams.get("t");
    if (shared) {
      const decoded = decodeShare(shared);
      if (decoded) {
        setState(decoded);
        setTitle(searchParams.get("n") ?? "");
        // Drop the params so later edits aren't shadowed by a stale link.
        window.history.replaceState(null, "", window.location.pathname);
        setHydrated(true);
        return;
      }
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const restored = fromSerializable(parsed.state);
        if (restored) {
          setState(restored);
          setTitle(typeof parsed.title === "string" ? parsed.title : "");
        }
      }
    } catch {
      /* a corrupt draft just starts a fresh board */
    }
    setHydrated(true);
    // Reading the initial params once is deliberate — later edits rewrite the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: toSerializable(state), title }));
    } catch {
      /* private mode / quota — the board still works, it just won't persist */
    }
  }, [state, title, hydrated]);

  const results = React.useMemo(() => searchCards(query), [query]);
  const placedCount = totalPlaced(state);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // A short hold before a drag takes over keeps the page scrollable on touch.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (s: TierListState, id: string): string | null =>
    id in s.placements ? id : findContainer(s, id);

  /** Where in `overRow` a drop on `over` should land, given the pointer's side. */
  const dropIndex = (
    s: TierListState,
    overRow: string,
    overId: string,
    activeLeft: number | null,
    overLeft: number | null,
    overWidth: number | null,
  ): number | undefined => {
    if (overId === overRow) return undefined; // dropped on the row itself -> append
    const items = s.placements[overRow] ?? [];
    const idx = items.indexOf(overId);
    if (idx < 0) return undefined;
    const after =
      activeLeft !== null && overLeft !== null && overWidth !== null
        ? activeLeft > overLeft + overWidth / 2
        : false;
    return idx + (after ? 1 : 0);
  };

  const handleDragStart = (e: DragStartEvent) => {
    clearHover();
    // Drop any tap-selection: the click that ends this drag would otherwise
    // land on a row and place the previously selected card too.
    setSelected(null);
    setDragging(String(e.active.id));
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeRect = active.rect.current.translated;

    setState((s) => {
      const from = containerOf(s, activeId);
      const to = containerOf(s, overId);
      if (!from || !to || from === to) return s;
      const at = dropIndex(
        s,
        to,
        overId,
        activeRect ? activeRect.left + activeRect.width / 2 : null,
        over.rect.left,
        over.rect.width,
      );
      return moveCard(s, activeId, to, at);
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setDragging(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeRect = active.rect.current.translated;

    setState((s) => {
      const to = containerOf(s, overId);
      if (!to) return s;
      const at = dropIndex(
        s,
        to,
        overId,
        activeRect ? activeRect.left + activeRect.width / 2 : null,
        over.rect.left,
        over.rect.width,
      );
      return moveCard(s, activeId, to, at);
    });
  };

  /** Tap-to-place: with a card selected, tapping a row moves it there. */
  const placeSelected = (rowId: string) => {
    if (!selected) return;
    setState((s) => moveCard(s, selected, rowId, undefined));
    setSelected(null);
  };

  const toggleSelect = (key: CardKey) => setSelected((cur) => (cur === key ? null : key));

  const handleShare = () => {
    const params = new URLSearchParams({ t: encodeShare(state) });
    if (title.trim()) params.set("n", title.trim());
    navigator.clipboard
      .writeText(`${window.location.origin}${window.location.pathname}?${params}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  const renderTiles = (keys: CardKey[]) =>
    keys.map((key) => {
      const card = CARD_BY_KEY.get(key);
      if (!card) return null; // a card dropped from the catalog since the link was made
      return (
        <CardTile
          key={key}
          cardKey={key}
          card={card}
          selected={selected === key}
          onSelect={toggleSelect}
          onRemove={(k) => setState((s) => removeCard(s, k))}
          hoverProps={hoverProps}
        />
      );
    });

  // Fingers need the 44px target, mice don't — so the taller size is the mobile one.
  const btn =
    "flex h-11 items-center rounded border border-border bg-muted px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted/80 sm:h-9 sm:px-4";

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="font-cinzel text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Tier List Maker</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            disabled={placedCount === 0}
            onClick={handleShare}
            title="Copy a link to this tier list"
          >
            {copied ? "Link copied" : "Share"}
          </button>
          <button
            type="button"
            className={`${btn} hover:border-destructive/40 hover:text-destructive`}
            onClick={() => {
              if (placedCount === 0 || window.confirm("Clear every card from the board?")) {
                setState((s) => clearCards(s));
                setSelected(null);
              }
            }}
          >
            Clear
          </button>
          <button
            type="button"
            disabled={placedCount === 0}
            onClick={() => setExporting(true)}
            className="flex h-11 items-center rounded bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:px-4"
          >
            Export image
          </button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={48}
        placeholder="Untitled tier list"
        aria-label="Tier list title"
        className="mb-3 w-full rounded border border-transparent bg-transparent px-3 py-2 text-xl font-semibold text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border focus:border-border focus:bg-card sm:text-2xl"
      />

      <div className="relative mb-4">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="m13 13 4 4" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a card to add…"
          aria-label="Search cards"
          className="w-full rounded border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded border border-border bg-card shadow-lg">
            {results.map((card) => {
              const key = `${card.name}|${card.set}`;
              const already = findContainer(state, key) !== null;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    setState((s) => addToPool(s, key));
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <CardThumb
                    card={card}
                    alt=""
                    className="h-10 w-[28px] shrink-0 rounded-sm object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{card.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {already ? "on board" : card.officialSet || card.set}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        Drag cards between rows, or tap a card and then tap the row you want it in.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        // Rows resize as cards move between them mid-drag; without continuous
        // measuring the cached rects go stale and drops land a row off.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Unranked
          </h2>
          <div className="rounded-lg border border-dashed border-border">
            <DropArea
              id={POOL_ID}
              items={state.placements[POOL_ID] ?? []}
              onPlace={placeSelected}
              emptyHint="Cards you add land here first"
            >
              {renderTiles(state.placements[POOL_ID] ?? [])}
            </DropArea>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          {state.tiers.map((tier) => (
            <div key={tier.id} className="group flex border-b border-border last:border-b-0">
              <div
                className="flex w-16 shrink-0 items-center justify-center p-1 sm:w-24"
                style={{ backgroundColor: tier.color }}
              >
                {/* A textarea, not an input, so a custom label like "Never Playable"
                    wraps in the narrow header the way it does in the export instead
                    of clipping mid-word. Enter is swallowed — labels stay one line
                    of text, the wrapping is purely visual. */}
                <textarea
                  value={tier.label}
                  onChange={(e) =>
                    setState((s) => renameTier(s, tier.id, e.target.value.replace(/\n/g, "").slice(0, 24)))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  rows={2}
                  maxLength={24}
                  aria-label="Tier label"
                  // border-0/p-0 override the app-wide textarea style (1px border +
                  // 12px padding), which would otherwise box the label and leave
                  // too little width for a two-word tier name to wrap cleanly.
                  className={`w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 text-center font-bold leading-tight text-[#14161f] outline-none transition-colors placeholder:text-[#14161f]/40 hover:bg-black/10 focus:bg-black/15 ${
                    tier.label.trim().length <= 2
                      ? "text-lg sm:text-2xl"
                      : tier.label.trim().length <= 8
                        ? "text-xs sm:text-base"
                        : "text-[10px] sm:text-xs"
                  }`}
                  placeholder="?"
                />
              </div>
              <DropArea
                id={tier.id}
                items={state.placements[tier.id] ?? []}
                onPlace={placeSelected}
                emptyHint={selected ? "Tap here to place the selected card" : ""}
              >
                {renderTiles(state.placements[tier.id] ?? [])}
              </DropArea>
              <button
                type="button"
                onClick={() => setState((s) => removeTier(s, tier.id))}
                disabled={state.tiers.length <= 1}
                aria-label={`Remove tier ${tier.label || "(unnamed)"}`}
                title="Remove this row"
                className="w-9 shrink-0 border-l border-border text-muted-foreground/70 transition hover:bg-muted hover:text-foreground disabled:opacity-30 sm:opacity-0 sm:group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setState((s) => addTier(s))}
          disabled={state.tiers.length >= MAX_TIERS}
          className="mt-2 rounded border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:border-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          + Add row
        </button>

        <DragOverlay>
          {dragging && CARD_BY_KEY.get(dragging) ? (
            <div className="w-[64px] sm:w-[84px]">
              <CardThumb
                card={CARD_BY_KEY.get(dragging)!}
                alt=""
                className="block w-full rounded-sm shadow-2xl"
                style={{ aspectRatio: "2.5 / 3.5", objectFit: "cover" }}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {overlay}
      {exporting && <ExportModal state={state} title={title} onClose={() => setExporting(false)} />}
    </div>
  );
}
