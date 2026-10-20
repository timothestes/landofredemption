# Goldfish: Spread Deck (deck-builder expanded layout on the table)

**Date:** 2026-10-19
**Status:** Approved after adversarial review (changes folded in below)
**Surface:** `/goldfish/[deckId]` only. Multiplayer (`/play`) is untouched.

## Intent

Players lay a physical deck out on the table in columns by card type to look
it over, then pick it up and shuffle. The deck builder already draws exactly
that picture in its expanded view ("Stacked" + "Type"). Goldfish mode should
offer the same picture on the practice table: one click in the gear menu
spreads the deck pile face-up across Territory in the deck builder's layout,
and one more click gathers it back into a shuffled pile.

This is a sandbox convenience, not a rules feature. Cards that are spread are
ordinary Territory cards: draggable, selectable, hoverable, right-clickable.

## Goals

- A **Spread Deck** entry in the goldfish gear menu (the `CardScaleControl`
  popover at bottom-left).
- Spread reproduces the deck builder's expanded layout geometry: type buckets
  in canonical order, one or more vertical columns per bucket, every copy its
  own card, cards in a column overlapping so only a top strip of each shows,
  the last card in a column fully visible.
- The whole spread stays inside the Territory rectangle, for any deck size
  (T1, T2, Paragon) and any card-scale setting. When it cannot fit at the
  deck builder's pitches, columns and strips tighten (see "Degradation").
- While a spread is on the table the same menu entry reads **Gather Deck**
  and returns the spread cards to the deck pile, face-down and shuffled.
- Both Spread and Gather are single undoable steps.

## Non-goals

- No change to the multiplayer gear menu or toolbar.
- No keyboard shortcut (the gear menu is the only entry point).
- No type/alignment headers on the canvas. The deck builder's Stacked+Type
  view has none either.
- No "Normal" (one card per name with an `xN` badge) variant. Only the
  Stacked variant is reproduced.
- Hand, Reserve, Land of Bondage, Discard, Banish and the Paragon Soul Deck
  are never touched by Spread or Gather.
- No animation of the cards travelling to their slots. Cards jump, like every
  other goldfish move today.

## Anti-goals (what would make this a failure)

- Spread cards that are not real Territory cards (an overlay you cannot drag
  from). The point is to be at the table with the cards.
- A spread that runs off the visible Territory for a 100-card T2 deck.
- Gather that silently loses or duplicates cards, or returns a card the
  player deliberately moved to Hand or Discard while the spread was out.

## Behavior

### Spread Deck

1. Every card currently in the **deck pile** (`zones.deck`) moves to
   Territory, face-up (`isFlipped = false`), with an explicit `posX`/`posY`.
   The deck pile is left empty.
2. Cards already in Territory keep their positions. Spread cards are appended
   to the Territory array, so they render above anything already there. A
   covered card becomes visible again after Gather.
3. Lost Souls in the deck spread as their own column, exactly as in the deck
   builder. They are not auto-routed to Land of Bondage. (Decision: the
   player is looking at the deck, not drawing from it.)
4. The instance ids of the moved cards are recorded on game state as
   `deckSpreadIds`. This is what makes the menu entry flip to Gather and
   what Gather later collects. (Named to avoid the existing hand-fan
   `isSpreadHand` / `toggleSpreadHand` / `__TOGGLE_SPREAD__` vocabulary.)
5. At game start the opening hand is already in Hand and auto-routed Lost
   Souls are already in Land of Bondage, so the first spread of a 50-card
   deck shows roughly 40 cards. That is the intended "what is left in my
   deck" picture; Search Deck has the same scope.
6. If the deck pile is empty, nothing happens and the existing
   "Deck is empty" toast is shown.
7. One history entry is pushed, so Undo restores the pile in its prior order.

### Gather Deck

1. Every id in `deckSpreadIds` moves from Territory back to the deck pile:
   `isFlipped = true`, `isMeek = false`, position cleared, counters/notes/
   outline/`revealUntil`/`imitatingName` cleared (the same in-play cleanup
   every other leave-Territory path does), any equip link involving the card
   removed (a weapon the player attached to a spread card is unlinked and
   stays in Territory).
2. The deck pile is shuffled.
3. `deckSpreadIds` is cleared, so the menu entry reads Spread Deck again.
4. One history entry is pushed. Undo after Gather restores the spread.

### Keeping `deckSpreadIds` honest

A spread card the player drags to Hand must not be swept back into the pile
by Gather, even if they later play it back into Territory. Instead of
patching every reducer path that can move a card out of Territory
(MOVE_CARD, MOVE_CARDS_BATCH, MOVE_TO_TOP/BOTTOM_OF_DECK, the ability
helpers), the reducer runs one post-pass after **every** action:

```
deckSpreadIds = deckSpreadIds.filter(id => zones.territory has id)
drop the field entirely when the list is empty
```

Leaving Territory for any reason removes a card from the set for good;
coming back does not re-add it. The gear label therefore reads Gather Deck
only while at least one spread card is actually still in Territory, and
Gather never has "nothing to move" while the label says Gather. The pass
must return the same state object when nothing changed, so existing
"no-op returns the same state" tests keep passing.

### New Game

`RESET_GAME` builds a fresh state, which has no `deckSpreadIds`. Nothing
extra is needed.

## Layout algorithm

Lives in a pure module `app/goldfish/layout/deckSpreadLayout.ts` so it can
be unit-tested without Konva or React:

```ts
computeDeckSpreadLayout(
  cards: GameCard[],
  zone: ZoneRect,          // the Territory rect from calculateZoneLayout
  cardWidth: number,       // CARD_WIDTH * cardScale (already rounded)
  cardHeight: number,
): { orderedIds: string[]; positions: Record<string, { posX: number; posY: number }> }
```

