# Public Live Round Page

**Date:** 2026-09-26
**Status:** Implemented (PR: feat/public-live-round-page)
**Driver:** At a 20–60 player event only the host can see pairings and standings.
Players crowd the laptop between rounds, and the join page literally said
"Coming soon: check your round pairings". Results only become public after the
event ends and the host publishes. This page gives every player their table,
the round timer and the live standings on their own phone.

## 1. Route

`/t/[code]` — public, no auth, mobile-first. `code` is `tournaments.code`, the
same six-character Crockford code the QR Join flow already hands to players
(`/join/[code]`), so anyone who scanned in has it. The page is `force-dynamic`
and `robots: noindex` (an ephemeral event screen, not content).

States:

| Condition | Rendered |
|---|---|
| unknown / invalid code | `notFound()` |
| tournament exists, `has_started = false` | "This event hasn't started yet" + event name; keeps polling and flips to the live view when the host presses Start |
| started, current round staged but not started | pairings visible, status "waiting for the host to start the round" |
| round running | countdown from `rounds.started_at + round_length` |
| round completed, next not yet paired | "Round complete — waiting for the next round" |
| `has_ended` | final standings, podium tint, and an "Official results" CTA when `results_published` |

## 2. Data access

All tournament tables are host-only under RLS, so the page reads through one
`SECURITY DEFINER` RPC — `public.get_public_round_view(p_code text) returns
jsonb` (migration `109_public_round_view.sql`), granted to `anon` and
`authenticated`.

- Returns `null` unless a tournament with that code exists **and**
  `has_started`. Unknown code and not-started look identical from outside.
- Returns only: `server_now`; the tournament's `id, name, current_round,
  n_rounds, round_length, max_score, has_started, has_ended,
  results_published, deck_format, category, starting_table_number,
  numbering_mode`; every `rounds` row (`id, round_number, started_at,
  is_completed`); every `matches` row (`id, round, match_order, table_number,
  player1_id, player2_id, player1_score, player2_score, winner_id, is_tie`);
  every `byes` row (`id, round_number, participant_id`); every participant
  (`id, name, match_points, differential, dropped_out`).
- Never returns emails, `user_id`, `host_id`, deck submissions or join blocks.
  Verified on prod with a text scan of the JSON for `email`, `user_id`,
  `host_id` and `@`.
- Matches carry `round` (an integer), not a `round_id` — that is how the
  tracker stores them; rounds are joined on `round_number` client-side.

The server action `getPublicRoundView(code)` (`app/t/[code]/actions.ts`)
normalizes the code with `normalizeJoinCode` and calls the RPC through the
ordinary anon server client. It returns `{ ok: false }` on a transport error so
the client keeps the last good view instead of flipping to "not started".

The event name for the not-started state is the one thing the RPC cannot
provide (it is `null` by contract until Start). `getPendingEvent(code)` reads
`name, has_started` with the admin client and returns the name only while
`has_started` is false — the same exposure as the join page header.

## 3. Standings — one implementation

The client ranks players with `buildStandings` from
`components/ui/StandingsTable.tsx`, the exact function behind the host's live
Standings tab (which itself delegates to `orderByTiebreakers` in
`lib/tournament/standings.ts`). `lib/tournament/liveRound.ts` only maps the RPC
JSON into that function's inputs:

- byes count once their round has `started_at` (Option C, migration 039),
- `max_score` falls back to 5,
- drop-outs are excluded from the ranking and listed underneath.

So MP, differential, W-L-T, byes, places and shared places are byte-for-byte
what the host sees. No tiebreaker logic was forked.

## 4. Liveness and the clock

- The client polls the server action every 10 s while the tab is visible,
  refetches immediately on `visibilitychange`/`focus`, and shows
  "Updated Xs ago" (or "Couldn't refresh — retrying"). No Supabase realtime:
  host-only RLS would block the subscription anyway.
- Every response carries `server_now`. The client stores
  `offset = server_now − Date.now()` and `useRoundCountdown` gained an optional
  `clockOffsetMs` parameter, so a phone whose clock is five minutes off still
  shows the host's countdown. Urgency colours follow the host timer's 25 % /
  10 % thresholds.

## 5. UI

Mobile-first, quiet, data-dense; tonal surfaces rather than 1 px rules; no
focus rings on the input; green only on the results CTA.

- **Header:** event name (Cinzel), category/format chips, "Round X of N" with
  status text and the countdown.
- **Find your name:** a sticky input under the top nav. Matching is case- and
  whitespace-insensitive and prefix-based on the full name or any word, so
  "anders" finds "Alice Anderson". An exact match wins; a unique match pins a
  card with the player's table (or seat pair in seats mode), opponent, score
  and result, plus their current place / MP / diff / record, and highlights
  their rows. The name is remembered in `localStorage` under
  `live-round-name:<code>`.
- **Pairings tab:** the current round in table order — table number, both
  players with souls once scored (winner bold, loser muted) — byes last.
  Legacy rows with no `table_number` are numbered positionally from
  `starting_table_number`, the same fallback the host page applies.
- **Standings tab:** rank, player, W-L-T, MP, diff, byes — the host's
  columns — as stacked rows on phones and a table from `sm` up, styled like
  the public results page. Podium tint only once the event has ended.

## 6. Entry points

- `/join/[code]`: the "Coming soon" paragraph is gone. A checked-in player on
  a started event gets a full-width "Live pairings & standings" button;
  before Start the "all set" note links to the page. A player who arrives
  after Start (joining closed) also gets the link.
- Host page: a "Live view" button beside "QR Join" opens `LiveRoundDialog` —
  the `/t/[code]` link with a copy button and a QR (same `qrcode.react`
  component as QR Join), labelled "Live pairings & standings for players".
  An event that never enabled QR Join has no code, so the dialog offers to
  create one (this is the same switch as enabling QR Join; joins still close
  at Start).

## 7. Out of scope

- Score reporting by players (the join page no longer promises it).
- Browsing earlier rounds' pairings; the current round is what matters at the
  table, and the standings tab carries the cumulative picture.
- Disabling QR Join clears `tournaments.code`, which also kills the live page
  for that event. Acceptable for now; a separate live-page code would be the
  fix if hosts hit it.

## 8. Verification

- `lib/tournament/__tests__/liveRound.test.ts`: name matching, clock-offset
  timer math, round phase, RPC→standings mapping (including the started-round
  bye gate and the max_score fallback), pairings ordering and the pinned
  player's perspective.
- RPC probes on prod: ended event → full JSON with no `email`/`user_id`/
  `host_id`; a not-started event (a probe row inserted and rolled back inside
  one transaction) → `null`; bogus / over-long / null codes → `null`.
- Playwright at 390×844 and 1440×900 against an ended event; the standings
  match `/tournaments/results/[id]` for the same tournament.
