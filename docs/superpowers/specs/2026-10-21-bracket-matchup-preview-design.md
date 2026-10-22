# Bracket matchup preview — design

Date: 2026-10-21. Follows the Deck Bracket spec
(`2026-10-21-deck-bracket-design.md`); everything there still holds.

## Intent

A Deck Bracket match is two of your decks about to meet. Before playing it
(or when looking back at it) you want to size the matchup up: what each deck
is built around, how the brigades and card types line up, and the handful
of cards each side's plan turns on. Today the match block only names the
decks. This adds a **Preview matchup** control on every seated match that
opens a face-off page: a stat comparison, each deck's **key cards**, and
both full decklists with card art, side by side.

The bracket page is shareable by link, so the preview is for everyone who
can open the bracket, not only the owner. Only the owner chooses key cards.

## Goals

- One tap from the match block to the matchup, in every match state where
  both decks are seated (ready, live, done).
- Both decks visible at once on desktop; on phones, one deck at a time with
  an instant switch.
- A comparison table that reads at a glance: card-type counts and brigade
  mix for A and B in one view.
- The owner marks key cards per deck; they persist with the bracket and
  everyone with the link sees them, both in a "Key cards" strip and
  highlighted in the full list.
- The card grid is in the server-rendered HTML (same approach as the public
  deck page), so the page paints with the cards.
- Tapping a card opens the big card view with prev/next, like the deck page.

## Non-goals

- No matchup analysis, win odds, or advice text.
- No deck editing, no play actions, no result recording from this page.
- No hover sidebar preview (the two columns already use the width).
- No changes to the setup screen (`/brackets/new`), which has no bracket
  id and no persisted entries.

## Anti-goals

- Never show a private deck's cards to someone who could not open that deck
  on its own page. The bracket's entry snapshot (name, format, cover art)
  stays the only thing a viewer learns about a private deck.
- Don't slow the bracket page: the match block gains a link, nothing is
  loaded there.
- Don't add a new accent or a card-per-item box; the page is hairlines,
  small-caps labels, and the green accent only on the active control.

## Constraints

- Public site design system (`prompt_context/design_system.md`): Geist,
  Cinzel for the H1 only, hairline rows, 44 px targets, mobile-first.
- `components/ui/dialog.tsx` tops out at `max-w-lg`, so the preview is a
  **route**, not a modal: `/brackets/[id]/matchup/[matchId]`. That also
  makes it linkable and lets the server render the grid.
- Deck reads go through the viewer's own Supabase client, so RLS decides
  what they can see. No service-role read (unlike the friend-seat loader,
  which has a game-scoped reason).
- Deck rows may run past PostgREST's 1000-row default; page through them
  like `loadPublicDeckAction` does.

## The page

### Entry point

In `MatchBlock`, a hairline row between the deck rows and the footer:
a `Swords` icon, "Preview matchup", a chevron on the right. Rendered when
the block has a `bracketId`, both slots are seated, and the match is not a
bye. Same row for owner and viewer. The setup screen passes no `bracketId`
and shows no row.

### Header

Back link "Bracket" to `/brackets/[id]`. Small-caps kicker:
`{bracket name} · QF1 · Best of 3 · 1–0` (the series score only once a game
has been won). H1 in Cinzel: `{Deck A} vs {Deck B}`. If the match is done,
the kicker ends with `· {winner} won`.

### Face-off table

Three columns, A | label | B, values `tabular-nums`, label centered in the
small-caps style. Rows, in this order, skipping any row that is zero on
both sides:

1. Main deck, Reserve
2. Card-type groups in the canonical bucket order from
   `lib/cards/defaultSort.compareTypeGroups`, named by
   `lib/decks/typeGroups.getGroupDisplayName`: Dominants, Artifacts /
   Covenants / Curses, Fortresses / Sites, Lost Souls, Dual-Alignment
   Enhancements, Heroes, Good Enhancements, Evil Characters, Evil
   Enhancements, then anything else.
3. Good brigades and Evil brigades: swatch chips (`lib/tournament/
   brigadeColors`) with the count of main-deck cards in that brigade, each
   side listing its own brigades in count order.

Counts cover the **main deck only**. A card that carries every good (or
every evil) brigade counts once as "Multi", not once per colour; a card with
two or three named brigades counts under each.

### Deck columns

Two columns from `lg` up. Below `lg`, a pair of chips
(`{Deck A}` / `{Deck B}`, active is `bg-foreground text-background`) stuck
under the top nav switches between them; the inactive column is not
rendered.

Each column, top to bottom:

- **Header**: 56 px cover (paragon art for Paragon decks, else preview
  card 1), deck name linking to the deck page, "by {username}" when the
  deck owner's profile is readable, format chip, `N main · N reserve`.
