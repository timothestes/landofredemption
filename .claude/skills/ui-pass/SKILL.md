---
name: ui-pass
description: Use when the user wants the site's UI or appearance improved, asks what still looks generated or "default shadcn", or wants a design-consistency sweep of the public pages turned into PRs. Also use to re-run the pass on one route or feature ("ui pass on the tracker host view"). Not for /play, /goldfish, /forge or /admin, which have their own design systems.
---

# UI pass

Find where the public site still looks generated instead of designed, fix the
highest-value cases in a few small, independently reviewable PRs, and report. Whoever
invokes this skill is the **lead**: the lead coordinates and runs every git command;
subagents do the edits.

## Arguments

`/ui-pass [area] [findings-only] [max-prs N]`

- **area** — a route or feature. Default: the whole public site.
- **findings-only** — stop after the ranked findings; change no code.
- **max-prs N** — default 4.

## Handing off

If the user asks for the pass to be handed off, dispatch one `general-purpose` subagent
with `model: "fable"`, give it this file's full text with the arguments filled in, and
tell it that it is the lead. It has the Agent tool and delegates the same way.

## Read first, in this order

1. `CLAUDE.md` — worktree rules, conventions, design context.
2. `prompt_context/design_system.md` — the law. It already says: tokens only; green is the
   only accent; hairline rows, not cards; Cinzel on page H1 and article titles only; boxes
   only for floating things; no blur/gradient/glow/shadow on content; 44px targets;
   `SiteFooter` on every public page. Quote it when you justify a change.
3. `git log --oneline --grep='design(' origin/main` — every earlier pass. Do not redo
   what they did. Build on it.
4. `.claude/skills/verify/SKILL.md` — dev server, minting sessions, driving Playwright.

## What "better" means here

Editorial, data-dense, quiet. The site looks designed because a few decisions repeat
everywhere. "Better" is the same rules applied to pages and components earlier passes did
not reach, plus rough edges inside the pages they did reach. It is never more decoration,
a new colour, a new pattern, animation, a new component library, or a redesign of a page
that already follows the rules.

## Procedure

### 1. Inspect — the lead does this, not subagents (one browser)

- Run the dev server from your worktree. Compare with prod (landofredemption.com) when
  useful.
- Screenshot every public route in the area at 1280x800 and 390x844, light and dark. Save
  under the scratchpad, never inside the repo. Read the images; do not trust file names.
- Drive real states: signed-out and signed-in (mint a session per the verify skill), empty
  lists, long lists, not-found and error pages, loading states, open dialogs and menus,
  forms with validation errors.
- Start with the backlog below, then: empty, loading and error states everywhere;
  `not-found.tsx` and `error.tsx` fallbacks; shared controls (Button, Input, Select,
  Dialog, Tabs, Badge, Table) wherever they still read as an untouched shadcn install;
  legacy WordPress routes (`/[wpSlug]`, `/category/[...path]`, `/board`, `/threshingfloor`).
- Known a11y smells: nested `<main>` (root layout plus pages). Fix only inside a PR you
  are already making.
- Out of scope unless the area names them: `/play`, `/goldfish`, `/forge/*`, `/admin/*`.

### 2. Findings

For each page or component: the rule it breaks (quoted) or the rough edge, a screenshot
path, the file(s) and line(s), an estimated diff size, and the risk. Rank by
(traffic x visibility) / (diff size x risk). Group into at most max-prs PRs with disjoint
files. Each PR is one area or one cross-cutting rule, reviewable in 15 minutes, ideally
under 400 changed lines. With `findings-only`, write the ranked findings to the scratchpad
and stop.

### 3. Ideate, then spec (delegate)

Run three ideation subagents in parallel over the findings, each with a different lens so
they do not converge:

- (a) hierarchy and scanning at a glance on a phone at a tournament table;
- (b) visual consistency against `design_system.md`;
- (c) states and edges: empty, error, loading, long content, overflow, keyboard and a11y.

Each returns concrete, file-level proposals. Synthesize into one spec per PR with
must-have / nice-to-have / deferred. Must-haves are surgical.

### 4. Implement (delegate, one subagent per PR)

Each implementer gets its spec, the screenshot paths, the absolute worktree path, and the
hard rules below. Implementers edit only their PR's files and run no git. Read every diff
yourself before you commit it.

### 5. Review (delegate)

