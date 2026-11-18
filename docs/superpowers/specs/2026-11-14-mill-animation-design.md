# Mill animation and newest-first Discard window

## Why

Milling (discarding cards from a deck) is a real strategy, and the table gave
it no feedback: the deck count dropped, the discard count rose, and nothing
moved. Afterwards, the Discard window listed the pile oldest first, so the
cards just milled were at the bottom and needed a scroll to see.

## What changes

1. **Mill animation.** Any card that moves from a deck to a discard pile flies
   from the deck pile to the discard pile and flips face up on the way. It
   covers every cause: the deck menu's Discard top / bottom / random, an
   opponent discarding your deck, and card abilities. Both players and
   spectators see it for either deck, in online play and in goldfish. A milled
   card joins the pile (and the pile's count) when it lands.
2. **Discard window, newest first.** The most recently discarded card is the
   first card in the grid, for your own pile and the opponent's.

## Not changing

- Discards from hand, territory or battle do not animate.
- Banish and Reserve keep their order.
- No server change. The discard pile is still stored oldest first, with the
  newest card on top of the pile on the table.

## Approaches

- **Reuse the draw animation (picked).** `useDealAnimation` and `DealLayer`
  already detect deck → hand moves by diffing zones and fly a sprite that flips
  mid-flight. A `route` option points the same hook at deck → discard. Small,
  and the two animations stay consistent.
- **A separate mill hook and layer.** Free to diverge in look, but duplicates
  the diff, stagger, failsafe and reduced-motion handling for no gain today.
- **Server-driven event.** A reducer could announce a mill, but the zone diff
  already catches every path, including ones added later.

## How it is built

- `dealAnimationCore.diffDeals` takes a `toZone` (default `hand`).
  `MILL_STAGGER_MS` is 110 ms; the existing 1.6 s cap on a batch's spread
  compresses big mills.
- `useDealAnimation` takes `route: { toZone, staggerMs }`.
- `DealSpriteSpec.origin` takes an optional `rotation`, so the opponent's
  sprites fly turned 180° like their piles.
- `MultiplayerCanvas` and `GoldfishCanvas` run a second hook instance per deck,
  hide in-flight cards from the discard pile, and render the sprites last so
  nothing covers the flight.
- `ZoneBrowseModal` reverses the list when the zone is `discard`.
- Reduced motion: no flight, same as draws.
