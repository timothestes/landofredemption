# Deck Bracket: a single-elimination tournament of your own decks

**Date:** 2026-10-21
**Status:** Revised after a builder check and an adversarial usability
review; both sets of changes are folded in and listed under "Review
outcomes" at the end.
**Surfaces:** new `/brackets/*` pages, `/tracker/tournaments` and the My
Decks selection bar (entry points), the `/play` game client (a solo mode
and a bracket-aware game-over screen), and the SpacetimeDB module.

## Intent

As a kid, Tim would pick eight decks off the shelf, write a bracket on paper,
and play every match himself until one deck was left standing. This feature
gives any signed-in player that same afternoon: choose your decks, see them
drawn into a bracket, play each match on the real multiplayer table while
sitting on both sides of it, and watch the bracket fill in as results come
back on their own.

It is a tool for one person and their deck collection first. A friend can
be invited into any single game, but nothing about the bracket depends on a
second person existing.

## Vocabulary

- **Bracket**: one single-elimination tournament of decks. Owned by one
  user.
- **Entry**: a deck in the bracket. Entries are numbered by pick order
  (`seed`), which the UI never shows.
- **Size**: the number of first-round slots, 2, 4, 8 or 16, derived from
  the number of entries (the next power of two). Empty slots are byes.
- **Match**: a pairing of two slots in one round. A match is a **series**
  of games: best-of-1, best-of-3, or best-of-5. The first deck to
  `ceil(bestOf / 2)` game wins takes the match and advances. A match
  against a bye is decided at creation.
- **Game**: one game of Redemption played for a match: on the `/play`
  table solo, on the `/play` table with a friend, or recorded by hand.
- **Solo game**: a `/play` game where one human holds both seats. There
  are no consent prompts and nothing is hidden.
- **Seat in hand**: in a solo game, the seat whose hand sits at the bottom
  of the screen and whose deck the draw shortcut draws from. The board
  renders from that seat's point of view. The human can act for either
  seat at any time without changing it.

## Goals

1. **Create a bracket in one sitting on a phone.** From My Tournaments or
   My Decks, name it, pick the format and the series length, tap decks
   into it, start. Under a minute for eight decks you already own.
2. **A bracket you'd want to look at.** Rounds drawn left to right on
   desktop with connector lines; one sheet, top to bottom, on a phone.
   Every match shows both decks with their cover art and the series
   score. When a result comes back, the winner is written into the next
   box in front of you. The champion gets a proper panel at the end. The
   page is readable by anyone with the link, so the bracket can be
   shared.
3. **One tap from the bracket to the table.** "Play game N" opens the
   real `/play` table with both decks seated and the deck names as the
   player names. From the game-over screen, the next game of the series
   or the next ready match is one tap too.
4. **Solo play that feels like sitting on both sides.** Both hands and
   both reserves are face-up. The human can play either deck's cards,
   block, play enhancements for both sides, choose the soul, and end the
   turn, without ever "swapping" first. Ending a turn moves the other
   deck's hand into their lap automatically; a swap pill does the same by
   hand. Nothing ever waits for "the other player" to approve,
   acknowledge, or respond.
5. **Invite a friend into a game instead.** Off the main path, the
   player can host any game as an ordinary online game. The friend opens
   a link, is handed the other deck, and plays a normal game with normal
   hidden information and normal consent prompts.
6. **Results flow back by themselves.** When a bracket game ends, the
   result lands in the bracket, the series updates, the winner advances
   when the series is decided, and the champion is crowned after the
   final.
7. **Robust to the messy cases.** A game that was closed mid-way can be
   resumed (same browser), started over, or recorded by hand. Any game
   can be recorded by hand. A finished match can be reset while its
   winner's next match is still unplayed.

## Non-goals

- Double elimination, round robin, Swiss, or more than 16 decks.
- The same deck entered twice.
- Seeding by strength, ratings, or history.
- Changing the format or series length after the bracket starts.
- Any change to the existing Swiss tracker tables, pairing code, host page
  or public live-round page. The bracket is a sibling feature with its own
  tables.
- Forge decks as entries.
- Server-side verification of a game result against SpacetimeDB. The
  bracket owner is the only one who can write results, it is their own
  bracket, and the manual-record path exists anyway.
- A solo mode for `/play` games that are not part of a bracket. The solo
  table is built so it could be exposed later, but no lobby entry point is
  added now.
- Cross-device resume of a solo game.
- Spectating a solo game, stats, history pages, or an "all brackets"
  public listing.
- An AI opponent of any kind.

## Anti-goals (what would make this a failure even if it works)

- A solo game that ever shows a "Waiting for <deck>…" state, a consent
  dialog that only the other seat could answer, a disconnect-claim banner,
  a pause request, or a rematch offer. The other seat is you.
- A solo game where a single battle needs the human to change the seat in
  hand. Block, enhance, win, choose the soul, end the turn: none of those
  may require a swap.
- Hidden information in a solo game. If you have to right-click "reveal"
  to see the other deck's hand, it is wrong.
- Losing a result. A game that finishes on the table but does not show
  up on the bracket, with no way to put it there, is the worst outcome.
