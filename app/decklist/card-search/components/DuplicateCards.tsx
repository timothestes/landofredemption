'use client';

import React from 'react';
import type { DuplicateSibling } from '@/lib/duplicateCards';
import type { Card } from '../utils';
import { isBannedInFormat, PARAGON_EXCLUDED_SETS, type FormatId } from '@/lib/formats';

interface DuplicateCardsProps {
  siblings: DuplicateSibling[];
  /** All cards available for navigation (to check if a sibling is navigable) */
  visibleCards?: Card[];
  /** Called when user clicks a navigable sibling */
  onNavigate?: (card: Card) => void;
  /** Current legality mode — siblings not matching this are dimmed. null = show all */
  legalityFilter?: string | null;
  /** Format the deck is being built in — decides what "Banned" means */
  legalityFormat?: FormatId;
  /** Full card list (unfiltered) for legality checking */
  allCards?: Card[];
  /** Callback for hover preview on desktop */
  onHoverSibling?: (sibling: { name: string; imgFile: string } | null, x: number, y: number) => void;
}

/**
 * Check if a card passes a legality filter.
 * Mirrors the logic in client.tsx lines 795-842.
 */
export function passesLegalityFilter(card: Card, mode: string, format: FormatId): boolean {
  if (mode === 'Unlimited') return true;
  // Per-format since DBR 2.0 — see isBannedInFormat.
  if (mode === 'Limited') return card.legality === 'Rotation' && !isBannedInFormat(card, format);
  if (mode === 'Banned') return isBannedInFormat(card, format);
  if (mode === 'Scrolls') return card.legality !== 'Rotation' && card.legality !== 'Banned';
  if (mode === 'Paragon') {
    if (card.type.toLowerCase().includes('lost soul')) return false;
    return !PARAGON_EXCLUDED_SETS.has(card.officialSet);
  }
  return false;
}

/** Normalize for matching: lowercase, strip commas before "the", normalize quotes */
function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'']/g, "'")
    .replace(/,\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip set/print suffixes from card names */
function stripSuffix(name: string): string {
  let s = name.replace(/\s*\[[^\]]+\]\s*$/, "");
  const m = s.match(/\s+\(([A-Za-z0-9][A-Za-z0-9 .''\-]*)\)\s*$/);
  if (m && m[1].length <= 30) s = s.slice(0, m.index).trim();
  return s;
}

/**
 * Build a normalized lookup index from a card array.
 * Maps normalized base name → Card[] (all printings with that base name).
 * Built once per card pool via useMemo, then sibling lookups are O(1).
 */
function buildCardIndex(cards: Card[]): Map<string, Card[]> {
  const index = new Map<string, Card[]>();

  function add(key: string, card: Card) {
    const existing = index.get(key);
    if (existing) existing.push(card);
    else index.set(key, [card]);
  }

  for (const c of cards) {
    // Index by full name normalized
    add(normForMatch(c.name), c);

    // Index by base name (stripped set suffix)
    const base = normForMatch(stripSuffix(c.name));
    if (base !== normForMatch(c.name)) {
      add(base, c);
    }

    // Index each half of slash names: "A / B (Set)" and "A/B"
    const stripped = stripSuffix(c.name);
    if (stripped.includes("/")) {
      // Handle both "A / B" (with spaces) and "A/B" (no spaces)
      const parts = stripped.split(/\s*\/\s*/);
      for (const part of parts) {
        if (part.length > 1) {
          add(normForMatch(part), c);
        }
      }
    }
  }

  return index;
}

/** Look up cards by sibling name from a pre-built index. O(1). */
function lookupCards(sibName: string, index: Map<string, Card[]>): Card[] {
  return index.get(normForMatch(sibName)) || [];
}