Mirrors `FullDeckView` with `viewMode='stacked'`, `groupBy='type'`:

1. **Bucket** each card by type using the deck builder's rules, in this
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
   straddle the boundary stay together, e.g. 8+10).
5. **Pitch.** Horizontal column pitch defaults to `cardWidth + gap` where
   `gap = round(cardWidth * 0.14)` (`md:gap-4`, 16px on a 112px card).
   Vertical strip defaults to `round(cardHeight * 0.235)`: the deck builder
   column is `flex-col gap-2` with `-mb-32` on a 112×156.8 card, so each
   card shows 156.8 − 128 + 8 = 36.8px ≈ 0.235 of its height (≈39px on a
   168px card at scale 1.0).
6. **Degradation.** If the columns would exceed the Territory width, the
   pitch shrinks to `(availW - cardWidth) / (cols - 1)`; if the tallest
   column would exceed the Territory height, the strip shrinks to
   `(availH - cardHeight) / (maxLen - 1)`. Both are floored at 0. Nothing
   ever grows past the defaults. Concretely, Territory at virtual 1920×1080
   is ≈1582×611: a 13-column T2 spread at card scale 1.0 lands at a 120.5px
   pitch (columns just touch) and a 17-card column shows a 25px strip; at
   scale 1.4 columns overlap by ≈52px and the strip is ≈21px; at the 1440
   virtual-width minimum, scale 1.0 columns overlap by ≈33px. Cards remain
   draggable, so a tight spread is still usable, and the player can shrink
   the card size for a cleaner picture. A unit test pins the
   pitch-below-card-width case.
7. **Origin.** `x0 = zone.x + 8`, `y0 = zone.y + 24`. The zone label is a
   20px strip at the top-right only, but a uniform offset is simpler and
   costs about 1px per strip in a 17-card column; without it the rightmost
   column's first card would sit under the 0.85-opacity label.
   `availW = zone.width - 16`, `availH = zone.height - 32`.
8. **Output order** is column by column, top to bottom. The reducer appends
   cards in this order, and Konva paints later children on top, so the card
   below covers the bottom of the card above and the top strip of each card
   stays visible, as in the deck builder.

## State and actions

- `GameState.deckSpreadIds?: string[]` (optional, like `topDeckRevealed`).
- Two new `ActionType`s: `DECK_SPREAD` (payload `cardInstanceIds` +
  `positions`) and `DECK_GATHER` (no payload).
- `gameReducer` cases as described above. Both go through the normal
  `pushHistory` path. `DECK_SPREAD` returns `state` unchanged (no history
  entry) when the pile is empty; `DECK_GATHER` returns `state` unchanged when
  `deckSpreadIds` is absent. The post-pass prune runs on every action.
- `gameActions.ts` gets `spreadDeckPile(ids, positions)` and
  `gatherDeckPile()`.
- `GameContext` exposes `spreadDeckPile` and `gatherDeckPile` the same way it
  exposes `reorderLob` and friends.

The layout is computed in `GoldfishCanvas` (the only place that knows the
Territory rect and the current card size) and handed to the reducer as
positions. The reducer never measures anything.

## UI

`CardScaleControl` (shared with multiplayer) gains two optional props:

```ts
/** Spread / gather the deck pile across Territory (goldfish only). */
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

- Deck empty → toast, no state change, no history entry.
- A spread card attached as a weapon (player dragged it onto a warrior) and
  then Gather → unlink and return it; the warrior stays. A weapon the player
  attached TO a spread card → unlinked, stays in Territory.
- A spread card that the player meeks or adds counters to, then Gather →
  counters cleared and `isMeek` reset (MOVE_CARD into the deck never clears
  meek today; Gather must, or the card is later drawn meek).
- A spread card dragged to Hand and later played back to Territory → pruned
  from `deckSpreadIds` when it left; Gather leaves it alone.
- Every spread card dragged away → `deckSpreadIds` pruned to empty and
  dropped; the gear reads Spread Deck again.
- Card scale changed after spreading → positions are fixed virtual coords;
  cards overlap more or less but stay where they are. No re-layout.
- Paragon format → `soul-deck` is never part of the spread.
- `topDeckRevealed` → irrelevant; the pile is empty while spread.

## Tests

- `app/goldfish/layout/__tests__/deckSpreadLayout.test.ts`: bucket keys and
  bucket order; stable copy adjacency; 17-card split (18 → 9+9, 35 →
  12+12+11, copies never straddle); z-order equals output order; default
  pitches (0.14 gap, 0.235 strip); width/height shrink when the zone is
  small, including pitch below card width; origin offsets.
- `app/goldfish/state/__tests__/gameReducer.deckSpread.test.ts`: Spread
  empties the pile, sets positions, flips face-up, records
  `deckSpreadIds`, pushes history; Spread on empty deck returns the same
  state object; Gather returns the spread cards face-down and un-meeked,
  clears positions/counters/equips, shuffles, clears `deckSpreadIds`,
  pushes history; a spread card moved to Hand is pruned from the set and
  is not gathered even after moving back to Territory; the prune returns
  the same state object when nothing changed.
- `tsc --noEmit` clean. No full `next build` for a change this size.

## Docs

Add a **Spread Deck / Gather Deck** row to the gear-menu options in
`prompt_context/goldfish_practice_mode.md`.

## Left to the builder

- Exact lucide icons if `LayoutGrid` / `Layers` read poorly at 14px.
- Whether spreading also clears the current selection.
- A second entry point on the deck pile's right-click menu was suggested in
  review and is deliberately out of scope for this PR; the user asked for
  the gear menu.