- A bracket page that is a spreadsheet. Match blocks without deck art,
  seed numbers on display, or a champion announced in a toast, miss the
  point.
- Decorative flourishes: confetti, trophy emoji, gradient titles,
  bouncing cards, toasts that repeat what the screen already shows. The
  write-in of a result and the champion panel's entrance are the only
  motion. The site's design rules in `prompt_context/design_system.md`
  apply (slate palette, green only for actions and the winning state,
  Geist for UI, Cinzel only for the page H1).
- Any regression to normal two-human games: a solo flag must be inert
  when absent.
- Breaking the deployed SpacetimeDB module for connected clients (see
  Constraints).

## Routes and entry points

| Route | Who | What |
|---|---|---|
| `/tracker/tournaments` | signed in | Existing page. Gains an outline **New deck bracket** button beside "Host a Tournament" and a **Deck brackets** section listing the user's brackets. The "Host a Tournament" modal is untouched. |
| `/decklist/my-decks` | signed in | The existing multi-select bar (Move to / Delete) gains **Start a bracket**, which opens `/brackets/new?decks=<id,id,…>` with those decks already in. |
| `/brackets/new` | signed in | Create a bracket: three settings plus the deck picker. |
| `/brackets/[id]` | anyone with the link | The bracket. Owner sees play/record/reset controls; everyone else sees a read-only bracket. |
| `/brackets/[id]/join/[gameId]` | signed in (redirects to sign-in with `redirectTo`) | Friend invite page for an online bracket game. |
| `/play/[code]` | existing | Unchanged URL. Learns a `solo` role and `bracket` params from the existing sessionStorage game params. |

`/brackets` with no id redirects to `/tracker/tournaments`.

**The Deck brackets section** on `/tracker/tournaments` sits below the
tournament groups, headed with a small-caps label "Deck brackets" and a
hairline. Hairline rows (`divide-y divide-border/60`), not cards. Each
row: bracket name, "T1 · 6 decks · Bo3", status ("Quarterfinals" /
"Final" as the current round, or "Champion: <deck name>"), created date,
and an overflow with Delete (confirm dialog). Rows link to
`/brackets/[id]`. Empty state: one sentence and the button. The section
loads through a server action on mount, like the rest of that page loads
client-side.

## Data model

One migration, `supabase/migrations/113_deck_brackets.sql`. Four tables,
RLS on all of them. Writes go through server actions in
`app/brackets/actions.ts`; the policies are the backstop.

```
deck_brackets
  id uuid pk
  owner_id uuid -> auth.users, not null
  name text not null
  format text not null         -- 'T1' | 'T2' | 'Paragon' (the family, see lib/formats.ts)
  size int not null            -- 2 | 4 | 8 | 16, derived from the entry count
  best_of int not null         -- 1 | 3 | 5
  status text not null         -- 'active' | 'complete'
  champion_entry_id uuid null -> deck_bracket_entries (set after the entries exist)
  created_at, updated_at, completed_at

deck_bracket_entries
  id uuid pk
  bracket_id uuid -> deck_brackets on delete cascade
  seed int not null            -- pick order 1..n, unique per bracket; never displayed
  deck_id uuid null -> decks on delete set null
  deck_name text not null      -- snapshot at creation
  deck_format text not null    -- snapshot of the deck's own format id (Limited, Unlimited, ...)
  preview_card_1 text null     -- snapshot (card_img_file)
  preview_card_2 text null
  paragon text null

deck_bracket_matches
  id uuid pk
  bracket_id uuid -> deck_brackets on delete cascade
  round int not null           -- 1 = first round
  position int not null        -- 0-based within the round; unique (bracket_id, round, position)
  entry_a_id uuid null -> deck_bracket_entries
  entry_b_id uuid null -> deck_bracket_entries
  winner_entry_id uuid null -> deck_bracket_entries
  is_bye bool not null default false   -- round-1 match with one entry; decided at creation

deck_bracket_games
  id uuid pk
  match_id uuid -> deck_bracket_matches on delete cascade
  game_number int not null     -- 1..best_of, unique (match_id, game_number)
  mode text not null           -- 'solo' | 'online' | 'manual'
  code text null               -- the /play game code for solo and online
  first_entry_id uuid null     -- who goes first (solo: decided by the rule below)
  winner_entry_id uuid null    -- null = in progress
  souls_a int null, souls_b int null   -- optional, for manual records and the writeback
  started_at timestamptz not null default now()
  finished_at timestamptz null
```

Policies: `deck_brackets` select for everyone (the page is shareable),
insert/update/delete for `auth.uid() = owner_id`. The three child tables
select for everyone and write only when the parent bracket's owner is the
caller (an `exists` subquery). Everything the public page needs is in these
rows, so a private deck is never read to render someone else's bracket.

Public read includes a live game's `/play` code. That is the same trust
model as today's `/play?join=CODE` invite links: anyone holding the link
can take the open seat or spectate. A solo game has no open seat. If this
ever needs tightening, the code moves to an owner-only table and the
invite page reads it through an RPC; nothing else in the design changes.

Not stored: series wins (count the games), the "next match" (derived:
round `r` position `p` feeds round `r+1` position `floor(p/2)`, slot
`a` when `p` is even, `b` when odd), round names (derived from size).