export function DuplicateCards({
  siblings,
  visibleCards,
  onNavigate,
  legalityFilter,
  legalityFormat = 'Limited',
  allCards,
  onHoverSibling,
}: DuplicateCardsProps) {
  // Build lookup indices once per card pool change (not per sibling)
  const allCardsIndex = React.useMemo(
    () => buildCardIndex(allCards || visibleCards || []),
    [allCards, visibleCards]
  );
  const visibleCardsIndex = React.useMemo(
    () => (visibleCards ? buildCardIndex(visibleCards) : null),
    [visibleCards]
  );

  // For each sibling, determine if it's navigable and if it passes legality
  const enrichedSiblings = React.useMemo(() => {
    return siblings.map((sib) => {
      // O(1) lookup for all matching printings
      const matchedCards = lookupCards(sib.cardName, allCardsIndex);
      const matchedCard = matchedCards[0] || null;

      // Check legality: passes if ANY printing passes the filter
      let passesLegality = true;
      if (legalityFilter && matchedCards.length > 0) {
        passesLegality = matchedCards.some((c) =>
          passesLegalityFilter(c, legalityFilter, legalityFormat)
        );
      }
      if (legalityFilter && matchedCards.length === 0) {
        passesLegality = false;
      }

      // Navigable: prefer match in visibleCards, fall back to allCards
      const navigableCard =
        (visibleCardsIndex
          ? lookupCards(sib.cardName, visibleCardsIndex)[0]
          : null) || matchedCard;

      return {
        ...sib,
        matchedCard,
        navigableCard: navigableCard || null,
        passesLegality,
      };
    });
  }, [siblings, allCardsIndex, visibleCardsIndex, legalityFilter, legalityFormat]);

  // Filter out siblings that don't pass legality when a filter is active
  const displaySiblings = legalityFilter
    ? enrichedSiblings.filter((s) => s.passesLegality)
    : enrichedSiblings;

  const [expanded, setExpanded] = React.useState(false);

  if (displaySiblings.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5 hover:text-primary transition-colors"
      >
        <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        Also Known As
        <span className="text-xs font-normal text-muted-foreground">({displaySiblings.length})</span>
        <svg className={`w-3.5 h-3.5 text-muted-foreground ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <div className={`space-y-0 ${expanded ? '' : 'hidden'}`}>
        {displaySiblings.map((sib, i) => {
          const isNavigable = !!sib.navigableCard && !!onNavigate;
          const isDimmed = !sib.passesLegality;

          return (
            <div
              key={`${sib.cardName}-${i}`}
              className={`py-1.5 ${i < displaySiblings.length - 1 ? 'border-b border-border/40' : ''}`}
            >
              <button
                type="button"
                disabled={!isNavigable}
                onClick={() => {
                  if (isNavigable && sib.navigableCard) {
                    onNavigate!(sib.navigableCard);
                  }
                }}
                onMouseEnter={(e) => {
                  if (onHoverSibling && sib.matchedCard) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    onHoverSibling(
                      { name: sib.matchedCard.name, imgFile: sib.matchedCard.imgFile },
                      rect.left,
                      rect.top,
                    );
                  }
                }}
                onMouseLeave={() => onHoverSibling?.(null, 0, 0)}
                className={`w-full text-left group ${
                  isNavigable
                    ? 'cursor-pointer hover:text-primary transition-colors'
                    : 'cursor-default'
                } ${isDimmed ? 'opacity-40' : ''}`}
              >
                <span className="text-sm text-foreground flex items-center justify-between">
                  <span>{sib.cardName}</span>
                  {isNavigable && (
                    <svg className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  )}
                </span>
                {sib.ordirSets && (
                  <span className="text-xs text-muted-foreground">
                    {sib.ordirSets.split(',').map(s => s.trim()).join(' · ')}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Mobile-specific duplicate cards list for bottom sheets.
 * Larger touch targets, chevron indicators for navigable items.
 */
export function DuplicateCardsMobile({
  siblings,
  visibleCards,
  onNavigate,
  allCards,
}: Omit<DuplicateCardsProps, 'onHoverSibling' | 'legalityFilter'>) {
  const allCardsIndex = React.useMemo(
    () => buildCardIndex(allCards || visibleCards || []),
    [allCards, visibleCards]
  );
  const visibleCardsIndex = React.useMemo(
    () => (visibleCards ? buildCardIndex(visibleCards) : null),
    [visibleCards]
  );

  const enrichedSiblings = React.useMemo(() => {
    return siblings.map((sib) => {
      const matchedCard = lookupCards(sib.cardName, allCardsIndex)[0] || null;
      const navigableCard =
        (visibleCardsIndex
          ? lookupCards(sib.cardName, visibleCardsIndex)[0]
          : null) || matchedCard;
      return { ...sib, navigableCard: navigableCard || null };
    });
  }, [siblings, allCardsIndex, visibleCardsIndex]);

  return (
    <div className="space-y-0">
      {enrichedSiblings.map((sib, i) => {
        const isNavigable = !!sib.navigableCard && !!onNavigate;
        return (
          <button
            key={`${sib.cardName}-${i}`}
            type="button"
            disabled={!isNavigable}
            onClick={() => {
              if (isNavigable && sib.navigableCard) {
                onNavigate!(sib.navigableCard);
              }
            }}
            className={`w-full text-left px-4 py-3 flex items-center justify-between ${
              i < enrichedSiblings.length - 1 ? 'border-b border-border/40' : ''
            } ${isNavigable ? 'active:bg-muted/50' : 'opacity-50'}`}
          >
            <div>
              <div className="text-sm text-foreground">{sib.cardName}</div>
              {sib.ordirSets && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {sib.ordirSets.split(',').map(s => s.trim()).join(' · ')}
                </div>
              )}
            </div>
            {isNavigable && (
              <svg className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
