"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Card } from "./utils";
import { ALL_CARDS } from "./data/cardIndex";
import { getPublicImageUrl } from "./hooks/useCardImageUrl";
import CardImage from "./components/CardImage";
// Type-only — keeps this module free of any server-action runtime import, so it
// stays safe to import from leaf components and node tests.
import type { saveDeckAction, loadDeckByIdAction } from "../actions";

/**
 * What a card's art resolves to.
 * - Public cards are a plain image URL — the call site keeps its own bespoke
 *   `<img>`/`<CardImage>` markup and just uses this `url`.
 * - Forge cards have no single URL (they're a composite preview), so they
 *   resolve to an opaque element the call site renders verbatim. This is what
 *   keeps secret Forge art off `next/image` and away from a 404'ing `<img src>`.
 */
export type CardImageResolution =
  | { kind: "url"; url: string }
  | { kind: "element"; node: ReactNode };

/** Options for `renderThumb`, mirroring today's `<CardImage>` props exactly. */
export interface RenderThumbOpts {
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  onClick?: () => void;
}

/** Minimal deck summary the Load Deck modal renders. `DeckData` (public) and
 *  the Forge's mapped `ForgeDeckSummary` both satisfy it. */
export type DeckListItem = {
  id: string;
  name: string;
  format?: string;
  card_count?: number;
  updated_at?: string;
};

/**
 * Where the builder loads/saves decks. The public default (the `decks` table via
 * `saveDeckAction`/`loadDeckByIdAction`) lives in `useDeckState` so this module
 * stays runtime-free of server actions; only the Forge injects an override
 * (backed by `forge_decks`). The signatures are pinned to the public actions so
 * any override must return a shape `useDeckState` already understands.
 */
export interface DeckBuilderPersistence {
  save: typeof saveDeckAction;
  loadById: typeof loadDeckByIdAction;
  /** Resolve a loaded db card row to a full `Card` before the public-catalog
   *  lookup runs. The Forge maps `forge:<id>` rows back to the granted pool so
   *  reloaded forge cards keep their type/brigade/alignment (otherwise they
   *  degrade to `type: "Unknown"` and validation miscounts them). Return null
   *  to fall through to the default catalog lookup. */
  resolveCard?: (dbCard: {
    card_name: string;
    card_set: string;
    card_img_file?: string | null;
  }) => Card | null;
  /** List the caller's decks for the Load Deck modal. Omitted → the modal uses
   *  the public default (`loadUserDecksAction` over the `decks` table). With a
   *  custom persistence, Load Deck stays hidden unless this is provided (the
   *  Forge lists `forge_decks`). */
  listDecks?: () => Promise<DeckListItem[]>;
  /** Delete the deck from this backend. Omitted → the builder uses the public
   *  default (`deleteDeckAction` over the `decks` table). The Forge deletes from
   *  `forge_decks`; on success the builder fires `onDeckDeleted`. */
  delete?: (deckId: string) => Promise<{ success: boolean; error?: string }>;
}

/** Feature toggles. Public has everything on; the Forge hard-disables several.
 *  All gates treat `=== false` as off, so an omitted flag stays public-default-on. */
export interface DeckBuilderFeatures {
  /** Persist the working deck to localStorage. On for public drafts; off for the
   *  Forge (its decks are RLS-scoped, and a shared key would bleed a public draft in). */
  localStoragePersist?: boolean;
  /** Mirror filter/deck state into the `/decklist/card-search` URL. Off for the
   *  Forge — those `router.replace`s would navigate the user off the Forge route. */
  syncFiltersToUrl?: boolean;
  /** Share/visibility + duplicate controls (write to the public `decks` table /
   *  create public links). Off for the Forge — secret content must never go public. */
  enableSharing?: boolean;
  /** Delete control (the "Delete Deck" menu item). Uses `persistence.delete` when
   *  provided (the Forge deletes from `forge_decks`), else the public
   *  `deleteDeckAction` over the `decks` table. */
  enableDeckDelete?: boolean;
  /** Deck text import/export (menu items, Ctrl+I/E, empty-state import button).
   *  On for the Forge too: forge cards sit in the pool under their real names,
   *  so exported lists round-trip (import re-resolves them to `forge:<id>`
   *  pool entries). Exports do put forge card names in plain text — accepted. */
  enableImportExport?: boolean;
  /** Deck-from-photo entry links (/decklist/scan). Off for the Forge — the
   *  photo page reads the public catalog and opens a public deck. */
  enablePhotoImport?: boolean;
  /** PDF + deck-image generation (external service builds from public image
   *  URLs). Off for the Forge — forge cards have no public URL and render blank. */
  enablePrintExports?: boolean;
  /** Buy-on-YTG + collection check + price buttons. Off for the Forge — the
   *  shop/collection have no notion of forge cards, so results mislead. */
  enableShopping?: boolean;
  /** The Details tab (cover cards / tags / description). Off for the Forge —
   *  `forge_decks` has no columns for these, so edits would silently vanish. */
  enableDetailsTab?: boolean;
  /** Live server deckcheck (`/api/deckcheck`). Off for the Forge — the checker
   *  can't know forge cards and flags each one as not-found; the client-side
   *  validateDeck covers structural rules. */
  serverDeckCheck?: boolean;
  /** Client-side legality checks (validateDeck badge/checklist + the "Ignore
   *  Legality Checks" toggle). Off for the Forge — playtest decks are
   *  work-in-progress by nature, so legality noise is unwanted. */
  enableLegalityChecks?: boolean;
}

