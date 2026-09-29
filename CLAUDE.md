# Land of Redemption

Web app for Redemption CCG tournaments, deck building, articles, and event registration.

## Tech Stack

Next.js 15 (App Router), React 19, TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS + shadcn/ui + Flowbite React, Vercel Blob (card images), Resend (email), SpacetimeDB (multiplayer game state), deployed on Vercel.

## Key Conventions

- **Supabase clients**: Server components/actions use `utils/supabase/server.ts`, client components use `utils/supabase/client.ts`. Never import server client in `"use client"` files.
- **Auth**: Supabase Auth + PostgreSQL role `registration_admin` for admin access. RLS enabled on all tables.
- **Server actions**: Located in `app/*/actions.ts` with `"use server"` directive. Deck actions are in `app/decklist/actions.ts`.
- **Migrations**: `supabase/migrations/` with numeric prefix (e.g., `001_create_deck_tables.sql`). Run via Supabase MCP or directly.
- **Styling**: Tailwind utilities first, dark mode via `next-themes`, `cn()` from `lib/utils.ts`.

## Parallel Agents / Avoiding Toe-Stepping

I dispatch multiple agents on this repo often. A single git working directory can only be on one branch with one set of uncommitted changes, so two agents sharing this checkout will clobber each other's branches, edits, and stashes. Rules for any agent that will edit files or run git:

- **Isolate with a git worktree.** Before working, create your own: `git worktree add ../rtt-<task> -b <branch> origin/main`, then do **all** work inside `../rtt-<task>` using **absolute paths**. Assume another agent owns the main checkout — never touch it. Commit, push, and open the PR from your worktree. Clean up with `git worktree remove` when done.
- **If you cannot use a worktree, stay in your lane.** Do **not** run `git checkout`/`switch`/`reset`/`stash` on the shared tree, and edit only the files you were explicitly assigned.
- **Sanity-check the tree.** Before and after git commands, verify `git status` and the current branch. If the working tree or branch is not what you left it (e.g. `git reflog` shows checkouts you didn't make), **stop and report** — don't push through; a sibling agent is likely active.
- **Never stage broadly.** Only `git add <your specific files>` — never `git add -A`/`.`/`-a` — so you don't sweep up another agent's in-flight work.
- **PRs base off `origin/main`** (fetch first), not off whatever branch happens to be checked out.

## Dev Commands

```bash
npm run dev              # Dev server at localhost:3000
npm run build            # Production build
make update-paragons     # Download latest Paragon CSV and regenerate TypeScript
make update-cards        # Download latest carddata.txt and regenerate TypeScript
```

## Key References

| Topic | Location |
|-------|----------|
| DB schema | `prompt_context/context.md` |
| Pairing algorithm | `prompt_context/algorithm.md` + `utils/tournament/pairingUtilsV2.ts` |
| Deck rules | `prompt_context/redemption_deck_rules.md` |
| Paragon format | `prompt_context/paragon_format.md` |
| Deck validation | `app/decklist/card-search/utils/deckValidation.ts` |
| Deck state | `app/decklist/card-search/hooks/useDeckState.ts` |
| Card data access | `lib/cards/lookup.ts` — canonical `CARDS` / `findCard` / `CardData`. Backed by generated `lib/cards/generated/cardData.ts`; regen with `make update-cards`. |
| Nationals config | `app/config/nationals.ts` |
| Official REG (v11) | qrpnuz0u6exnvyt8.public.blob.vercel-storage.com/wp/wp-content/uploads/2026/03/REG_PDF_11.0.0.pdf (`DOCS.reg` in `lib/resources.ts`) |
| Official ORDIR (v7) | qrpnuz0u6exnvyt8.public.blob.vercel-storage.com/wp/wp-content/uploads/2026/03/ORDIR_PDF_7.0.0.pdf (`DOCS.ordir`) |
| Deck Building Rules (v1.3) | qrpnuz0u6exnvyt8.public.blob.vercel-storage.com/wp/wp-content/uploads/2026/03/Deck_Building_Rules_1.3.pdf (`DOCS.deckBuildingRules`) |
| Design system | `prompt_context/design_system.md` |
| Forge card versioning | `prompt_context/forge_versioning.md` — autosave vs proposals vs versions, who sees what, where the "why" lives |
| Forge set promotion ("big red button") | `docs/superpowers/specs/2026-08-22-forge-public-set-release-design.md` + `app/forge/lib/promote.ts`; overlay `scripts/data/forge-released.json` via `make pull-forge-releases` |
| Card aliases (`[[LAFS]]`) | `lib/cards/aliases.ts` + `app/admin/catalog/AliasEditor.tsx`; curated in /admin/catalog, baked into the overlay by `make pull-card-overrides` — an alias is live only after a deploy |
| Glossary shorthand (`[[EC]]`) | `lib/glossary/terms.ts` — 43 set codes and game terms, static; renders via `GlossaryMention` with a hover/tap expansion. Resolved AFTER cards and aliases; a test asserts the lists cannot overlap |
| Catalog admin editor | `docs/superpowers/specs/2026-08-23-catalog-admin-editor-design.md` + `app/admin/catalog/`; overlay `scripts/data/card-overrides.json` via `make pull-card-overrides` |
| Goldfish mode | `prompt_context/goldfish_practice_mode.md` |
| Mobile touch support | `docs/superpowers/specs/2026-08-29-mobile-multiplayer-touch-design.md` + `app/shared/layout/camera.ts`; `npm run shots:mobile` for the screenshot matrix. Konva fires `tap` not `click` on touch — see the implementation notes. |
| Goldfish design system | `prompt_context/goldfish_design_system.md` |
| Articles (posts) | `docs/superpowers/specs/2026-09-05-articles-design.md` + `app/articles/` (public) and `app/admin/posts/` (editor); `publish_posts` permission; markdown storage, `ArticleBody` is the one renderer |
| WordPress import | `docs/superpowers/specs/2026-09-06-wxr-import-design.md` + `scripts/import-wxr.ts` (`--dry-run` is safe; everything else writes prod). Converter lib in `scripts/lib/wxr/`; author map `scripts/data/wxr-authors.json`. |
| Multiplayer design spec | `docs/superpowers/specs/2026-03-23-multiplayer-spacetimedb-design.md` |
| Battle zone design | `docs/superpowers/specs/2026-07-12-battle-zone-design.md` |
| SpacetimeDB SDK rules | `spacetimedb/CLAUDE.md` — **READ THIS before writing any SpacetimeDB code.** Contains critical SDK gotchas, hallucinated API warnings, and correct patterns. |

## Design Context

### Users
Competitive and casual Redemption CCG players who need to build decks, register for tournaments, and track events. They come with intent — searching cards, tweaking decklists, checking pairings mid-round. Mobile usage is high (players at tables checking standings on their phones). The job: get tournament and deck tasks done quickly with zero friction.

### Brand Personality
**Clean, serious, professional.** This is a tool for players who take their game seriously. No whimsy, no clutter — every element earns its place. The interface should feel like a sharp, well-built instrument.

### Aesthetic Direction
- **Visual tone:** Data-dense and functional, inspired by Moxfield/Archidekt. Information-forward with clear hierarchy. Neutral slate-tinted palette (tokens in `app/globals.css`) with green as the single accent for actions and states; rules in `prompt_context/design_system.md`.
- **Typography:** Geist Sans for UI, Cinzel for display/headers where biblical gravitas is needed. Prioritize legibility at small sizes on mobile.
- **Theme:** Light and dark mode (system default). Light mode is near-white with subtle background imagery; dark mode is rich and immersive.
- **Anti-references:** Avoid overly flashy game UIs (Hearthstone-style heavy textures), generic Bootstrap looks, or cluttered dashboards. No gratuitous animation or decoration.

### Design Principles
1. **Function over form** — Every UI element must serve a clear purpose. Data density is a feature, not a bug. Optimize for task completion speed.
2. **Mobile-first** — Design for phone screens at tournament tables first, then scale up. Touch targets, readable text, and one-handed operation matter.
3. **Quiet confidence** — The interface should feel professional and restrained. Use subtle motion (Framer Motion, GSAP) to reinforce interactions, not to decorate.
4. **Clarity at a glance** — Players glance at screens mid-game. Information hierarchy, contrast, and scannability are critical. Use whitespace and typography to guide the eye.
5. **Consistency** — Use shadcn/ui components and Tailwind design tokens uniformly. New UI should feel like it belongs with existing UI.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.