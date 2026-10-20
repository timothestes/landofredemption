# Goldfish / Practice Mode

> **Status**: Core implementation complete — iterating based on user feedback

## What Is Goldfish Mode?

"Goldfishing" is CCG jargon for playing a deck solo — no opponent — to test consistency, practice sequencing, and get reps with a strategy. The goldfish mode simulates a physical table with all zones visible, cards freely movable between them, and shortcuts for common actions.

**This is NOT a rules engine.** There is no automatic enforcement of game rules. It is a sandbox where the player controls everything manually, like sitting at a table and manipulating physical cards.

---

## Entry Points & Routing

The goldfish mode is accessible from multiple surfaces throughout the app. A unified `GoldfishButton` component appears on community decks, individual deck pages, My Decks, and the deck builder — anywhere a deck is displayed. No login is required; any public deck can be goldfished.

| Route | Purpose |
|-------|---------|
| `/goldfish` | Entry page — browse decks or pick one to practice |
| `/goldfish/[deckId]` | Load a specific saved deck (public or owned) |
| `/goldfish/[deckId]?format=T2` | Override the deck's format via query param |

The deck data is fetched server-side before the page renders. The game itself is entirely client-side — no server calls during play.

---

## Game Setup

When a deck is loaded, initialization happens automatically:

1. All cards are expanded into instance cards with unique IDs
2. Reserve cards are separated into the Reserve zone
3. The main deck is shuffled
4. If "always start with" cards are configured, those are tutored to hand first
5. An opening hand is drawn (default 8 cards)
6. Lost Souls drawn in the opening hand are auto-routed to Land of Bondage and replaced with additional draws
7. All card images are preloaded before the board becomes interactive — a progress bar is shown during loading

There is no pre-game settings screen. The game starts immediately and options can be adjusted mid-session.

---

## Game Zones

The board uses 9 zones. Territory and Land of Bondage are free-form placement areas where cards can be positioned anywhere. All other zones use stacked/grid layouts.

| Zone | Location | Description |
|------|----------|-------------|
| **Deck** | Out-of-Play sidebar | Face-down card library. Shows card count. Click to peek at top cards. |
| **Hand** | Bottom of screen | The player's hand. Fan arc or spread layout. Max 16 cards. |
| **Reserve** | Out-of-Play sidebar | Sideboard cards, separated automatically on game start. |
| **Discard** | Out-of-Play sidebar | Discarded cards, face-up and browsable. |
| **Territory** | Main play area (left) | Free-form zone for characters, fortresses, artifacts, enhancements. Cards can be placed anywhere within the area. |
| **Land of Bondage** | Below territory | Free-form zone for Lost Souls. Cards auto-route here on draw if the option is enabled. |
| **Land of Redemption** | Out-of-Play sidebar | Rescued souls. The count here serves as the "souls rescued" indicator. |
| **Banish** | Out-of-Play sidebar | Cards removed from the game entirely. |
| **Paragon** | Out-of-Play sidebar | Paragon format only. Shows the paragon card for the deck. |

All sidebar zones display a card count badge. Clicking any zone label opens a browse modal showing all cards in that zone as a grid.

---

## Game Phases

The phase bar runs across the top of the screen:

**Draw → Upkeep → Preparation → Battle → Discard**

- Click any phase to jump directly to it
- Use left/right arrows or press `Enter` to advance sequentially
- **End Turn** (button on the right) increments the turn counter, resets to Draw phase, and auto-draws 3 cards
- Phases are cosmetic — no rules are enforced. Players can take any action in any phase.

The turn counter is displayed in the phase bar area. An optional Game HUD (top-left) shows the turn number and rescued souls count in a larger format.

---

## Card Interactions

### Drag and Drop

The primary way to move cards between zones. Drag any card from any zone and drop it on any other zone. Territory and Land of Bondage support free-form positioning — cards land wherever they're dropped. Other zones absorb cards into their stack/grid layout.

Cards that leave the deck are automatically flipped face-up.

### Right-Click Context Menu

Every card has a context menu with actions relevant to its location:

- **Move to any zone** — Hand, Territory, Land of Bondage, Land of Redemption, Discard, Banish, Reserve
- **Deck positioning** — Move to top of deck, move to bottom of deck, shuffle into deck
- **Card state** — Meek/Unmeek (180° rotation), Flip face-up/face-down
- **Counters** — Add or remove counters in 6 colors (red, blue, green, yellow, purple, white). Counter controls appear for cards in Territory and Land of Bondage.
- **Notes** — Attach free-text annotations to any card. Notes are visible in the card zoom modal.
- **Exchange** — Tutor/exchange cards from the deck

Opponent tokens (player 2-owned cards) show a simplified menu with "Rescue to L.O.R." and "Remove Token" options.

### Multi-Card Selection

- **Lasso select**: Click and drag on empty space to draw a selection rectangle
- **Shift+click**: Add individual cards to the selection
- Selected cards glow golden
- Right-click a selection for batch operations: move all to a zone, meek/unmeek all, flip all, move to top/bottom of deck, shuffle into deck

### Double-Click

Double-clicking any card opens the Card Zoom modal with a full-size image and card details (name, type, brigade, strength/toughness, special ability, set, notes, and alternate printings).

---

## Deck Operations

Right-clicking the deck pile opens an extensive context menu:

**Drawing**: Draw from top (1, 3, or custom count), draw from bottom, draw random
**Revealing/Peeking**: Reveal from top, reveal from bottom, reveal random — opens a modal showing the selected cards where each card can be individually moved to another zone or put back
**Discarding**: Discard from top, discard from bottom, discard random
**Reserve**: Put in reserve from top, bottom, or random
**Other**: Search deck (full searchable/filterable list), Shuffle deck

### Deck Peek Modal

Clicking the deck zone opens a peek modal showing the top cards. Cards can be selected (click or shift+click, or lasso), then dragged to other zones or sent back to the top of deck, bottom of deck, or shuffled in.

### Deck Search Modal

A full search of all cards in the deck with filters for type, name, brigade, alignment, ability, and identifier. Cards can be dragged from the search results directly into zones or hand.

---

## Hand Display

The hand spans the bottom of the screen and supports two layouts:

- **Fan arc** (default): Cards arranged in a slight arc with parabolic vertical curve. Cards in the center sit slightly higher. Each card has a subtle rotation.
- **Spread** (flat): Cards in a flat horizontal row with no rotation. Toggle with the `H` key or the fan/unfan toolbar button.

As hand size grows, cards compress to fit but remain readable. The hand holds a maximum of 16 cards — attempts to draw beyond this trigger a toast notification.

---

## Card Preview System

Three levels of card preview are available:

1. **Hover preview** (inline): Hovering over any face-up card on the canvas shows a warm golden glow that intensifies over time. A popup card preview (~280px wide) appears near the card after a brief hover delay.

2. **Card Loupe panel** (sidebar): A collapsible panel on the right side of the screen that shows a large version of whatever card is currently hovered. Toggle with `Tab` or the loupe button. Auto-hides on screens narrower than 1200px. Visibility state persists in localStorage.

3. **Card Zoom modal** (double-click): Full card image (~400px) with a details panel showing name, type, brigade, strength/toughness, special ability, set, notes, and alternate printings (via "Also Known As"). Close with `Esc` or clicking outside.

---

## Opponent Simulation

Goldfish mode is solitaire, but players can simulate opponent presence:

- **Add Opponent Lost Soul**: Right-click the Land of Bondage zone to add a New Testament or Old Testament lost soul token. These appear as player 2-owned cards.
- **Add Player Lost Soul**: Right-click Land of Redemption to add an OT lost soul token there.
- **Rescue/Remove**: Right-click any opponent token to "Rescue to L.O.R." (moves it to Land of Redemption) or "Remove Token" (deletes it entirely).
- Opponent tokens dropped into remove zones (hand, deck, discard, banish, reserve) are automatically deleted.

There is no AI opponent. All game actions are player-controlled.

---

## Dice Roller

Press `R` or click the Roll button to roll a d6. The die displays with a tumble animation, cycles through random faces, and lands on a result (1–6). The result displays for 3 seconds with a golden glow effect. Uses classic die pip patterns.

