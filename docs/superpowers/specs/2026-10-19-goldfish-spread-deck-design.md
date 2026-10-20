# Goldfish: Spread Deck (deck-builder expanded layout on the table)

**Date:** 2026-10-19
**Status:** Approved after adversarial review (changes folded in below);
revised the same day to spread the whole deck, not only the pile
**Surface:** `/goldfish/[deckId]` only. Multiplayer (`/play`) is untouched.

## Intent

Players lay a physical deck out on the table in columns by card type to look
it over, then put it back. The deck builder already draws exactly that
picture in its expanded view ("Stacked" + "Type"). Goldfish mode should
offer the same picture on the practice table: one click in the gear menu
spreads **every card of the deck, wherever it currently sits**, face-up
across Territory in the deck builder's layout, and one more click puts each
card back where it came from.

This is a sandbox convenience, not a rules feature. Cards that are spread are
ordinary Territory cards: draggable, selectable, hoverable, right-clickable.

## Goals

- A **Spread Deck** entry in the goldfish gear menu (the `CardScaleControl`
  popover at bottom-left).
- Spread covers the whole deck: the pile, the hand, Territory, Land of
  Bondage, discard, banish, Land of Redemption, and the Reserve. The player
  sees the full 50 (or 100+) cards, not just what is left in the pile.
- Spread reproduces the deck builder's expanded layout geometry: type buckets
  in canonical order, one or more vertical columns per bucket, every copy its
  own card, cards in a column overlapping so only a top strip of each shows,
  the last card in a column fully visible, then the Reserve as its own sorted
  column after an extra gap.
- The whole spread stays inside the Territory rectangle, for any deck size
  (T1, T2, Paragon) and any card-scale setting. When it cannot fit at the
  deck builder's pitches, columns and strips tighten (see "Degradation").
- While a spread is on the table the same menu entry reads **Gather Deck**
  and returns every spread card to the zone it came from, in its old order,
  with its old face and (for Territory cards) its old spot.
- Both Spread and Gather are single undoable steps.

## Non-goals

- No change to the multiplayer gear menu or toolbar.
- No keyboard shortcut (the gear menu is the only entry point).
- No type/alignment headers on the canvas. The deck builder's Stacked+Type
  view has none either; its "Reserve" header is dropped too.
- No "Normal" (one card per name with an `xN` badge) variant. Only the
  Stacked variant is reproduced.
- Opponent tokens, the Paragon Soul Deck's shared souls, and the Paragon
  card (which lives in the drawer, not on the canvas) are never touched.
- No animation of the cards travelling to their slots. Cards jump, like every
  other goldfish move today.

## Anti-goals (what would make this a failure)

- Spread cards that are not real Territory cards (an overlay you cannot drag
  from). The point is to be at the table with the cards.
- A spread that runs off the visible Territory for a 100-card T2 deck.
- Gather that silently loses or duplicates cards, returns a card the player
  deliberately moved somewhere else while the spread was out, or scrambles a
  zone the player had arranged (hand order, pile order).

## Behavior

### Spread Deck

1. Every card of the player's deck moves to Territory, face-up
   (`isFlipped = false`), with an explicit `posX`/`posY`. "The player's deck"
   is every card with `ownerId === 'player1'` that is not a token and not a
   Soul-Deck-origin soul, in every zone except `soul-deck` and `paragon`.
   Cards in the Reserve zone form the reserve group; everything else is the
   main group.
2. Cards already in Territory are part of the spread too: they are moved
   into the layout like everything else, and their old spot is remembered.
   Counters, notes, meek, and outline on them are kept (they never left
   play). Any equip link that touches a spread card is dropped, because the
   layout gives every card its own slot; the link is remembered.
3. Lost Souls spread as their own column, exactly as in the deck builder.
4. For every moved card the reducer records its **origin**: zone, index in
   that zone, face, Territory spot, and attached warrior, keyed by instance
   id on `state.deckSpread`. This is what makes the menu entry flip to Gather
   and what Gather later uses. (Named apart from the existing hand-fan
   `isSpreadHand` / `toggleSpreadHand` / `__TOGGLE_SPREAD__` vocabulary.)
5. If there is nothing to spread (an empty table and an empty pile), nothing
   happens and a "No cards to spread" toast is shown.
6. One history entry is pushed, so Undo restores everything.

### Gather Deck

1. Every card in `deckSpread` moves from Territory back to its origin zone,
   inserted at its original index (clamped to the zone's current length) in
   ascending index order so relative order inside each zone survives, with
   its original face (pile cards face-down, everything else as it was).
2. Nothing is shuffled. The pile's order was never shown to the player (the
   spread is sorted by type), so there is nothing to hide.
3. A card returning to a non-play zone (pile, hand, reserve, discard, banish,
   Land of Redemption) drops in-play state: counters, notes, outline,
   rotation, meek, reveal. A card returning to Territory or Land of Bondage
   keeps all of that. A card returning to Territory gets its old spot; a
   weapon whose warrior is back on the table re-links to it; a weapon whose
   warrior is gone stays at its spread slot, unlinked.
