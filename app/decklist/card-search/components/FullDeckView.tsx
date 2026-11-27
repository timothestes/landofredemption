import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Deck } from "../types/deck";
import { Card } from "../utils";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import { CardThumb } from "./CardThumb";
import { validateDeck } from "../utils/deckValidation";
import { loadGlobalTagsAction, updateDeckTagsAction, GlobalTag } from "../../actions";
import { createGlobalTagAction } from "../../../admin/tags/actions";
import { HexColorPicker } from "react-colorful";
import { useIsAdmin } from "../../../../hooks/useIsAdmin";
import { useCardPrices } from "../hooks/useCardPrices";
import { compareCardsByType, compareTypeGroups } from "@/lib/cards/defaultSort";
import { groupDeckCardsBySet, sortDeckCardsBySet } from "../utils/setGroups";

function getTagContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
}

interface FullDeckViewProps {
  deck: Deck;
  onViewCard?: (card: Card, fromReserve?: boolean) => void;
  isAuthenticated?: boolean;
  viewMode: 'normal' | 'stacked';
  groupBy: 'none' | 'alignment' | 'type' | 'set';
  showPreview?: boolean;
  tagsBarContainer?: HTMLElement | null;
}

/**
 * Full-screen optimized deck view with compact card display
 * Shows entire deck at a glance with minimal scrolling
 */