---

## Undo

Press `Cmd/Ctrl+Z` or click the Undo button to revert the last action. The system maintains a history of up to 20 state snapshots, restoring the full game state (all zones and the current phase) on each undo.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Draw a card |
| `S` | Shuffle deck |
| `R` | Roll dice |
| `H` | Toggle hand fan/spread layout |
| `Tab` | Toggle card loupe panel |
| `Enter` | Advance to next phase |
| `Cmd/Ctrl+Z` | Undo |
| `Esc` | Close modals and menus |

---

## Game Options

Options are accessible during a session (no pre-game configuration screen):

| Option | Default | Description |
|--------|---------|-------------|
| Format | From deck metadata | T1, T2, or Paragon. Affects whether the Paragon zone appears. |
| Starting hand size | 8 | Number of cards drawn at game start (adjustable). |
| Auto-route Lost Souls | On | Automatically move drawn Lost Souls to Land of Bondage. |
| Show phase reminder | On | Display tips about each phase. |
| Show turn counter | On | Toggle the turn/souls HUD overlay. |
| Sound enabled | On | Enable sound effects (framework in place, not yet fully implemented). |
| Always start with | Empty | Array of card names to tutor to hand on game start. |

### Gear menu (bottom-left)

The gear button opens a small popover with the card-size slider, the Lost Soul cinematic toggle, and:

- **Spread Deck** — lays every card of the deck, wherever it currently sits (pile, hand, Territory, Land of Bondage, discard, banish, Land of Redemption, Reserve), face-up across Territory in the deck builder's expanded layout (Stacked + Type): one or more vertical columns per type bucket in canonical order, every copy its own card, each card overlapping the one above so only a top strip shows, then the Reserve as its own sorted column after an extra gap. Opponent tokens and the Paragon Soul Deck stay put. Spread cards are ordinary Territory cards (drag, select, hover, right-click). While a spread is on the table the entry reads **Gather Deck**, which puts every spread card still in Territory back where it came from: same zone, same order, same face, same Territory spot, weapons re-attached. Nothing is shuffled. Cards the player moved elsewhere in the meantime stay where they were put. Both are single undoable steps. Layout math lives in `layout/deckSpreadLayout.ts`; design notes in `docs/superpowers/specs/2026-10-19-goldfish-spread-deck-design.md`.

---

## Game Toolbar

A floating toolbar at the bottom-center of the screen with quick-access buttons:

- **Draw** (D) — Draw 1 card from the deck
- **Roll** (R) — Roll a d6
- **Undo** (Cmd+Z) — Revert last action
- **Fan/Unfan** (H) — Toggle hand spread layout
- **New Game** — Reset to initial game state (re-shuffle, re-draw opening hand, clear all zones)

---

## Toast Notifications

Brief notifications appear at the bottom-center of the screen and auto-dismiss after 2.5 seconds:

- "Hand is full (max 16 cards)" — when drawing with a full hand
- "Deck is empty" — when attempting to draw from an empty deck
- "Only N cards left in deck" — low deck warning during turn draws

---

## Visual Design

> **Full design system:** See `prompt_context/goldfish_design_system.md` for colors, typography, elevation, component specs, and do's/don'ts.

The board uses a dark, immersive cave-themed aesthetic:

- **Background**: Cave image (`/gameplay/cave_background.png`) with CSS `cover`, floor-biased positioning, torch glow radial gradient overlay, and strong vignette at edges
- **Color palette**: Near-black warm browns, sandy gold accents, aged parchment UI elements. Custom CSS variables (`--gf-bg`, `--gf-border`, `--gf-text`, `--gf-accent`, `--gf-gold`, etc.)
- **Typography**: Cinzel (Google Fonts) for all game UI text — Roman capitals with ancient weight. Georgia serif fallback.
- **Card rendering**: Full card images from Vercel Blob storage. Face-down cards show a card back (`/gameplay/cardback.webp`). Selected cards have a golden glow. Hover produces a warm amber glow effect.
- **Zone delineation**: Zones are subtle dark regions with worn ochre/sand borders and Cinzel labels

