# Join a tournament with a deck read from a photo

## Why

A host asked how close the site is to deck check and decklist submission. Joining by code, the legality check
on join, the frozen copy of the deck per player and results linked to decklists all shipped with
`2026-07-27-qr-join-decklist-submission-design.md`. What a player at a table still lacked was a way to hand in
the physical deck in front of them without first building it in the deck builder.

## What

The join page's deck picker (`app/join/[code]/DeckPicker.tsx`) has a fourth tab, **Photo**, hosting the deck
photo reader (`DeckPhotoReader`) the way `/decklist/generate` does. Under the tray is **Use this deck**:

1. It is off until every row has an answer: no unread, not-found or unpicked rows, no Lost Souls left to
   pick, and no photo that failed to read. Only matched rows are saved, so a deck with rows left out could otherwise pass as a smaller legal deck.
2. It calls `createDeckFromScanAction` with the event's format (`eventFormat`). The action checks the deck
   against that format first, with the same bar the join uses (`valid` and no `card-not-found`), and returns the
   issues without saving when it fails. The tray stays editable, so the player fixes a row or adds a photo.
3. When the deck is legal it is saved as a private deck in the player's My Decks, under the event's format, and
   its id goes to the picker's `onSelect`. From there the join and the change-decklist flow are unchanged: the
   join action runs the authoritative check and stores the snapshot.

## Not in this change

- Players without an account: joining by code needs sign-in.
- A host reading a photo on behalf of a typed-in player.
- Any change to scan access or limits (`SCANNER_OPEN`, 20 photos per 10 minutes per player, 1,500 per 30 days
  site-wide). A large event could use a real share of the site-wide cap.

## Calls made while building

- Tab labels are short (My decks, Community, Link, Photo) so four fit on a phone.
- On a phone the Photo tab runs to the edges of the join card; the tray's rows need the width.
- The deck keeps the reader's default name ("Deck from photo" with the date).
- In the change-decklist view the picker sits below the registration box, not inside it, so the Photo tab
  gets the same width there.
- Once the deck is saved the button stays live and hands the same deck over again, so a failed submit (venue
  wifi) can be retried without saving a second deck.

## Follow-up: the walk a player actually takes (2026-11-11)

A critic walked the flow as a player at the table. What changed in response:

- **One press to join.** On the join form the photo tab's button is "Join with this deck": the deck is checked,
  saved, and the player is joined. The page's own Join steps aside while the photo tab is showing. In the
  change-decklist view the same button reads "Submit this deck".
- **A bar that stays in view.** The submit bar sticks to the bottom of the screen while the player works down the
  rows. It shows what is left as two jumps, "N rows to check" (walks to the next flagged row) and "N Lost Souls
  to pick" (opens the picker), and the main and reserve counts once nothing is left. The shared reader passes
  these jumps to any host's footer (`jumps` on the footer context).
- **The photo tab opens by itself** when the player has no saved decks, and when a photo tray is waiting from
  before a reload.
- **Issues stay up.** The not-legal box no longer disappears on the first edit; it is dimmed and headed "From
  your last check". Pool, size and reserve issues carry a line on what usually fixes them.
- **Copy.** The gate tells the player to tap the right card and to remove a row only if the card is not in the
  deck. The join page has its own first-photo tips and drops the collection-scanner link (`tips` and
  `hideCrossLink` on the shared reader). The shared capture tip "Hold the phone along the rows" is now "Stand
  where you would read the cards, so the titles are the right way up in the photo."
- **Join page.** A reason sits where a greyed-out Join gave none. The change-decklist view hides "You're all
  set" while the picker is open, says the current list stays until a new one is accepted, and shows errors above
  the picker. "Open in deck builder" opens a new tab. The card is wider on desktop.
- **Deck name.** The saved deck is named after the event ("<event> deck").

Left alone on purpose: the every-row-answered gate (no "accept all guesses"), the check before save, the shared
row layout, and Lost Soul "Skip" (a deck without its Lost Souls fails the check anyway).

Not done: marking the current guess among a flagged row's suggestion chips; card counts and a view link on the
registered card; an outline "Add another photo" once the tray has photos.