Match rows for every round are created at bracket creation, with later
rounds' entries null except where a bye has already advanced someone.
The number of rounds is `log2(size)`.

## Bracket logic

A pure module `lib/bracket/` with no I/O, covered by vitest (the repo's
vitest is node-only; keep it free of DOM and of `lib/cards/lookup.ts`):

- `sizeFor(entryCount)`: the next power of two, 2..16. Entry counts 2..16
  are valid.
- `slotOrder(size)`: the fill order of first-round slots: every match's
  `a` slot from the top down, then every match's `b` slot from the top
  down. Entries are placed in pick order along this list. Consequences:
  the first `size/2` decks each take their own match, opponents fill in
  after, and byes (empty `b` slots) are at most one per match, so a bye
  never meets a bye.
- `roundNames(size)`: 16 → Round of 16, Quarterfinals, Semifinals, Final;
  8 → Quarterfinals, Semifinals, Final; 4 → Semifinals, Final; 2 → Final.
  Match labels: "QF1".."QF4", "SF1", "SF2", "Final", "R16-1".. for 16.
- `buildBracket(entries, bestOf)`: the match rows for every round, with
  byes decided (`is_bye`, `winner_entry_id` set to the present entry, and
  the next round's slot filled).
- `seriesState(games, bestOf)`: wins for each side, `needed =
  ceil(bestOf/2)`, `decided`, `winner`, `nextGameNumber`, and whether a
  game is in progress (a row with no winner).
- `firstEntryForGame(games, entryA, entryB, coinFlip)`: game 1 is the
  coin flip; afterwards the **loser of the previous game goes first**.
  This is my call for the solo table, where the usual pregame roll is
  skipped. Online games keep the normal roll and ignore this value.
- `applyGameResult(bracket, games, matchId, winnerEntryId)`: returns the
  list of row updates: the game row, the match winner when the series is
  decided, the next match's slot, and the champion when the final is
  decided. The server action applies them in order.
- `resetMatchAllowed(bracket, matchId)`: true when the match is not a
  bye and the match it feeds has no games recorded (for the final, always
  true). A reset deletes the match's games, clears its winner, clears
  the slot it fed, and un-crowns the champion if it was the final.
- `matchState(match, games, bestOf)`: `'bye'`, `'waiting'` (a slot is
  still null), `'ready'` (both entries, no game in progress, series not
  decided), `'live'` (a game row with no winner), `'done'`.

## Creating a bracket (`/brackets/new`)

A single page, one server action on submit (`createBracketAction`) that
inserts the bracket, the entries and every match row (byes decided), then
redirects to `/brackets/[id]`. There is no draft state. The page accepts
`?decks=<id,id,…>` and pre-fills those decks in that order (decks that
are not the user's, not public, or of the wrong family are dropped with
an inline note).

**Settings** at the top, in one row on desktop and stacked on a phone:
- Name (text, default "Deck Bracket · Oct 21" using the current date).
- Format: segmented **T1 · T2 · Paragon**. T1 accepts decks whose
  `lib/formats.ts` family is `T1` (Limited, Unlimited, Teams).
- Series: segmented **Bo1 · Bo3 · Bo5**.

There is no size control. The bracket grows with the picks.

**The bracket as you build it** (desktop, ≥ md): the slot area is round 1
itself, drawn as match blocks in a column, the same component the bracket
page uses. Decks land in `slotOrder` as they are tapped, so matchups
appear as you go and the column grows from one block to two, four or
eight as the count crosses each power of two. An empty slot in a block
reads "Bye" once the bracket has started being filled past the current
size's half, and "Tap a deck" before. Tapping a filled slot removes that
deck. A **Shuffle** button re-deals the pick order (only when at least two
decks are in). No seed numbers anywhere. Changing the format removes any
deck whose family no longer fits and says so in a small inline note.

**Phone** (< md): a sticky bar under the header reading "6 decks · 8
slots · 2 byes" (or "4 decks · no byes") with a horizontally scrolling row
of small thumbnails; tapping one removes that deck. The bar stays visible
while the deck grid scrolls underneath. The round-1 column is not drawn on
the phone; the bracket page shows it a second later.

**Deck grid**: reuse the tabs, filters and tiles of the existing
`/play` picker (`app/play/components/DeckPickerModal.tsx` content and
`DeckPickerCard`): **Starter · My decks · Community**, name search, the
sort control, and server pagination through `loadUserDecksPaged`,
`loadStarterDecksAction` and `loadPublicDecksAction`. The format filter is
driven by the bracket's format and locked (those loaders filter by one
format id today; they need a family filter). The picker content must be
extracted so it can render inline (not only inside the modal) in a
multi-select mode: tapping a tile adds the deck; a tile already in shows
a check and tapping it removes it. The existing `data-deck-picker` touch
sizing applies.

**Start bracket** is a primary button, enabled from two decks. On phones
it is in the sticky bar.

Entries snapshot `name`, `format`, `preview_card_1/2` and `paragon` from
the chosen deck. The deck's current card list is read at the start of
each game, not now, so tweaking a deck between rounds is allowed and
intended.

## The bracket page (`/brackets/[id]`)

