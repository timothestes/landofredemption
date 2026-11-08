# Forge card versioning — the mental model

Context handoff for anyone (human or agent) working on the Forge's card
lifecycle. Written 2026-07-07 after migrations 072–076 landed (PR #169).

## The one-paragraph model

A card has **three layers**. The **working draft** is a scratchpad that
autosave overwrites continuously — it has no history and creates no records.
A **proposal** freezes the saved working draft so another elder can review it.
A **version** is a permanent checkpoint row, minted only by two deliberate
acts: **accepting a proposal** or **releasing to playtesters**. Typing never
creates a version; decisions do.

```
 typing ──autosave (~700ms)──▶ working_snapshot        (scratch, no history)
                                    │
                     "Propose changes" (freezes saved draft)
                                    ▼
                              card_proposals            (open → accepted/denied/superseded)
                                    │ accept
              ┌─────────────────────┴──────────────────────┐
        card in Draft                                card In playtest
              ▼                                             ▼
   card_versions vN 'draft'                    card_versions vN 'published'
   (elder-only iteration record;               (what playtesters see; previous
    card STAYS Draft)                           published row → 'superseded')

 "Release to playtesters" (from the working draft, optional note)
              ─────────────────────────────────▶ vN 'published', card → In playtest
 "Mark final"      : flips current 'published' row → 'approved' (no new version)
 "Reopen testing"  : flips it back (no new version)
```

## Why autosave exists (and why it is NOT versioning)

`forge_cards.working_snapshot` is the live editing surface. The studio
autosaves ~700ms after the last keystroke (plus a flush when you navigate
away) so work is never lost and presence/collaboration sees fresh state.
Each save **overwrites** the previous one — there is deliberately no
keystroke-level history. If a change is worth remembering, checkpoint it by
proposing it. **Solo designers included:** propose → self-accept is the
intended way to record your own iteration; nothing else will.

## How each version status comes to exist

| `card_versions.status` | Minted by | Who can see it | Meaning |
|---|---|---|---|
| `draft` | Accepting a proposal on a **Draft** card | Elders/owner/superadmin only | Pre-release iteration record. Never superseded, never released; permanent history. |
| `published` | **Release to playtesters** button, or accepting a proposal on an **In playtest** card | Playtesters (granted) + elders | The current playtest version. Exactly one per card; the previous one flips to `superseded`. |
| `approved` | **Mark final** (flips the current `published` row in place) | Playtesters (granted) + elders | The finalized version. Reopen flips it back to `published`. |
| `superseded` | Automatically, when a newer `published` version replaces the old one (or on Shelve/Return for published/approved rows) | Elders only | Retired release. Draft rows are never turned into this. |

Version numbers are one monotonic sequence per card across all statuses —
if a card iterated four times in draft, its first release is **v5**. That is
informative, not a bug: History diffs v5 against v4 (the last signed-off
iteration).

## Proposals: the review loop

- **Propose changes** (button beside "Open proposals" on the card page)
  freezes the card's **saved** working draft server-side with a mandatory
  summary. Any Forge member may propose; elders accept/deny.
- The proposal's `base_version_id` = the card's latest version of ANY status
  at propose time (null only for a never-versioned card — those render as
  "New card — first proposal" instead of a diff).
- **Accept** (elder): checkpoints the proposed snapshot as a version (table
  above), folds it into the working draft, closes sibling open proposals as
  `superseded`. On a Draft card the dialog says so explicitly: nothing is
  released.
- **Deny** (elder): requires a reason, stored as a proposal-anchored comment.
- **Release resolves open proposals** (migration 083). Releasing also mints a
  version, so it would otherwise leave open proposals permanently
  un-acceptable. Instead, in the same transaction: the oldest open proposal
  whose snapshot **equals what is being released** closes as `accepted`,
  pointing at the new version — the release *is* the acceptance, and its
  summary lands in History beside the release note. Every other open proposal
  closes as `superseded`. Propose-then-Release is therefore a supported path,
  not an error. Only one accept per release; a non-elder owner calling the RPC
  directly supersedes all and accepts none.
- **Stale base**: a proposal whose base is no longer the card's latest version
  cannot be accepted — accepting closes it as `superseded` and returns null.
  Since 083 this is only reachable as a race (someone releases while another
  elder has the review open), not the routine Propose-then-Release path.
- Proposal-anchored comments (deny reasons, accept notes) are **undeletable**
  — they are the decision record.

## Where the "why" of a change lives

- **Release note** — optional "What changed?" in the Release dialog, stamped
  atomically on the version row (`card_versions.note`).
- **Proposal summary** — mandatory at propose time; History shows it beside
  "Accepted → vN".
- **Accept note / deny reason** — proposal-anchored comments in History.

## Where versions surface in the UI

- **Card page → History**: every version ("vN updated" for drafts,
  "vN released" otherwise) with author, time, note, status pill, and an
  expandable field diff vs the previous version; proposal outcomes with
  reasons; lifecycle events (Marked final / Reopened / Shelved / Restored /
  Returned) from `forge_audit`.
- **Card page → Comments**: era dividers ("v3 updated · Jul 7") anchor old
  comments to the version they were written against.
- **Studio header**: a pill in the grid's language ("In playtest · v3"), naming
  the released version, plus "· edited since" once the working draft (text,
  live; art and finished image, on refresh) differs from it. With nothing
  released it is the latest iteration ("Draft · v2"), with no comparison.
  In the sticky row from `lg`, on the Created by line below that.
- **Playtester view** (`/forge/play/<set>`): the released version number on the
  tile and in the modal, and nothing else. The payload carries nothing about
  the working draft, not even a "moved on" flag.
- **Set page grid**: the status pill carries the latest version
  ("Draft · v2", "In playtest · v3"); the "Updated since" date filter shows
  cards with any version activity since the cutoff (badge marks draft
  iterations as "v2 draft · Jul 7").

## Visibility rules (RLS, migration 057 + 074)

Granted playtesters can read only `published`/`approved` version rows — a
status whitelist, so `draft` rows are invisible to them **by construction**,
with no policy change. Elders, the card owner, and superadmins read all rows.
The Forge is fully isolated from the public card database; releasing here
never touches what real players see (that is the separate carddata.txt
pipeline + manual Lackey export).

## Key code and migrations

| What | Where |
|---|---|
| Working draft + autosave | `app/forge/cards/[cardId]/StudioEditor.tsx` (`saveCard` → `forge_save_card`) |
| Propose UI + review panel | `app/forge/cards/[cardId]/ReviewPanel.tsx`, `ProposalDiff.tsx` |
| History timeline | `CardHistory.tsx` + pure assembly in `app/forge/lib/historyView.ts` |
| Readers | `app/forge/lib/versions.ts` (listVersions / listCardEvents / listSetActivity) |
| Studio version pill | `app/forge/lib/studioVersion.ts`; `draftMovedOn` in `app/forge/lib/cardDiff.ts` |
| Server actions | `app/forge/lib/proposals.ts`, `lifecycle.ts` |
| RPCs (current bodies) | migrations `083` (**current `forge_publish_card`** — resolves open proposals), `072` (publish note + audit events + undeletable reasons), `075` (draft versions, unified base/guard, sweep exclusions) |
| Enum + backfill | `074` (`version_status` gains 'draft'), `076` (backfilled the one 073-era lost accept) |
| Design history | `docs/superpowers/specs/2026-07-06-forge-version-history-design.md` (incl. addendum) |