- **Key cards**: a strip of larger tiles (3 across on phones, 4 in a
  desktop column) in decklist order. For the owner a `Choose key cards`
  outline button sits in the strip's header; while choosing, the button
  reads `Done` (primary), a one-line hint says "Tap cards to mark them as
  key", and every tile in the column toggles instead of opening. A chosen
  card shows a filled star badge and a `ring-primary` outline, both in the
  strip and in the full list. Viewers never see the button; with no key
  cards the strip is hidden for them and shows a dashed "No key cards yet"
  placeholder for the owner.
- **Main deck**: groups by type bucket (small-caps header with a count and
  hairline), tiles via `components/ui/CardTile` (compact), sorted with
  `compareCardsByType` inside a bucket, buckets in canonical order.
- **Reserve**: its own group at the bottom, when non-empty.

Tapping a tile outside choose mode opens
`app/decklist/card-search/ModalWithClose` with the column's cards as the
navigation list, no add/remove, no collection controls.

### Unavailable decks

- Deck deleted (`entry.deckId` null): column header from the snapshot, then
  "This deck was deleted."
- Deck not readable by the viewer (private, or RLS returned nothing): the
  snapshot header, then "This deck is private. Only its owner can see the
  cards." Key cards are hidden too (their images are deck cards).
- The face-off table shows `—` in that side's cells.

## Data

### Key cards

Migration 115 adds `deck_bracket_entries.key_cards text[] not null default
'{}'`. Each element is the catalog key `name|set|imgFile` (img sanitized
with `sanitizeImgFile`), the same key `CARD_BY_FULL_KEY` uses, so a key
maps to a deck row and to a catalog card without a second lookup. The
existing owner-write policy (114) already covers updates; no new policy.

`BracketEntry` gains `keyCards: string[]`; `toEntry` reads it.

`setKeyCardsAction(entryId, keys)` in `app/brackets/actions.ts`: owner
check through the entry's bracket (`requireBracketOwner`), keys deduped,
each at most 200 characters, at most 12 in all. Saves the whole list on
every toggle; the client updates optimistically and reverts with a toast on
error.

### Loading the matchup

`app/brackets/lib/loadMatchupDecks.ts` (server-only helper, like
`loadDraftDecks`): given the two entries, reads `decks`
(`id, name, format, paragon, user_id, visibility`) and `deck_cards`
(`card_name, card_set, card_img_file, quantity, zone` in main/reserve,
paged by 1000) with the caller's client, and `profiles.username` for the
deck owners. A deck that comes back missing is reported as `unavailable`
(`'deleted'` when the entry has no deck id, else `'private'`).

The page joins rows to the catalog with
`app/decklist/[deckId]/enrichDeckCards` and `CARD_BY_FULL_KEY`, exactly as
the deck page does, then hands `MatchupClient` plain data.

### Pure helpers (`app/brackets/lib/matchup.ts`, unit-tested)

- `cardKey(card)` → the key above.
- `groupDeck(cards)` → `{ main: [{ key, name, count, cards }], reserve }`
  in canonical order.
- `deckBreakdown(cards)` → main and reserve totals, type-bucket counts,
  good and evil brigade counts.
- `faceOffRows(a, b)` → the table rows, zero-both rows dropped.
- `brigadeCounts(cards)` with the Multi collapse described above.

## Files

- `supabase/migrations/115_deck_bracket_entry_key_cards.sql`
- `lib/bracket/types.ts`, `app/brackets/types.ts` (+ test fixtures)
- `app/brackets/actions.ts` — `setKeyCardsAction`
- `app/brackets/lib/matchup.ts` + `__tests__/matchup.test.ts`
- `app/brackets/lib/loadMatchupDecks.ts`
- `app/brackets/[id]/matchup/[matchId]/page.tsx`, `MatchupClient.tsx`,
  `DeckColumn.tsx`, `FaceOffTable.tsx` + a render test
- `app/brackets/components/MatchBlock.tsx` (row), `BracketView.tsx` and
  `[id]/BracketClient.tsx` (pass `bracketId`) + MatchBlock test

## Calls I made (for review)

1. A route, not a dialog: the dialog component is capped at 512 px, the
   page needs two full card grids, and a URL can be shared.
2. The entry control is a full-width hairline row in the match block rather
   than a third button in the footer; the footer is 216 px wide on desktop
   and already holds Play plus the menu.
3. Key cards live on the entry row in Postgres, not in the browser, so
   viewers of a shared bracket see them.
4. Up to 12 key cards per deck; saved on each tap.
5. Type and brigade counts use the main deck only; the reserve is listed
   separately.
6. Multi-brigade cards count once as Multi.
7. Card detail reuses the deck builder's `ModalWithClose` rather than a new
   viewer, so the big-card experience matches the deck page.
8. Viewers see a locked column for a private deck; no service-role read.