Server component that loads the bracket, entries, matches and games in one
go (a single query with embeds, or a small RPC), decides `isOwner`, and
renders a client component with the data. The owner's actions call server
actions and then `router.refresh()`.

**Header**: bracket name as the page H1 (Cinzel, per the design system),
a line "T1 · 6 decks · Best of 3 · Semifinals" (the current round, or
"Complete"), a **Share** button that copies the URL (a toast confirms),
and for the owner an overflow with Delete.

**The bracket**:
- Desktop (≥ md): one column per round, left to right, with round names
  as small-caps column headers and a final "Champion" column. Matches are
  vertically centered against the matches that feed them, with 1px
  connector lines in the `border` token drawn with CSS (absolutely
  positioned pseudo-elements or a tiny inline SVG per column gap). 16
  decks: four match columns plus the champion column; the page may scroll
  horizontally inside a container at that size rather than shrinking
  blocks below readable size.
- Phone (< md): one sheet. Every round stacked in a single column under a
  small-caps round header with a hairline, first round at the top. On
  load the page scrolls so the first `ready` or `live` match is in view.
  The champion panel sits on top when the bracket is complete. No round
  switcher.

**Match block** (the design system allows boxes only for floating
things; a bracket is the one place a bounded block is the structure
itself, so draw it with a 1px `border-border/60` hairline and the `card`
tonal step, no shadow, no fill): two rows, deck A over deck B, separated
by a hairline. Each row: 40px cover thumbnail (`preview_card_1`, or the
paragon image for Paragon decks, or a neutral placeholder), deck name
(one line, truncated), and on the right the number of games won in the
series. An empty slot reads "Winner of QF2" in muted text, or "Bye" for a
bye. Above the rows, a small label with the match name ("SF1") and, when
relevant, the series score ("2–1") or "Game 2 live". No "Ready" tag; the
button says it.
- `bye`: the present deck's row normal, "Bye" in the other, no buttons,
  the whole block slightly muted.
- `waiting`: no buttons.
- `ready`: owner sees a primary **Play game N** button (N is the next
  game number; "Play" alone for Bo1) that starts a solo game at once,
  and an overflow (⋯) with **Play online with a friend** and **Record
  result by hand**. For game 2 onward a muted line under the rows says
  who goes first ("Crimson Rush goes first").
- `live`: owner sees **Resume game 2** (returns to `/play/[code]`) and an
  overflow with **Record result by hand** and **Abandon this game**
  (deletes the game row).
- `done`: the winner's row gets the green accent (name in the accent
  color, a 2px accent bar on its left edge) and the loser's row drops to
  `text-muted-foreground` with the thumbnail at 60% opacity. Owner
  overflow: **Reset match** when allowed, with a confirm dialog that says
  what it will undo.
- Any match that involves an entry whose `deck_id` is null (the deck was
  deleted) shows "Deck no longer available" and no Play button; recording
  by hand still works.

