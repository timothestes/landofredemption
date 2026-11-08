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
 "Shelve"          : retires the live row, clears the pointers, and records what it
                     cleared (shelved_status + shelved_*_version_id)
 "Restore"         : puts back exactly that: In playtest or Final on the same version,
                     visible to playtesters again; Draft stays Draft (no new version)
```

**Release needs a name and a type** (migration 127), at the database and in the UI.
Missing art stays allowed: art-less playtest releases are normal. A bulk release counts
a blocked card as skipped and says why.

**Releasing an unchanged card mints nothing** (migration 127). If the working draft
matches the published version in content and art, `forge_publish_card` returns null. The
single-card dialog says nothing has changed since vN; a bulk release counts the card as
skipped. Open proposals stay open, because no version was minted. A first release always
mints, and so does releasing a card whose last release was retired. "Content" ignores
empty fields, so typing into a blank field and erasing it is not a change.

**A finished image is a pointer on the card.** Release and accept copy
`working_finished_key` into `card_versions.finished_key`, reading it at that moment: a
proposal has no key of its own. "Remove finished image" (`removeFinished` in
`app/forge/lib/cards.ts`) clears only the card's pointer and leaves the file, because a
version, and later a promotion, may still read it. It counts as an art change, so the pill
says "edited since" and the next release or accept mints a version with no finished image.
Playtesters keep the released version until then.

## Why autosave exists (and why it is NOT versioning)

`forge_cards.working_snapshot` is the live editing surface. The studio
autosaves ~700ms after the last keystroke (plus a flush when you navigate
away) so work is never lost and presence/collaboration sees fresh state.
Each save **overwrites** the fields it changed — there is deliberately no
keystroke-level history. If a change is worth remembering, checkpoint it by
proposing it. **Solo designers included:** propose → self-accept is the
intended way to record your own iteration; nothing else will.

**Saves merge by field (migration 126).** A save sends only the fields this
session changed, diffed against `lastSaved` (this session's own view of the
server, not the props), and `forge_save_card_fields` merges them into the row.
Two elders on different fields both keep their edits; on the same field the
last write wins. What comes back is adopted once the session has nothing
unsaved. With an unsaved edit the studio shows the "changed elsewhere" banner
instead, and the next save still sends only this session's fields. One save
runs at a time per session (`createCardSaver` in `app/forge/lib/cardSave.ts`).
`forge_save_card` still writes whole snapshots, for a newly imported card and
the promote preflight rename only.

**Import "Overwrite existing cards" edits the working draft the same way.** It
merges only the fields the file carries (`overwritePatch` in
`app/forge/import/overwrite.ts`): a blank cell or a missing column leaves the
card's value alone, and a file can't clear a field. A row that changes nothing
writes nothing. It mints no version and leaves no record in History, so an
overwrite can't be undone; a wizard confirm step says how many cards will change.

## How each version status comes to exist

| `card_versions.status` | Minted by | Who can see it | Meaning |
|---|---|---|---|
| `draft` | Accepting a proposal on a **Draft** card | Elders/owner/superadmin only | Pre-release iteration record. Never superseded, never released; permanent history. |
| `published` | **Release to playtesters** button, or accepting a proposal on an **In playtest** card | Playtesters (granted) + elders | The current playtest version. Exactly one per card; the previous one flips to `superseded`. |
| `approved` | **Mark final** (flips the current `published` row in place) | Playtesters (granted) + elders | The finalized version. Reopen flips it back to `published`. |
| `superseded` | Automatically, when a newer `published` version replaces the old one (or on Shelve/Return for published/approved rows) | Elders only | Retired release. Draft rows are never turned into this. Restore flips the row Shelve took down back to what it was (migration 127). |

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
- **Accept** (elder): saves pending edits first, then checkpoints the proposed
  snapshot as a version (table above), folds it into the working draft, closes
  sibling open proposals as `superseded`. If the save fails, nothing is accepted.
  Accepting replaces the draft with the proposal, so an open proposal warns once
  the draft has moved on. On a Draft card the dialog says so explicitly: nothing
  is released.
- **Deny** (elder): requires a reason, stored as a proposal-anchored comment. A proposal
  freezes the one shared draft and isn't a branch, so a denied change stays in the draft
  and the next release ships it. The Deny dialog therefore asks: put the draft back to the
  latest version (`forge_deny_proposal_restore_draft`, migration 127, atomic with the
  deny; snapshot only, art untouched; logged in History), or leave it. It defaults to
  going back only when the draft is just the denied change; if the draft has moved on,
  going back would discard those edits too, so it defaults to leaving it and says so.
  The Release dialog shows a diff against the last release either way.
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

- **Release dialog** — lists what will change for playtesters, from the live draft. It
  flushes the editor before freezing, so the diff you read is what ships.
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
  Returned) from `forge_audit`. Also applied suggestions, which are worked out
  rather than recorded: `forge_apply_suggestion` only writes the draft and marks
  the comment resolved, so who applied one, when, and the value it replaced are
  not stored. `appliedSuggestion` in `app/forge/lib/historyView.ts` infers it from
  the comment and the versions, and takes the old value from the version at the
  time.
- **Card page → Comments**: era dividers ("v3 updated · Jul 7") anchor old
  comments to the version they were written against. Resolved threads on earlier
  versions fold; anything unresolved stays in view.
- **Studio header**: a pill in the grid's language ("In playtest · v3"), naming
  the released version, plus "· edited since" once the working draft (text,
  live; art and finished image, on refresh) differs from it. With nothing
  released it is the latest iteration ("Draft · v2"), with no comparison.
  In the sticky row from `lg`, on the Created by line below that.
- **Playtester view** (`/forge/play/<set>`): the released version number on the
  tile and in the modal, and nothing else. The payload carries nothing about
  the working draft, not even a "moved on" flag.
- **Set page grid**: the status pill carries the latest version
  ("Draft · v2", "In playtest · v3"); the "New version since" date filter shows
  cards with a version minted since the cutoff, meaning a release or an accepted
  proposal (badge marks draft iterations as "v2 draft · Jul 7"). Saved edits
  don't count, because autosave mints no version.

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
| Working draft + autosave | `app/forge/cards/[cardId]/StudioEditor.tsx` (`createCardSaver` + `saveCardFields` → `forge_save_card_fields`, migration `126`) |
| Propose UI + review panel | `app/forge/cards/[cardId]/ReviewPanel.tsx`, `ProposalDiff.tsx` |
| History timeline | `CardHistory.tsx` + pure assembly in `app/forge/lib/historyView.ts` |
| Readers | `app/forge/lib/versions.ts` (listVersions / listCardEvents / listSetActivity) |
| Studio version pill | `app/forge/lib/studioVersion.ts`; `sameCardContent` in `app/forge/lib/cardDiff.ts`, `artChangedSince` in `app/forge/lib/versions.ts` |
| Server actions | `app/forge/lib/proposals.ts`, `lifecycle.ts` |
| RPCs (current bodies) | migrations `127` (**current `forge_publish_card`**, `forge_archive_card` and `forge_unarchive_card`; also new `forge_deny_proposal_restore_draft`), `083` (publish resolves open proposals), `072` (publish note + audit events + undeletable reasons), `075` (draft versions, unified base/guard, sweep exclusions) |
| Enum + backfill | `074` (`version_status` gains 'draft'), `076` (backfilled the one 073-era lost accept) |
| Design history | `docs/superpowers/specs/2026-07-06-forge-version-history-design.md` (incl. addendum) |