/**
 * Injection seams that let one builder serve both the public site and the Forge.
 * - `pool` (Phase 0): the card catalog the builder searches/renders.
 * - `resolveCardImage` / `renderThumb` (Phase 1): the card-image seam. Bespoke
 *   `<img>` sites switch on `resolveCardImage(card).kind`; the ~2 sites that use
 *   the `<CardImage>` component use `renderThumb`. Public always resolves to a
 *   URL; the Forge config (Phase 3) returns an element for forge dataLines.
 *
 * See docs/superpowers/plans/2026-06-26-forge-deckbuilder-unification.md
 */
export interface DeckBuilderConfig {
  /** Card pool the builder searches and renders. Public: ALL_CARDS. Forge: [...forgeCards, ...ALL_CARDS]. */
  pool: Card[];
  /** Resolve a card's art to a URL (public) or an opaque composite element (Forge). */
  resolveCardImage: (card: Card) => CardImageResolution;
  /** Convenience renderer for sites that use the `<CardImage>` component (search grid, spotlight). */
  renderThumb: (card: Card, opts: RenderThumbOpts) => ReactNode;
  /** Deck load/save backend. Omit to use the public default (the `decks` table). */
  persistence?: DeckBuilderPersistence;
  /** Feature toggles. Omit for all-public-defaults. */
  features?: DeckBuilderFeatures;
  /** Replacement share modal. When provided, the builder shows its Share
   *  controls even with `enableSharing` off and renders this instead of the
   *  public ShareDeckModal (which writes public visibility — never for the
   *  Forge). The Forge supplies its member-only share here. */
  renderShareModal?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    deckId: string;
    deckName?: string;
  }) => ReactNode;
  /** Called after the Load Deck modal successfully loads a deck in place. The
   *  Forge rewrites /forge/play/decks/<id> via history.replaceState (its deck
   *  id lives in the URL; the public builder's does not). */
  onDeckLoaded?: (deckId: string) => void;
  /** Called after `persistence.delete` succeeds. The Forge navigates back to its
   *  deck list (the builder route no longer points at a live deck). */
  onDeckDeleted?: (deckId: string) => void;
}

/** Public default: the builder behaves exactly as it does today. */
export const PUBLIC_BUILDER_CONFIG: DeckBuilderConfig = {
  pool: ALL_CARDS,
  resolveCardImage: (card) => ({ kind: "url", url: getPublicImageUrl(card.imgFile) }),
  renderThumb: (card, opts) => {
    // Guard so the next/image path is structurally unreachable for an `element`
    // resolution (no-op for the public config, which is always `url`).
    const r = PUBLIC_BUILDER_CONFIG.resolveCardImage(card);
    if (r.kind === "element") return r.node;
    return (
      <CardImage
        imgFile={card.imgFile}
        alt={opts.alt}
        className={opts.className}
        sizes={opts.sizes}
        priority={opts.priority}
        onClick={opts.onClick}
      />
    );
  },
  // persistence omitted → useDeckState uses the public `decks`-table default.
  features: {
    localStoragePersist: true,
    syncFiltersToUrl: true,
    enableSharing: true,
    enableDeckDelete: true,
    enableImportExport: true,
    enablePhotoImport: true,
    enablePrintExports: true,
    enableShopping: true,
    enableDetailsTab: true,
    serverDeckCheck: true,
    enableLegalityChecks: true,
  },
};

const BuilderConfigContext = createContext<DeckBuilderConfig>(PUBLIC_BUILDER_CONFIG);

/** Provide a `DeckBuilderConfig` to the builder subtree. Leaves read it via `useBuilderConfig()`. */
export function BuilderConfigProvider({
  config,
  children,
}: {
  config: DeckBuilderConfig;
  children: ReactNode;
}) {
  return <BuilderConfigContext.Provider value={config}>{children}</BuilderConfigContext.Provider>;
}

/** Read the active builder config. Defaults to the public config when no provider is mounted. */
export function useBuilderConfig(): DeckBuilderConfig {
  return useContext(BuilderConfigContext);
}