4. `deckSpread` is cleared, so the menu entry reads Spread Deck again.
5. One history entry is pushed. Undo after Gather restores the spread.

### Keeping `deckSpread` honest

A spread card the player drags to Hand must not be swept back by Gather,
even if they later play it back into Territory. Instead of patching every
reducer path that can move a card out of Territory (MOVE_CARD,
MOVE_CARDS_BATCH, MOVE_TO_TOP/BOTTOM_OF_DECK, the ability helpers), the
reducer runs one post-pass after **every** action:

```
deckSpread = entries whose card is still in Territory
drop the field entirely when none remain
```

Leaving Territory for any reason removes a card from the record for good;
coming back does not re-add it. The gear label therefore reads Gather Deck
only while at least one spread card is actually still in Territory, and
Gather never has "nothing to move" while the label says Gather. The pass
must return the same state object when nothing changed, so existing
"no-op returns the same state" tests keep passing.

### New Game

`RESET_GAME` builds a fresh state, which has no `deckSpread`. Nothing extra
is needed.

## Layout algorithm

Lives in a pure module `app/goldfish/layout/deckSpreadLayout.ts` so it can
be unit-tested without Konva or React:

```ts
computeDeckSpreadLayout(
  { main: GameCard[]; reserve: GameCard[] },
  zone: ZoneRect,          // the Territory rect from calculateZoneLayout
  cardWidth: number,       // CARD_WIDTH * cardScale (already rounded)
  cardHeight: number,
): { orderedIds: string[]; positions: Record<string, { posX: number; posY: number }> }
```

Mirrors `FullDeckView` with `viewMode='stacked'`, `groupBy='type'`:

1. **Bucket** each main card by type using the deck builder's rules, in this
   order of precedence: raw type containing `/` → `Dual-Type`;
   Artifact / Covenant / Curse → `Artifact/Covenant/Curse`; Fortress / Site /
   City → `Fortress/Site`; otherwise the prettified type name (`GE` → `Good
   Enhancement`, `EE` → `Evil Enhancement`, `Hero`, `Evil Character`,
   `Lost Soul`, `Dominant`, ...). The deck builder's `prettifyTypeName` map
   is reproduced here; its only job is to produce the same bucket keys.
2. **Order buckets** with `compareTypeGroups` from `lib/cards/defaultSort.ts`
   (Dominant, Artifact/Covenant/Curse, Fortress/Site, Lost Soul, Dual-Type,
   Hero, Good Enhancement, Evil Character, Evil Enhancement, misc).
3. **Sort within a bucket** with `compareCardsByType` (type → alignment →
   brigade → name). The sort is stable, so copies of one card stay adjacent.
4. **Split a bucket into columns** of at most 17 cards, porting the deck
   builder's `splitTypeGroup` faithfully: first collapse the sorted bucket
   into runs of identical copies (same `cardName` + `cardSet`, each run
   carrying its quantity), then walk the runs with the deck builder's
   target-per-column balancing so a run of copies is never split across two
   columns (18 singletons → 9+9; 35 singletons → 12+12+11; 3 copies that
   straddle the boundary stay together, e.g. 10+8).