The canvas is rendered with Konva.js (react-konva) via dynamic import (client-side only). All modals, context menus, the phase bar, and toolbar are DOM overlays positioned above the canvas. The stage resizes responsively to fill the viewport, with zone positions calculated as proportional multipliers of the stage dimensions.

---

## Responsive Behavior

- **Desktop**: Full drag-and-drop board with all features
- **Loupe panel**: Auto-hides on screens narrower than 1200px
- **Canvas**: Resizes dynamically on viewport changes. Aspect ratio capped at 2.0 to prevent ultra-wide stretching.
- **Context menus**: Position themselves to stay within the viewport
- **Touch**: Tap and drag supported for mobile/tablet

---

## State Management

Game state lives entirely client-side using React Context + `useReducer`:

- Central `GameContext` provider with a `gameReducer` handling all actions
- State includes: zones (record of zone ID to card arrays), turn number, current phase, undo history, game options, hand layout mode, and draw tracking
- Each card tracks: instance ID, card metadata, zone, position (x/y for free-form zones), meek state, flip state, counters, notes, and owner (player1/player2)
- Memoized action creators for all game operations
- Consumed via a `useGame()` hook
- Card loupe visibility persisted to localStorage

---

## File Structure

```
/app/goldfish/
├── [deckId]/
│   ├── page.tsx              # Server component — fetches deck data
│   └── client.tsx            # Client wrapper with providers
├── components/               # ~24 component files
│   ├── GoldfishCanvas.tsx    # Main Konva canvas
│   ├── GameToolbar.tsx       # Bottom toolbar
│   ├── PhaseBar.tsx          # Top phase navigation
│   ├── CardContextMenu.tsx   # Single card right-click menu
│   ├── MultiCardContextMenu.tsx
│   ├── DeckContextMenu.tsx   # Deck right-click menu
│   ├── DeckPeekModal.tsx     # Peek at top N cards
│   ├── DeckSearchModal.tsx   # Search all deck cards
│   ├── DeckExchangeModal.tsx # Tutor/exchange cards
│   ├── ZoneBrowseModal.tsx   # Browse zone contents
│   ├── CardZoomModal.tsx     # Full card detail view
│   ├── DiceRollOverlay.tsx   # d6 roller
│   ├── GameToast.tsx         # Notifications
│   ├── CardLoupePanel.tsx    # Right sidebar preview
│   ├── GameHUD.tsx           # Turn/souls counter overlay
│   └── CardHoverPreview.tsx  # Inline hover preview
├── hooks/
│   ├── useKeyboardShortcuts.ts
│   ├── useImagePreloader.ts
│   ├── useSelectionState.ts  # Multi-select lasso
│   └── useModalCardDrag.ts
├── layout/
│   ├── handLayout.ts         # Fan arc + spread calculations
│   └── zoneLayout.ts         # Zone positioning
├── state/
│   ├── GameContext.tsx        # Main game context provider
│   ├── gameReducer.ts        # Action handler
│   ├── gameActions.ts        # Action creators
│   ├── gameInitializer.ts    # Initial state builder
│   └── CardPreviewContext.tsx # Loupe state
├── types.ts                  # All TypeScript types
└── page.tsx                  # Entry page
```

---

## Known Gaps / Future Work

- Sound effects framework exists in options but is not yet fully implemented
- No GSAP canvas animations yet (card draw arcs, zone-to-zone travel, flip animations) — card movements are instant
- No canvas-confetti celebration effects (soul rescued light burst, card-placed dust puff)
- No ambient dust mote particles on the background layer
- No paste-in deck flow (`/goldfish?import=[base64]`)
- No session autosave/restore
- No AI opponent or multiplayer support
- No scenario mode (start at a specific game state)
- Mobile experience is functional but not optimized with a simplified view

### TODOs

- Add GSAP card animations (draw arcs, zone travel, flip, shuffle)
- Add sound effects and ambient music
- Add options to disable sounds/music
- Add revealed-card options (Lackey-style)
- Improve hand UX with better card overlap behavior
- Auto-save deck when pressing "play" from the deck builder