export default function FullDeckView({ deck, onViewCard, isAuthenticated = false, viewMode, groupBy, showPreview = true, tagsBarContainer }: FullDeckViewProps) {
  const { getImageUrl } = useCardImageUrl();
  const { isAdmin, permissions } = useIsAdmin();
  const { getPrice } = useCardPrices();
  const canManageTags = isAdmin && permissions.includes('manage_tags');

  // Hover preview state (desktop only)
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);

  // Tags state
  const [deckTags, setDeckTags] = useState<GlobalTag[]>([]);
  const [allGlobalTags, setAllGlobalTags] = useState<GlobalTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#6366f1");
  const [createColorOpen, setCreateColorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAllTags = useCallback(async () => {
    setTagsLoading(true);
    const res = await loadGlobalTagsAction();
    if (res.success) setAllGlobalTags(res.tags);
    setTagsLoading(false);
  }, []);

  // Load global tags list when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    loadAllTags();
  }, [isAuthenticated, loadAllTags]);

  // Retry loading tags when the picker opens and the list is empty (handles race/failure)
  useEffect(() => {
    if (tagPickerOpen && isAuthenticated && allGlobalTags.length === 0 && !tagsLoading) {
      loadAllTags();
    }
  }, [tagPickerOpen, isAuthenticated, allGlobalTags.length, tagsLoading, loadAllTags]);

  // Load this deck's current tags when the deck ID changes
  useEffect(() => {
    if (!deck.id || !isAuthenticated) { setDeckTags([]); return; }
    import("../../../../utils/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase
        .from("deck_tags")
        .select("tag_id, global_tags(id, name, color)")
        .eq("deck_id", deck.id!)
        .then(({ data }) => {
          const tags = (data || []).map((r: any) => r.global_tags).filter(Boolean);
          setDeckTags(tags);
        });
    });
  }, [deck.id, isAuthenticated]);

  // Close tag picker on outside click
  useEffect(() => {
    if (!tagPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
        setTagFilter("");
        setCreateMode(false);
        setCreateError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagPickerOpen]);

  const toggleTag = useCallback(async (tag: GlobalTag) => {
    if (!deck.id) return;
    const isSelected = deckTags.some((t) => t.id === tag.id);
    const next = isSelected ? deckTags.filter((t) => t.id !== tag.id) : [...deckTags, tag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
  }, [deckTags, deck.id]);

  const filteredGlobalTags = allGlobalTags.filter((t) =>
    t.name.toLowerCase().includes(tagFilter.toLowerCase())
  );

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !deck.id) return;
    setCreateError(null);
    setCreating(true);
    const res = await createGlobalTagAction(createName.trim(), createColor);
    setCreating(false);
    if (!res.success) { setCreateError(res.error || "Failed to create tag"); return; }
    const newTag = res.tag as GlobalTag;
    setAllGlobalTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
    const next = [...deckTags, newTag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
    setCreateMode(false);
    setCreateName("");
    setCreateColor("#6366f1");
    setCreateColorOpen(false);
    setCreateError(null);
    setTagFilter("");
  }

  // Separate main, reserve, and maybeboard cards. Maybeboard renders as a
  // muted secondary "Considering" section after Reserve in both layouts.
  const mainDeckCards = deck.cards.filter((dc) => dc.zone === 'main');
  const reserveCards = deck.cards.filter((dc) => dc.zone === 'reserve');
  const maybeboardCards = deck.cards.filter((dc) => dc.zone === 'maybeboard');

  // Classic deck order (type → alignment → brigade → name); by set when the
  // view is grouped by set, so Reserve and Considering can be pulled the same way.
  const sortCards = (cards: typeof deck.cards) => {
    if (groupBy === 'set') return sortDeckCardsBySet(cards);
    return [...cards].sort((a, b) => compareCardsByType(a.card, b.card));
  };

  // Group cards by the selected grouping method
  const groupCards = (cards: typeof deck.cards) => {
    if (groupBy === 'none') {
      return { 'All Cards': sortCards(cards) };
    }

    if (groupBy === 'set') {
      return Object.fromEntries(groupDeckCardsBySet(cards).map((g) => [g.set, g.cards]));
    }

    const grouped: Record<string, typeof deck.cards> = {};
    
    cards.forEach((deckCard) => {
      let key: string;
      
      if (groupBy === 'alignment') {
        key = deckCard.card.alignment || 'Neutral';
      } else if (groupBy === 'type') {
        const rawType = deckCard.card.type || 'Unknown';
        const typeName = prettifyTypeName(rawType);
        // Dual-type cards (e.g. "Hero/GE", "Evil Character/EE") go into a shared pile
        if (rawType.includes('/')) {
          key = 'Dual-Type';
        // Combine certain types together
        } else if (typeName === 'Artifact' || typeName === 'Covenant' || typeName === 'Curse') {
          key = 'Artifact/Covenant/Curse';
        } else if (typeName === 'Fortress' || typeName === 'Site' || typeName === 'City') {
          key = 'Fortress/Site';
        } else {
          key = typeName;
        }
      } else {
        key = 'All Cards';
      }
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(deckCard);
    });

    // Sort each group with the canonical default order
    Object.keys(grouped).forEach((key) => {
      grouped[key] = sortCards(grouped[key]);
    });

    // Return groups in a specific order
    if (groupBy === 'alignment') {
      const orderedGroups: Record<string, typeof deck.cards> = {};
      ['Good', 'Evil', 'Neutral'].forEach((alignment) => {
        if (grouped[alignment]) {
          orderedGroups[alignment] = grouped[alignment];
        }
      });
      // Add any remaining groups
      Object.keys(grouped).forEach((key) => {
        if (!orderedGroups[key]) {
          orderedGroups[key] = grouped[key];
        }
      });
      return orderedGroups;
    }

    if (groupBy === 'type') {
      // Order type buckets canonically (Dominants, Artifacts, Fortresses, …)
      const orderedGroups: Record<string, typeof deck.cards> = {};
      Object.keys(grouped)
        .sort(compareTypeGroups)
        .forEach((key) => {
          orderedGroups[key] = grouped[key];
        });
      return orderedGroups;
    }

    return grouped;
  };

  // Split alignment groups into sub-columns (Dominants and Lost Souls separate)
  const splitAlignmentGroup = (cards: typeof deck.cards) => {
    const dominants: typeof deck.cards = [];
    const lostSouls: typeof deck.cards = [];
    const regular: typeof deck.cards = [];

    cards.forEach((deckCard) => {
      const type = deckCard.card.type || '';
      if (type === 'Dom' || type === 'Dominant') {
        dominants.push(deckCard);
      } else if (type === 'LS' || type === 'Lost Soul') {
        lostSouls.push(deckCard);
      } else {
        regular.push(deckCard);
      }
    });

    const result: { cards: typeof deck.cards; isDominant?: boolean; isLostSoul?: boolean }[] = [];
    
    // Add regular cards (may be split into multiple columns)
    if (regular.length > 0) {
      const regularColumns = splitTypeGroup(regular);
      regularColumns.forEach(col => result.push({ cards: col }));
    }
    
    // Add dominants as separate column
    if (dominants.length > 0) {
      result.push({ cards: dominants, isDominant: true });
    }
    
    // Add lost souls as separate column
    if (lostSouls.length > 0) {
      result.push({ cards: lostSouls, isLostSoul: true });
    }

    return result;
  };

  // Split large type groups into multiple columns (max 17 cards per column)
  const splitTypeGroup = (cards: typeof deck.cards, maxPerColumn = 17) => {
    const totalCards = cards.reduce((sum, dc) => sum + dc.quantity, 0);
    if (totalCards <= maxPerColumn) {
      return [cards];
    }

    // Calculate how many columns we need and target size per column
    const numColumns = Math.ceil(totalCards / maxPerColumn);
    const targetPerColumn = Math.ceil(totalCards / numColumns);

    const columns: Array<typeof deck.cards> = [];
    let currentColumn: typeof deck.cards = [];
    let currentCount = 0;

    for (const deckCard of cards) {
      // Check if adding this card would exceed the target
      if (currentCount + deckCard.quantity > targetPerColumn && currentColumn.length > 0) {
        // Only start a new column if:
        // 1. We have cards in the current column, AND
        // 2. Adding this card would put us over target, AND
        // 3. The current column is closer to target than it would be with this card added
        const distanceWithoutCard = Math.abs(currentCount - targetPerColumn);
        const distanceWithCard = Math.abs(currentCount + deckCard.quantity - targetPerColumn);
        
        // If adding the card makes us further from target, start a new column
        if (distanceWithCard > distanceWithoutCard) {
          columns.push(currentColumn);
          currentColumn = [deckCard];
          currentCount = deckCard.quantity;
        } else {
          // Otherwise, add it to current column (better balance)
          currentColumn.push(deckCard);
          currentCount += deckCard.quantity;
        }
      } else {
        // Add to current column
        currentColumn.push(deckCard);
        currentCount += deckCard.quantity;
      }
    }

    if (currentColumn.length > 0) {
      columns.push(currentColumn);
    }

    return columns;
  };

  // Stacked cards hang below their group's own box (8rem in a desktop column,
  // 6rem in a phone row). By set there's a heading or a wrapped row underneath,
  // so pay that back or the cards cover it.
  const padForStack = groupBy === 'set' && viewMode === 'stacked';
  const stackedColumnPad = padForStack ? 'pb-32' : '';
  const stackedRowPad = padForStack ? 'pb-24' : '';

  // Calculate stats
  const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const maybeboardCount = maybeboardCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const totalCards = mainDeckCount + reserveCount;
  const uniqueCards = deck.cards.length;
  
  // Validation
  const validation = validateDeck(deck);

  // Get color for alignment group headers
  const getAlignmentColor = (groupName: string): string => {
    switch (groupName) {
      case 'Good':
        return 'text-green-400';
      case 'Evil':
        return 'text-red-400';
      case 'Neutral':
        return 'text-gray-400';
      case 'Dominant':
        return 'text-purple-400';
      case 'Lost Soul':
        return 'text-blue-300';
      default:
        return 'text-yellow-400';
    }
  };

  // Prettify card type names
  const prettifyTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
      'GE': 'Good Enhancement',
      'EE': 'Evil Enhancement',
      'EC': 'Evil Character',
      'HC': 'Hero Character',
      'GC': 'Good Character',
      'LS': 'Lost Soul',
      'Dom': 'Dominant',
      'Cov': 'Covenant',
      'Cur': 'Curse',
      'Art': 'Artifact',
      'Fort': 'Fortress',
      'Site': 'Site',
    };
    return typeMap[type] || type;
  };

  // Render a compact card item
  const renderCompactCard = (deckCard: typeof deck.cards[0], index: number, isVerticalStack = false, hideQuantity = false) => {
    const card = deckCard.card;
    const imageUrl = getImageUrl(card.imgFile);

    return (
      <div
        className={`group relative w-[calc((100%-1rem)/3)] md:w-28 flex-shrink-0 cursor-pointer transition-all ${
          isVerticalStack ? '-mb-32' : viewMode === 'stacked' ? '-mb-24' : ''
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (onViewCard) {
            onViewCard(card, deckCard.zone === 'reserve');
          }
        }}
        onMouseEnter={() => setHoveredCard(card)}
        onMouseLeave={() => setHoveredCard(null)}
      >
        {/* Card image - compact */}
        <div className="relative aspect-[2.5/3.5] rounded-md overflow-hidden bg-muted hover:ring-2 hover:ring-primary transition-all cursor-pointer shadow-md">
          {imageUrl ? (
            <CardThumb
              card={card}
              alt={card.name}
              className="w-full h-full object-contain"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted/60">
              <span className="text-xs text-muted-foreground text-center px-1">{card.name}</span>
            </div>
          )}
          
          {/* Quantity badge */}
          {deckCard.quantity > 1 && !hideQuantity && (
            <div className="absolute bottom-1 right-1 bg-gray-900/90 text-white text-xs font-semibold px-1.5 py-0.5 rounded shadow-lg">
              x{deckCard.quantity}
            </div>
          )}

          {/* Hover overlay with card name */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
            <div className="w-full p-1.5 text-white">
              <p className="text-xs font-semibold leading-tight truncate">{card.name}</p>
              {card.set && (
                <p className="text-[10px] text-white/70 truncate">{card.set}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const tagsBarContent = (deckTags.length > 0 || (isAuthenticated && deck.id)) ? (
      <div className="bg-background/95 backdrop-blur-sm border-b border-border/60">
        <div className="px-3 md:px-4 py-1 md:py-1.5">
          <div className="flex items-center gap-2">
              {/* Scrollable tag pills */}
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0">
              {deckTags.map((tag) => (
                isAuthenticated ? (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag)}
                    className="group flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium transition-opacity flex-shrink-0 whitespace-nowrap"
                    style={{ backgroundColor: tag.color, color: getTagContrastColor(tag.color) }}
                    title={`Remove "${tag.name}"`}
                  >
                    {tag.name}
                    <svg className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : (
                  <span
                    key={tag.id}
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 whitespace-nowrap"
                    style={{ backgroundColor: tag.color, color: getTagContrastColor(tag.color) }}
                  >
                    {tag.name}
                  </span>
                )
              ))}
              </div>

              {/* Picker trigger — outside the scrollable area so dropdown isn't clipped */}
              {isAuthenticated && deck.id && (
                <div className="relative flex-shrink-0" ref={tagPickerRef}>
                  <button
                    onClick={() => { setTagPickerOpen((o) => !o); setTagFilter(""); setCreateMode(false); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors whitespace-nowrap"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {deckTags.length === 0 ? "Add tags" : "Edit"}
                    {savingTags && <span className="ml-1 opacity-60">·</span>}
                  </button>

                  {tagPickerOpen && (
                    <div className="absolute z-50 top-full mt-1.5 left-0 w-64 bg-card border border-border rounded-xl shadow-xl">
                      {createMode ? (
                        <form onSubmit={handleCreateTag} className="p-3 flex flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setCreateColorOpen((o) => !o)}
                              className="w-7 h-7 rounded-md border-2 border-border shadow-sm flex-shrink-0 hover:scale-110 transition-transform"
                              style={{ backgroundColor: createColor }}
                            />
                            <input
                              autoFocus
                              type="text"
                              placeholder="Tag name"
                              value={createName}
                              onChange={(e) => setCreateName(e.target.value)}
                              maxLength={50}
                              className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-muted text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          {createColorOpen && (
                            <div className="flex flex-col items-center gap-1.5">
                              <HexColorPicker color={createColor} onChange={setCreateColor} style={{ width: "100%" }} />
                              <span className="font-mono text-xs text-muted-foreground">{createColor}</span>
                            </div>
                          )}
                          {createName.trim() && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Preview:</span>
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: createColor, color: getTagContrastColor(createColor) }}>{createName}</span>
                            </div>
                          )}
                          {createError && <p className="text-xs text-red-400">{createError}</p>}
                          <div className="flex gap-2">
                            <button type="submit" disabled={creating || !createName.trim()} className="flex-1 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
                              {creating ? "Creating…" : "Create tag"}
                            </button>
                            <button type="button" onClick={() => { setCreateMode(false); setCreateError(null); setCreateName(""); setCreateColorOpen(false); }} className="flex-1 py-1.5 border border-border text-muted-foreground text-sm rounded-lg hover:bg-muted">
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="px-3 pt-3 pb-2 border-b border-border">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Filter tags…"
                              value={tagFilter}
                              onChange={(e) => setTagFilter(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-muted text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto">
                            {tagsLoading ? (
                              <div className="flex justify-center py-4">
                                <svg className="animate-spin w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                </svg>
                              </div>
                            ) : filteredGlobalTags.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-4">
                                {allGlobalTags.length === 0 ? "No tags available yet" : "No matches"}
                              </p>
                            ) : (
                              filteredGlobalTags.map((tag) => {
                                const selected = deckTags.some((t) => t.id === tag.id);
                                return (
                                  <button
                                    key={tag.id}
                                    onClick={() => toggleTag(tag)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                                  >
                                    <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                      {selected && (
                                        <svg className="w-3.5 h-3.5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </span>
                                    <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                                    <span className="text-sm text-foreground">{tag.name}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                          {canManageTags && (
                            <div className="border-t border-border">
                              <button
                                onClick={() => { setCreateName(tagFilter); setCreateColor("#6366f1"); setCreateError(null); setCreateMode(true); }}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
                              >
                                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Create{tagFilter.trim() ? ` "${tagFilter.trim()}"` : " new tag"}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      </div>
  ) : null;

  return (
    <>
      {tagsBarContainer ? (tagsBarContent && createPortal(tagsBarContent, tagsBarContainer)) : tagsBarContent}
      <div className="h-full w-full bg-background text-foreground">
      {/* Main content area */}
      <div className="px-3 py-3 md:px-4 md:py-3 lg:flex lg:gap-4">
        {/* Deck cards */}
        <div className="flex-1 min-w-0">
          {/* Main Deck */}
          <div>
            {groupBy !== 'none' ? (
              // Type/Alignment/Set grouping layout with side-by-side columns
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-primary">Main Deck</h2>
                    <span className="text-sm text-muted-foreground">({mainDeckCount} cards)</span>
                  </div>
                </div>
                
                {mainDeckCards.length > 0 ? (
                  <div className="md:flex md:gap-4 md:items-start md:flex-wrap space-y-4 md:space-y-0">
                    {Object.entries(groupCards(mainDeckCards)).map(([groupName, cards]) => {
                      // Use different splitting logic for alignment vs type grouping
                      const columns = groupBy === 'alignment'
                        ? splitAlignmentGroup(cards)
                        : splitTypeGroup(cards).map(col => ({ cards: col }));

                      return (
                        <React.Fragment key={groupName}>
                          {/* Mobile: horizontal card layout per group */}
                          <div className={`md:hidden ${stackedRowPad}`}>
                            {groupBy === 'alignment' && (
                              <div className="mb-1.5 flex items-center gap-2">
                                <h3 className={`text-sm font-semibold ${getAlignmentColor(groupName)}`}>{groupName}</h3>
                                <span className="text-xs text-muted-foreground">({cards.reduce((sum, dc) => sum + dc.quantity, 0)})</span>
                              </div>
                            )}
                            {groupBy === 'set' && (
                              <div className="mb-1.5 flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-foreground">{groupName}</h3>
                                <span className="text-xs text-muted-foreground">({cards.reduce((sum, dc) => sum + dc.quantity, 0)})</span>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 items-start">
                              {cards.flatMap((deckCard) =>
                                Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                  <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-m-${i}`}>
                                    {renderCompactCard(deckCard, i, false, viewMode === 'stacked')}
                                  </React.Fragment>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Desktop: vertical column layout per group */}
                          {columns.map((column, colIndex) => (
                            <div key={`${groupName}-${colIndex}`} className={`hidden md:flex flex-col ${stackedColumnPad}`}>
                              {groupBy === 'alignment' && colIndex === 0 && (
                                <div className="mb-2 flex items-center gap-2">
                                  <h3 className={`text-lg font-semibold ${getAlignmentColor(groupName)}`}>{groupName}</h3>
                                  <span className="text-xs text-muted-foreground">({cards.reduce((sum, dc) => sum + dc.quantity, 0)})</span>
                                </div>
                              )}
                              {/* Set names run long: held to the card's width, with a fixed
                                  height so every column's cards start on the same line. */}
                              {groupBy === 'set' && (
                                <h3 className={`mb-2 h-12 w-28 flex flex-col justify-end text-xs font-semibold leading-4 text-foreground ${colIndex > 0 ? 'invisible' : ''}`}>
                                  <span className="line-clamp-3">
                                    {groupName}{' '}
                                    <span className="font-normal text-muted-foreground">({cards.reduce((sum, dc) => sum + dc.quantity, 0)})</span>
                                  </span>
                                </h3>
                              )}
                              <div className="flex flex-col gap-2 items-center">
                                {column.cards.flatMap((deckCard) =>
                                  Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                    <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-${i}`}>
                                      {renderCompactCard(deckCard, i, viewMode === 'stacked', viewMode === 'stacked')}
                                    </React.Fragment>
                                  ))
                                )}
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      );
                    })}

                    {/* Reserve - Show immediately after main deck columns */}
                    {reserveCount > 0 && (
                      <>
                        {/* Mobile reserve */}
                        <div className={`md:hidden ${stackedRowPad}`}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-purple-400">Reserve</h3>
                            <span className="text-xs text-muted-foreground">({reserveCount})</span>
                          </div>
                          <div className="flex flex-wrap gap-2 items-start">
                            {sortCards(reserveCards).flatMap((deckCard) =>
                              Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-reserve-m-${i}`}>
                                  {renderCompactCard(deckCard, i, false, viewMode === 'stacked')}
                                </React.Fragment>
                              ))
                            )}
                          </div>
                        </div>
                        {/* Desktop reserve */}
                        <div className={`hidden md:flex flex-col ml-4 ${stackedColumnPad}`}>
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-purple-400">Reserve</h3>
                            <span className="text-xs text-muted-foreground">({reserveCount})</span>
                          </div>
                          <div className="flex flex-col gap-2 items-center">
                            {sortCards(reserveCards).flatMap((deckCard) =>
                              Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-reserve-${i}`}>
                                  {renderCompactCard(deckCard, i, viewMode === 'stacked', viewMode === 'stacked')}
                                </React.Fragment>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Maybeboard ("Considering") — muted secondary, after Reserve */}
                    {maybeboardCount > 0 && (
                      <>
                        {/* Mobile */}
                        <div className={`md:hidden opacity-80 ${stackedRowPad}`}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <h3 className="text-sm font-semibold italic text-muted-foreground">Considering</h3>
                            <span className="text-xs text-muted-foreground">({maybeboardCount})</span>
                            <span
                              title="A scratchpad — not part of the deck."
                              className="w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center cursor-help"
                            >
                              ?
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 items-start">
                            {sortCards(maybeboardCards).flatMap((deckCard) =>
                              Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-maybeboard-m-${i}`}>
                                  {renderCompactCard(deckCard, i, false, viewMode === 'stacked')}
                                </React.Fragment>
                              ))
                            )}
                          </div>
                        </div>
                        {/* Desktop */}
                        <div className={`hidden md:flex flex-col ml-4 opacity-80 ${stackedColumnPad}`}>
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="text-lg font-semibold italic text-muted-foreground">Considering</h3>
                            <span className="text-xs text-muted-foreground">({maybeboardCount})</span>
                            <span
                              title="A scratchpad — not part of the deck."
                              className="w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center cursor-help"
                            >
                              ?
                            </span>
                          </div>
                          <div className="flex flex-col gap-2 items-center">
                            {sortCards(maybeboardCards).flatMap((deckCard) =>
                              Array.from({ length: viewMode === 'stacked' ? deckCard.quantity : 1 }, (_, i) => (
                                <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-maybeboard-${i}`}>
                                  {renderCompactCard(deckCard, i, viewMode === 'stacked', viewMode === 'stacked')}
                                </React.Fragment>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No cards in main deck</p>
                  </div>
                )}
              </div>
            ) : (
              // Non-type grouping layout with stacked headers
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-xl font-bold text-primary">Main Deck</h2>
                  <span className="text-sm text-muted-foreground">({mainDeckCount} cards)</span>
                </div>
                
                {mainDeckCards.length > 0 ? (
                  <div>
                    {Object.entries(groupCards(mainDeckCards)).map(([groupName, cards]) => (
                      <div key={groupName} className="mb-8">
                        
                        <div className={`flex flex-wrap gap-2 items-start ${viewMode === 'stacked' ? 'mt-8' : ''}`}>
                          {cards.map((deckCard, index) => (
                            <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}`}>
                              {renderCompactCard(deckCard, index, false)}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>No cards in main deck</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Reserve - Show below main deck if present (only for 'none' grouping) */}
          {reserveCount > 0 && groupBy === 'none' && (
            <div className="mt-20 pt-6">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-bold text-purple-400">Reserve</h2>
                <span className="text-sm text-muted-foreground">({reserveCount} cards)</span>
              </div>

              <div>
                {Object.entries(groupCards(reserveCards)).map(([groupName, cards]) => (
                  <div key={groupName} className="mb-8">

                    <div className={`flex flex-wrap gap-2 items-start ${viewMode === 'stacked' ? 'mt-8' : ''}`}>
                      {cards.map((deckCard, index) => (
                        <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-reserve`}>
                          {renderCompactCard(deckCard, index, false)}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Maybeboard ("Considering") - Below Reserve when groupBy === 'none' */}
          {maybeboardCount > 0 && groupBy === 'none' && (
            <div className="mt-12 pt-6 opacity-80">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-bold italic text-muted-foreground">Considering</h2>
                <span className="text-sm text-muted-foreground not-italic">({maybeboardCount} cards)</span>
                <span
                  title="A scratchpad — not part of the deck."
                  className="w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center cursor-help"
                >
                  ?
                </span>
              </div>

              <div>
                {Object.entries(groupCards(maybeboardCards)).map(([groupName, cards]) => (
                  <div key={groupName} className="mb-8">
                    <div className={`flex flex-wrap gap-2 items-start ${viewMode === 'stacked' ? 'mt-8' : ''}`}>
                      {cards.map((deckCard, index) => (
                        <React.Fragment key={`${deckCard.card.name}-${deckCard.card.set}-maybeboard`}>
                          {renderCompactCard(deckCard, index, false)}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticky sidebar card preview — desktop only */}
        {showPreview && (
          <div className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-12">
              {hoveredCard ? (
                <div className="transition-opacity duration-150">
                  <div className="aspect-[2.5/3.5] rounded-lg overflow-hidden shadow-lg bg-muted">
                    <CardThumb
                      card={hoveredCard}
                      alt={hoveredCard.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{hoveredCard.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {hoveredCard.set}{hoveredCard.type ? ` · ${hoveredCard.type}` : ''}
                    {(() => {
                      const priceKey = `${hoveredCard.name}|${hoveredCard.set}|${hoveredCard.imgFile}`;
                      const priceInfo = getPrice(priceKey);
                      return priceInfo ? (
                        <span className="text-green-600 dark:text-green-400 font-medium"> · ${priceInfo.price.toFixed(2)}</span>
                      ) : null;
                    })()}
                  </p>
                </div>
              ) : (
                <div className="aspect-[2.5/3.5] rounded-lg border-2 border-dashed border-primary/30 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center px-4">Hover over a card to preview</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