Two reviewers per PR against the real `git diff`: one for correctness (no behaviour
change, no broken state, types clean), one for design (every changed line traces to a
quoted rule or a listed rough edge; no new tokens, no hardcoded colours, no new
dependencies). Fix what they find.

### 6. Verify live yourself, then open the PRs

Reload each changed page in Playwright at both viewports and both themes. Take
after-screenshots. Confirm the change renders and nothing regressed: nav, footer,
dialogs, forms, signed-out view. Only then commit, push and open the PR.

## Hard rules

- **Worktrees.** `git fetch origin`, then
  `git worktree add /Users/timestes/projects/rtt-ui-<area> -b ui/<area> origin/main`.
  All work in the worktree with absolute paths. Assume another agent owns the main
  checkout: never edit there, never `git checkout`, `switch`, `reset` or `stash` there.
  Ignore the other `rtt-*` worktrees.
- **node_modules in a worktree.**
  `cp -Rc /Users/timestes/projects/redemption-tournament-tracker/node_modules <worktree>/node_modules`
  (copy-on-write clone, seconds). Never `npm install` inside a worktree. Copy `.env.local`
  from the main checkout. If `next dev` 500s on a missing `@vercel/*` package, install it
  into the worktree copy from a scratchpad `npm pack`, never into main.
- **Staging.** Explicit paths only, never `-A`, `.` or `-a`. One bad pathspec makes
  `git add` add nothing, so check `git status` after staging.
- **Verification per PR.** `npx tsc --noEmit` (one pre-existing error on
  `@resvg/resvg-js` is the environment) and `npx vitest run`, suites run serially (the
  `renderCard` failure is the environment; parallel runs time out `deckImage` and
  `trackerTemplate.integration`). No `next build`. Do not fight Vercel preview auth.
- **Design.** Tokens only, no gray/zinc/slate/white utilities; green primary is the only
  accent; no `focus:ring-*` on controls; Cinzel only on page H1 and article titles; no card
  per list item; no blur, gradient or shadow on content; 44px tap targets; `tabular-nums`
  for numbers, never `font-mono`.
- **Surgical.** Every changed line traces to a finding. No refactors, no adjacent
  cleanups, no new abstractions, no new dependencies, no new component when an existing
  shadcn one fits. Mention unrelated smells in the report; do not fix them.
- **No behaviour changes.** Appearance and hierarchy only. If a fix needs logic, defer it.
- **Playwright.** The MCP browser is often locked by another session. Write a standalone
  script that imports `node_modules/playwright/index.mjs` and run it with `node`.
- **PRs.** Base on `origin/main`; title `design(<area>): <what>`; body says what changed
  and why in rule terms, how it was verified, a plain-words description of before and
  after, and what was deferred. Follow the attribution lines the session gives for
  commits and PR bodies.
- **Clean up.** Stop dev servers you started; `git worktree remove` each worktree once
  its PR is open unless a follow-up is likely.

## Backlog

As of 2026-09-29. Confirm against `git log --grep='design(' origin/main` before trusting.

**Done:** #456 tokens, masthead, nav, footer, tournaments, rulings, articles, decklist
lists, collection, spoilers, tracker pages · #458 `/t/[code]` · #459 results pages ·
#460 sign-in/up/forgot, 404, error fallback · #461 deck format chips, de-blue.

**Open, ranked:**

1. `/tracker/tournaments/[id]` host view — real bug: 518px wide at 390px because the
   Flowbite `Tabs` in `components/ui/TournamentTabs.tsx` has no `overflow-x-auto`; also
   backdrop-blur sticky header, non-Cinzel H1, filled table headers, phone cards in
   `StandingsTable`. 1343-line client, third-party Tabs: medium risk.
2. `/tournaments/history` — bordered card grid with green top rules, rainbow format chips,
   no H1, `bg-zinc-900` attribution badge. Six views.
3. `/register` — bordered section boxes, native file button, `text-blue-600` link.
4. Remaining `getDeckTypeBadgeClasses` copies: `LoadDeckModal`, `DeckSourcePicker`
   (blue "Lackey" link), `AttachDeckDialog`; generator's emoji segmented tabs and Flowbite
   gradient buttons.
5. The chip recipe exists as constants in `tournaments-client.tsx` and as inline strings
   elsewhere; a shared export is the next step. `/t/[code]` still lacks `SiteFooter`.

## Report

The user reads only the lead's final message. Lead with the PR list: number, title, one
line on what it changes, how it was verified. Then the ranked findings not taken and why,
anything that could not be verified, and the screenshot folder path. Under 400 words.