**The write-in.** When the page is opened with `?decided=<matchId>` (the
game-over screen's "Back to bracket" and the recovery screen use it), it
plays the paper moment once: that match's winner row takes the accent,
its connector fills to the accent, and the winner's name and thumbnail
fade into the next round's slot, about 500 ms in all, `--ease-out-quart`.
Everything else on the page is still. Recording a result by hand on the
page plays the same write-in after the action returns. The champion
panel's entrance (a fade and a few pixels of rise) keys off the same
moment when the decided match was the final. The param is stripped from
the URL after it plays.

Owner-only **Record result by hand** dialog: pick the winner (two large
buttons with the deck art), optional souls score for each side, save.
It creates a `manual` game row with the winner set and runs the same
advancement.

**Champion panel** (bracket complete): a full-width panel (the `card`
tonal step, no border box) with the champion's two preview cards large,
the deck name in large Geist semibold (Cinzel is reserved for the H1),
"Champion" as a small-caps label above it, and the path below as one line
per round ("Beat Gold Temple 2–0 · Beat Crimson Rush 2–1 · Beat Flood
2–0"; byes are not listed).

**Deep links**: `/brackets/[id]?record=<gameId>` opens "Record result
by hand" for that game (used by the recovery screen);
`/brackets/[id]?decided=<matchId>` plays the write-in.

## Playing a match

**Play game N** on a `ready` match calls `startBracketGameAction(matchId,
'solo')`, which validates (owner, match `ready`, both decks still exist),
picks the first entry (coin flip for game 1, loser of the previous game
after), generates a game code (six uppercase alphanumerics, to keep
collisions with the four-character lobby codes unlikely), inserts the
`deck_bracket_games` row, and returns `{ gameId, code, firstSeat,
deckAId, deckBId, names }`. The client then writes the existing
`sessionStorage['stdb_game_params_<code>']` entry and navigates to
`/play/<code>`. One tap, no dialog. The params gain:

```
role: 'create' | 'join' | 'solo'
bracket?: {
  gameId, bracketId, matchId, gameNumber, bestOf, mode,
  entryAId, entryBId, deckAName, deckBName,
  returnTo: '/brackets/<id>'
}
soloDeckBId?: string      // solo only: the second deck to load
firstSeat?: 0 | 1         // solo only
```

Which entry is seat 0: the match's `entry_a` is always seat 0 and
`entry_b` seat 1, for both modes. For online mode the host always plays
entry A.

**Play online with a friend** (overflow) calls the same action with
`'online'` and follows the ordinary `create` path (see "Online mode").

## Solo mode on the table

### Server (SpacetimeDB module)

Follow `spacetimedb/CLAUDE.md`. New state goes in a **marker table**, not
in new `Game` columns, following the `ForgeGame` / `PregameState`
precedent (new `Game` columns change the row shape for deployed
clients).

```
SoloGame { gameId: u64 (pk), activeSeat: u64 }   -- activeSeat = the seat in hand
```

**Who acts.** Every reducer resolves the acting Player row through
`findPlayerBySender`. Today it returns the sender's one row. It gains an
optional hint, `{ cardId }`, `{ seat }` or `{ playerId }`, and in a solo
game (a `SoloGame` row exists and the sender holds both rows) it returns:

- the card's owner row for `{ cardId }` (shared Paragon cards, owner
  `0n`, fall back to the seat in hand);
- the row with that seat for `{ seat }`;
- that row for `{ playerId }`;
- the seat in hand when there is no hint.

Outside a solo game the hint is ignored and the sender's row is returned
as today, so every existing owner and seat check still applies to two
humans. In a solo game the hint makes each gated reducer act as the seat
the action belongs to, so the human never has to change the seat in hand
to block, enhance, win, choose a soul, or end the turn. The builder must
audit every reducer that throws on an owner or seat mismatch and pass the
right hint. Known sites:

| Gate | Hint |
|---|---|
| `enter_battle` ("your own cards into battle") | `{ cardId }` |
| `surrender_lost_soul` ("your own Lost Souls") | `{ cardId }` |
| `rescue_lost_soul` ("cannot rescue your own") | `{ seat }` = the seat that does not own the soul |
| `set_phase`, `end_turn`, `end_battle`, `resolve_battle`, `release_turn_stop` ("Not your turn" / turn player) | `{ seat: game.currentTurn }` |
| `surrender_soul` (defender in T1, attacker otherwise) | `{ seat }` computed from `format` and `battleAttackerSeat` |
| `approve_zone_search`, `deny_zone_search`, the target halves of opponent actions (`opponent_keep_one_shuffle_draw`, `three_nails_reset_execute`, …) | `{ playerId: req.targetPlayerId }` |
| `complete_zone_search`, `move_opponent_card`, `shuffle_opponent_deck`, `random_opponent_hand_to_zone`, `opponent_shuffle_and_draw`, … (requester halves) | `{ playerId: req.requesterId }` |
| `draw_card`, `shuffle_deck`, `reveal_*`, hand reorder, and every other "my zone" reducer | none (seat in hand) |

Other reducers and changes:

- `create_solo_game({ code, format, supabaseUserId, displayNameA,
  deckIdA, deckDataA, paragonA, displayNameB, deckIdB, deckDataB,
  paragonB, firstSeat })`: inserts the `Game` row, **two** `Player` rows
  with the **same** identity (seats 0 and 1, display names = deck names),
  runs the same card creation, shuffle and opening draw as a normal join
  for both seats (including the Paragon shared soul deck), sets
  `currentTurn` to `firstSeat`, inserts `SoloGame { activeSeat:
  firstSeat }`, and leaves the game in exactly the state a normal game is
  in right after `finishPregame`: `status: 'playing'`, `pregamePhase:
  ''`, `turnNumber: 1`, `playingStartedAtMicros` set, `GAME_STARTED`
  logged. The dice ceremony and the star/soul windows are skipped
  entirely (my call: both windows pace two humans; in solo the player
  puts star cards into play by hand like any other sandbox move, the way
  Paragon already skips them).
- `solo_swap_seat({ gameId })`: the sender must be the solo identity;
  flips `activeSeat`.
- `performTurnFlip` (the one place the turn changes hands): in a solo
  game, set `activeSeat` to the seat whose turn it now is.
- `request_zone_search` and `request_opponent_action`: in a solo game,
  insert the request with `status: 'approved'` straight away, the way
  `pass_initiative` already does, so the requester's existing
  "approved request" client effect runs with no prompt. **Exception:**
  the two actions where the target makes a choice of their own
  (`keep_one_shuffle_draw` for Philip's Daughters and `three_nails_reset`)
  stay `'pending'` in solo; the client shows their prompt to the human
  and the target-half reducers act as the target through the `{ playerId
  }` hint. No seat change is involved.
- `register_presence` (and anything else that revives or inspects "the
  sender's row"): act on **every** row matching the identity, so the
  other seat is never left disconnected and the five-minute disconnect
  claim never arms in a solo game. Audit `onDisconnect`,
  `handle_disconnect_timeout`, `claim_timeout_victory`,
  `cleanup_stale_games`, `leave_game`, `send_chat`, and the `createdBy`
  checks in `update_lobby_message` / `set_game_public` for the same
  assumption; a solo game must never produce a TIMEOUT action.
- `join_game` and `join_as_spectator`: a solo game has both seats filled
  and is never `'waiting'`, so joining fails naturally; make sure the
  error is the ordinary "game not found / not joinable" and not a crash.
- Everything else is untouched. The flag is inert when the row is absent.

Publish with the `spacetimedb-deploy` skill. Pushing the branch publishes
the **dev** module through CI; only a merge to main publishes prod.

### Client (`app/play/[code]/client.tsx`, `useGameState`, `MultiplayerCanvas`)

- **Create path**: with `role: 'solo'`, load both decks with two
  `loadDeckForGame` calls (both belong to, or are public to, the owner),
  then call `createSoloGame`. The waiting room and pregame screens never
  render for a solo game; the table appears once the game row is
  `'playing'`.
- **Who am I**: `useGameState` subscribes to `SoloGame` for the game. When
  a row exists, `myPlayer` is the seat equal to `activeSeat` and
  `opponentPlayer` is the other seat, regardless of identity. Everything
  downstream (viewer-relative `ownerId`, layout, cards) follows without
  change. Both the client and `MultiplayerCanvas` call `useGameState`,
  and both must pick the same way; deriving it from the subscription
  (not a prop) guarantees that. `useGameState` also exposes `isSolo`.
- **Both sides are yours**: in a solo game the controls that today render
  only for "my" seat render for the human whatever the seat in hand:
  End Turn and the phase tabs (`isMyTurn` is true for control purposes;
  the turn label still names the deck whose turn it is), Win Battle /
  Battle Lost, the soul chooser (`BattleResolutionUI` `isChooser`), and
  the band's "Waiting for <deck> to choose a soul…" line becomes "Choose
  a soul for <deck>". The far hand is face-up and its cards are
  draggable to the far territory and into the band (they already are
  when visible); `enter_battle` then acts as that card's owner, which is
  a block. Pending requests of the two target-choice actions render
  their consent dialog and keeper picker to the human whatever the seat
  in hand (`incomingSearchRequest` matches either of my rows in solo;
  `approvedSearchRequest` likewise).
- **Reveal everything**: the hand and reserve visibility helpers take a
  `revealAll` flag (true when solo). The opponent's hand renders face-up
  in its usual place at the top, the opponent's reserve is browsable, and
  face-down cards in play are visible to both. Do **not** use the
  `toggle_reveal_hand` snapshot mechanism; it hides cards drawn later.
- **Swap pill**: a persistent pill showing the deck in hand with a swap
  icon, placed where one thumb reaches it on a phone and where it does
  not cover the hand or the battle band; the builder picks the exact spot
  against the current `/play` layout. One tap calls `solo_swap_seat`,
  which puts the other deck's hand at the bottom and points the draw
  shortcut at its deck. A keyboard shortcut on desktop, on a key that
  `/play` does not already use, listed wherever `/play` lists its
  shortcuts. The pill's label changing and the board re-rendering from
  the other side are the only feedback; no toast. Most swaps happen by
  themselves at End Turn.
- **Hidden in solo**: chat, pause/resume, rematch, the phase-stop
  toggles and hold banners, the action-priority and initiative request
  buttons, the "ask to reveal hand" and "ask to reveal reserve" items,
  the disconnect countdown and claim-victory banner, and the opponent
  connection indicator.
- **Concede** in solo concedes for the deck in hand; the existing
  confirm names it ("Concede as Crimson Rush?").
- **Resume**: reopening `/play/<code>` with the solo params present
  re-attaches to the running game through the identity, as today;
  `register_presence` revives both seats.

### Lifetime and recovery of a solo game

- **One sitting.** A solo game lives as long as the tab is open plus the
  module's existing idle rule: when every seat is disconnected and no
  action has been logged for 30 minutes, `cleanup_stale_games` marks the
  game finished with no result. Closing the tab disconnects both seats at
  once (they share an identity), so a solo game left for more than half
  an hour is over. This is accepted, not worked around: the feature is an
  afternoon with your decks, not a correspondence game. The bracket row
  stays `live` until the owner deals with it.
- **Same browser only.** The SpacetimeDB identity is a per-browser token,
  so a solo game can be resumed only from the browser that started it.
  **Resume game N** on the bracket page rewrites the sessionStorage params
  and navigates; this works in the same browser and fails cleanly
  elsewhere.
- **Recovery screen.** When the client opens a bracket game and finds it
  (a) finished with no `WIN` / `RESIGN` / `TIMEOUT` action, or (b) running
  but with no seat belonging to this identity (started on another
  device), it shows one screen instead of the table: "This game ended
  without a result (left for more than 30 minutes)" or "This game was
  started on another device", with **Start game N over** (deletes the
  game row through `abandonBracketGameAction`, creates a fresh one via
  `startBracketGameAction` with the same mode, navigates), **Record
  result by hand** (opens the bracket page's dialog via
  `/brackets/[id]?record=<gameId>`), and **Back to bracket**. The
  bracket page's own `live` overflow (Abandon, Record by hand) remains
  the other way in.

### Game over in a bracket game (solo and online host)

When the game row becomes `'finished'` and the params carry `bracket`,
the host's client (the bracket owner; in solo that is the only client):

1. Resolves the winner **seat** explicitly from the last game action:
   `WIN` → that player won; `RESIGN` → that player lost; `TIMEOUT` can
   only happen in online mode and means the claimer won. Do not reuse the
   viewer-relative `deriveEndReason`.
2. Maps seat 0 → entry A, seat 1 → entry B, counts each side's redeemed
   souls for `souls_a` / `souls_b` (`gameState.soulsRescued` already
   has them), and calls `recordBracketGameResultAction({ gameId,
   winnerEntryId, soulsA, soulsB })`. The action is idempotent: if the
   game row already has a winner it returns the current series state and
   changes nothing. It runs `applyGameResult` and returns the new series
   state and, when the series is decided, the next `ready` match in the
   bracket if any.
3. Shows the bracket variant of the game-over overlay instead of the
   rematch one: result line ("Crimson Rush wins game 2"), a series line
   with filled/empty pips ("Series 1–1"), then either
   - **Play game 3** (primary; calls `startBracketGameAction` with the
     same mode and navigates, so a solo series plays straight through)
     and **Back to bracket**; or, when the series is decided,
   - "Crimson Rush advances to the final" / "Crimson Rush is the
     champion", **Back to bracket** (primary, navigates to
     `/brackets/[id]?decided=<matchId>` so the write-in plays) and, when
     another match is ready, **Next match: Gold Temple vs Flood**, which
     starts that match's game 1 directly (solo) and navigates to the
     table. That button also stores the decided match id in
     sessionStorage so the bracket page plays the write-in the next time
     it is opened.
   Rematch is hidden for both players in any bracket game, because a
   rematch reuses the same game id in place and would corrupt the
   writeback. The friend's overlay (online mode) shows the result and the
   usual leave action only.
4. If the writeback fails (offline, expired session), the overlay says so
   and keeps a **Retry** button; the bracket page's "Record result by
   hand" is the fallback. The bracket page shows the game as `live` until
   a result arrives.

A finished game is deleted from SpacetimeDB after 24 hours, so the
writeback happens on the finish transition, not later.

## Online mode with a friend

Kept because it was asked for; off the main path (an overflow item), and
the last thing built so it can be dropped from the first PR without
touching anything else.

- The host starts the game from the overflow. Their client follows the
  ordinary `create` path (`isPublic: false`) with deck A, plus the
  `bracket` params. The waiting room's invite link is replaced, for
  bracket games, by `/brackets/[id]/join/[gameId]` (the ordinary
  `/play?join=CODE` link would ask the friend to choose their own deck).
- `/brackets/[id]/join/[gameId]`: requires sign-in. Shows "<host name>
  invited you to play **<deck B>** against **<deck A>** · Game 2 of the
  semifinal in <bracket name>" with both decks' art, and a **Join game**
  button. The button writes the `join` params with `bracket` and deck B's
  id and name, and navigates to `/play/<code>`. If the game is already
  full, finished, or abandoned, the page says so instead.
- The client's join path, when `bracket` is present, loads the deck
  through a new `loadBracketSeatDeckAction(gameId)` instead of
  `loadDeckForGame`. The action checks that the game row is `online`,
  unresolved, and that the caller is not the bracket owner, then returns
  deck B enriched exactly as `loadDeckForGame` does, regardless of deck
  ownership (the bracket owner designated the deck). The usual
  `join_game` call follows; the self-join guard stays.
- Everything else is a normal game: pregame roll, hidden hands, consent
  prompts, stops, pause. The friend sees a normal table with no bracket
  controls, except that rematch is hidden.
- The host's client does the writeback at the end as above. If the host
  closed their tab before the end, the game stays `live` on the bracket
  and the host records it by hand.
- Per game, a fresh invite link. "Play game 3" from the host's game-over
  screen creates the next game row and takes the host straight back to a
  new waiting room with a new link.

## Design notes

- Palette, type and spacing per `prompt_context/design_system.md`. The
  bracket and picker pages are public-site surfaces, so shadcn/Tailwind,
  not the goldfish or Forge systems.
- Green is used for exactly two things on these pages: primary action
  buttons (Start bracket, Play game N, Join game) and the winning side of
  a decided match. Nothing else is tinted.
- Deck art is the identity of each entry; every place a deck is named
  near its card (slots, chips, match rows, the invite page, the champion
  panel) shows the cover thumbnail. Use `getCardImageUrlOrNull` from
  `app/shared/utils/cardImageUrl.ts` and the paragon image for Paragon
  decks, with a neutral placeholder when there is no art.
- Touch targets ≥ 44px on every control on the picker, the bracket and
  the swap pill. The bracket page must be usable one-handed in portrait.
- Copy is plain: "Play game 2", "Resume game 2", "Record result by hand",
  "Reset match", "Choose a soul for Crimson Rush". No exclamation marks.

## Constraints

- **Worktree, absolute paths, narrow `git add`**, per the repo rules.
- **SpacetimeDB**: new table only; if a column must be added to an
  existing table, append it at the end. Publish via the
  `spacetimedb-deploy` skill after any change to `spacetimedb/src`, then
  regenerate bindings. Read `spacetimedb/CLAUDE.md` first. Reducers
  cannot make network calls; the writeback is a client effect plus a Next
  server action.
- **Bundle size**: `lib/cards/lookup.ts` (the whole card catalog) must
  never be imported into a client bundle. Deck enrichment for games
  stays in server actions; the bracket pages render from the snapshotted
  entry fields only.
- **PostgREST** returns at most 1000 rows per unbounded select; a bracket
  has at most 15 matches and 75 games, so single queries are fine, but
  the "my brackets" list should still order and limit.
- **RLS** on every new table; server actions re-check the owner with a
  user-scoped read, like `requireHost` does for tournaments.
- **Migration** number 113. Apply to prod only when the PR is ready to
  merge (migrations are applied via the Supabase MCP, not in CI).
- Vitest is node-only here: logic under test lives in `lib/bracket/` and
  takes plain data.
- No new dependencies.

## Testing

- `lib/bracket/`: `sizeFor` and `slotOrder` for 2..16 entries (no
  bye-vs-bye for any count), round names and labels, bye resolution at
  creation, series math for Bo1/Bo3/Bo5 (including "needs one more" and
  "in progress"), the first-player rule, advancement into the correct
  next slot for every position, champion on the final, reset
  eligibility, and match state derivation.
- `spacetimedb/__tests__/`: unit tests for the pure helper behind the
  hinted seat resolution (for example `pickSoloRow(rows, hint,
  activeSeat, cardOwnerId)`), following the existing pattern of testing
  pure modules outside `src`.
- Server actions: `tsc` clean. A manual pass per the `verify` skill
  (minted session, dev server, Playwright) covering: create a 6-deck Bo3
  bracket on a phone-sized viewport (two byes), play a solo game to a
  resignation, confirm the bracket updated with the write-in and the
  overlay offered game 2, record a game by hand, reset a match, and open
  the bracket signed out.
- Solo table walk against the dev module, with **zero manual swaps**:
  attacker draws, plays a hero into the band; the far deck's evil
  character is dragged in as the block; an enhancement from each hand;
  Win Battle; the soul chooser appears and a soul is chosen; End Turn
  flips the seat in hand. Also: both hands visible, an opponent-deck
  search runs with no prompt, no disconnect banner after five minutes
  idle.

## Left to the builder

- Exact placement and look of the swap pill and the keyboard key.
- How the picker content is extracted from `DeckPickerModal` (a shared
  `DeckPickerContent` with a `selection` mode is the obvious shape) and
  how the family filter reaches the paged loaders.
- Connector-line implementation on the desktop bracket, and how the
  "bracket as you build it" column shares the match block component.
- Whether the bracket page query is embeds or an RPC.
- The six-character code generator and the sessionStorage param shapes
  beyond the fields named above.
- Which existing toast and dialog primitives to use.

## Review outcomes

Builder check (four questions, all settled here): solo games keep the
module's 30-minute idle rule with a recovery screen; resume is
same-browser only; the two target-choice card effects stay real prompts
answered by the human through the `{ playerId }` hint; game codes are
readable with the bracket link, matching the existing invite-link trust
model.

Adversarial review (verdict: sign off with the changes below folded in):

- **Blocker, fixed:** seat-gated reducers would have cost four or five
  swaps per battle. Reducers now resolve the acting seat from the
  action's own context in solo (the hint table above), and the client
  shows End Turn, phase tabs, battle buttons and the soul chooser to the
  human whatever the seat in hand.
- One-tap play: "Play game N" starts the game; the mode dialog is gone;
  "Next match" starts the next game directly.
- Friend mode: the reviewer recommended cutting it. It stays because the
  brief asked for it, demoted to the overflow and built last.
- The write-in moment on return (`?decided=`).
- Byes, with the size derived from the pick count (2..16 decks).
- Phone bracket is one stacked sheet, no round switcher.
- Entry points: an outline button beside "Host a Tournament" and
  "Start a bracket" in the My Decks selection bar; the modal is untouched.
- Round 1 is the slot area on desktop; seed numbers are never shown.
- No toast on swap; no "Ready" tag; the concede confirm names the deck.

## Calls I made (for review)

1. Separate tables rather than extending the Swiss tracker's
   `tournaments` / `participants` / `matches` (one match there is one
   game between two named people; nothing models decks, series or
   elimination).
2. Bracket size derived from the pick count, 2 to 16 decks, byes in the
   lower first-round slots, no duplicate decks.
3. Pick order decides placement; Shuffle re-deals it; seeds never shown.
4. Solo games skip the entire pregame (roll, choose, stars, souls); game 1
   first player is a coin flip, later games go to the loser of the
   previous game.
5. The seat in hand is server state (`SoloGame.activeSeat`), End Turn
   moves it, and every gated reducer acts as the seat the action belongs
   to rather than the seat in hand.
6. Consent is auto-approved server-side in solo except for the two
   target-choice effects, which stay real prompts.
7. The bracket page is readable by anyone with the link; only the owner
   writes.
8. Results are trusted from the owner's client with an idempotent action
   and a manual fallback, no SpacetimeDB cross-check.
9. Rematch is hidden in every bracket game, for both players.
10. The friend loads the designated deck through a bracket-scoped server
    action rather than through new SpacetimeDB seat pre-assignment.
11. Friend mode kept against the reviewer's advice, off the main path.
12. A solo game left for 30 minutes is over, with a recovery screen.
13. Resuming a solo game works only in the browser that started it.
14. Game codes are readable with the bracket link.