5. **Reserve.** After the main columns, the reserve is one sorted
   (`compareCardsByType`) column with no bucketing, preceded by an extra gap
   equal to the column gap (the deck builder's `ml-4` on its reserve column).
   Deliberate deviation: a reserve longer than 17 is split like a bucket, so
   one tall T2 reserve column cannot squeeze the strip for the whole spread
   (the deck builder scrolls; the canvas cannot). No gap when there is no
   main deck to separate from.
6. **Pitch.** Horizontal column pitch defaults to `cardWidth + gap` where
   `gap = round(cardWidth * 0.14)` (`md:gap-4`, 16px on a 112px card).
   Vertical strip defaults to `round(cardHeight * 0.235)`: the deck builder
   column is `flex-col gap-2` with `-mb-32` on a 112×156.8 card, so each
   card shows 156.8 − 128 + 8 = 36.8px ≈ 0.235 of its height (≈39px on a
   168px card at scale 1.0).
7. **Degradation.** If the columns (plus the reserve gap) would exceed the
   Territory width, the pitch shrinks to
   `(availW - cardWidth - reserveGap) / (cols - 1)`; if the tallest column
   would exceed the Territory height, the strip shrinks to
   `(availH - cardHeight) / (maxLen - 1)`. Both are floored at 0. Nothing
   ever grows past the defaults. Concretely, Territory at virtual 1920×1080
   is ≈1582×611: a 50+10 T1 deck is typically 10-13 columns and still lands
   near the default pitch at scale 1.0; a 13-column spread at scale 1.4
   overlaps columns by ≈52px with a 17-card strip of ≈21px; a 100+20 T2
   deck at 20+ columns overlaps heavily. Cards remain draggable, so a tight
   spread is still usable, and the player can shrink the card size for a
   cleaner picture. Unit tests pin the pitch-below-card-width case with and
   without the reserve gap.
8. **Origin.** `x0 = zone.x + 8`, `y0 = zone.y + 24`. The zone label is a
   20px strip at the top-right only, but a uniform offset is simpler and
   costs about 1px per strip in a 17-card column; without it the rightmost
   column's first card would sit under the 0.85-opacity label.
   `availW = zone.width - 16`, `availH = zone.height - 32`.
9. **Output order** is column by column, top to bottom. The reducer appends
   cards in this order, and Konva paints later children on top, so the card
   below covers the bottom of the card above and the top strip of each card
   stays visible, as in the deck builder.

## State and actions

- `GameState.deckSpread?: Record<string, DeckSpreadOrigin>` (optional, like
  `topDeckRevealed`), where `DeckSpreadOrigin = { zone, index, isFlipped,
  posX?, posY?, equippedTo? }`.
- Two new `ActionType`s: `DECK_SPREAD` (payload `cardInstanceIds` +
  `positions`) and `DECK_GATHER` (no payload).
- `gameReducer` cases as described above. Both go through the normal
  `pushHistory` path. `DECK_SPREAD` returns `state` unchanged (no history
  entry) when none of the ids exist; `DECK_GATHER` returns `state` unchanged
  when `deckSpread` is absent. The post-pass prune runs on every action.
- `gameActions.ts` gets `spreadDeckPile(ids, positions)` and
  `gatherDeckPile()`.
- `GameContext` exposes `spreadDeckPile` and `gatherDeckPile` the same way it
  exposes `reorderLob` and friends.

The canvas decides *which* cards (the ownership filter above) and computes
the layout, because only it knows the Territory rect and the current card
size. The reducer never measures anything and moves exactly the ids it is
handed.

## UI

`CardScaleControl` (shared with multiplayer) gains two optional props:

```ts
/** Spread / gather the deck across Territory (goldfish only). */
onToggleDeckSpread?: () => void;
/** True while a spread is on the table — flips the label to Gather. */
isDeckSpread?: boolean;
```

When `onToggleDeckSpread` is provided the popover renders one more
divider + button in the same style as **Load Deck**: icon `LayoutGrid` with
label **Spread Deck**, or icon `Layers` with label **Gather Deck** while
`isDeckSpread`. The button closes the popover on click, like Load Deck.
Goldfish passes the props; multiplayer does not, so its menu is unchanged.

Touch: the new row matches the existing Load Deck / Soul Cinematic rows
(≈26px tall). Only the gear button itself is 44px on touch today; this
feature does not change that.

## Edge cases the builder must cover

- Nothing to spread → toast, no state change, no history entry.
- A warrior with an attached weapon, both spread → both get slots, the link
  is dropped; Gather re-links if the warrior is back, else the weapon stays
  at its slot.
- A weapon that is NOT spread but was attached to a spread warrior →
  unlinked when the warrior leaves.
- A card the player meeks or adds counters to while spread, then Gather →
  cleared if it goes back to a non-play zone; kept if it goes back to
  Territory or Land of Bondage.
- A spread card dragged to Hand and later played back to Territory → pruned
  from `deckSpread` when it left; Gather leaves it alone.
- Every spread card dragged away → `deckSpread` pruned to empty and dropped;
  the gear reads Spread Deck again.
- A zone that shrank while the spread was out (the player discarded a hand
  card that was not spread) → the returning card's index is clamped.
- Card scale changed after spreading → positions are fixed virtual coords;
  cards overlap more or less but stay where they are. No re-layout.
- Paragon format → `soul-deck` and shared souls in Land of Bondage are never
  part of the spread; the player's own souls there are.

## Tests

- `app/goldfish/layout/__tests__/deckSpreadLayout.test.ts`: bucket keys and
  bucket order; stable copy adjacency; 17-card split (18 → 9+9, 35 →
  12+12+11, copies never straddle); z-order equals output order; default
  pitches (0.14 gap, 0.235 strip); width/height shrink when the zone is
  small, including pitch below card width; origin offsets; reserve as one
  sorted unbucketed column after the main columns with the extra gap, no gap
  without a main deck, reserve split at 17, the gap counted when tightening.
- `app/goldfish/state/__tests__/gameReducer.deckSpread.test.ts`: Spread
  pulls from every zone in the given order with positions and face-up,
  records origins with pre-removal indices, skips unknown ids, is a no-op
  when none exist, drops equip links on both sides; Gather returns every
  card to its origin zone in its old order with its old face without
  shuffling, restores Territory spots and re-links weapons (or not, when the
  warrior is gone), clears in-play fiddling on non-play returns and keeps it
  on Territory returns, clamps indices, is a no-op when nothing is spread;
  the prune drops a card that left and does not re-add it, drops the field
  when empty, returns the same object when nothing changed, leaves the record
  alone on unrelated actions; undo works in both directions.
- `tsc --noEmit` clean. No full `next build` for a change this size.

## Docs

The gear-menu section of `prompt_context/goldfish_practice_mode.md`
describes Spread Deck / Gather Deck.

## Left to the builder

- Exact lucide icons if `LayoutGrid` / `Layers` read poorly at 14px.
- Whether spreading also clears the current selection.
- A second entry point on the deck pile's right-click menu was suggested in
  review and is deliberately out of scope for this PR; the user asked for
  the gear menu.
