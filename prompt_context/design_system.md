# Design System

This describes the public site as it is built. If code and this document disagree, fix one of them; do not add a third system. The Goldfish table, the play table, and the Forge have their own looks and are out of scope here (see `goldfish_design_system.md`).

## North star

**Editorial, data-dense, quiet.** Think a well-set newspaper's sports pages, or Moxfield's density with The Athletic's typography. Structure comes from hairlines, spacing, and type, never from boxes. The site looks designed because a few decisions repeat everywhere, not because any one page is decorated.

## Color

Tokens live in `app/globals.css` and are consumed through Tailwind (`bg-background`, `text-foreground`, `bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary`). Public UI never hardcodes Tailwind grays, zinc, slate, or white.

- **Two neutral themes, one hue family.** Light is cool slate on near-white (`--background: 220 27% 98%`); dark is navy (`221 39% 11%`). Pure white and pure grey never appear. `card` is one step brighter than `background` in light and one step darker in dark; that tonal step, not a border, is how a panel lifts.
- **Green `primary` is the only accent.** Hover and active states, the one primary CTA in a view, checked controls, and focus (the `Input` border turns `ring`; focus rings themselves are suppressed globally in `globals.css`). Never a decorative fill.
- **Red lives only in the wordmark's R.** Blue is off-palette. Amber is reserved for tier and status (Regional/National, warnings). `destructive` is red.
- **Jayden** is an easter-egg theme with its own gradient tokens; nothing outside `.jayden` uses gradients.

## Typography

- **Geist Sans for everything.** Cinzel (`font-cinzel`) for exactly two things: a page's H1 (`font-cinzel text-3xl font-bold tracking-tight sm:text-4xl`, `text-2xl sm:text-3xl` in compact tool headers) and article titles. Never on section headings, stats, numbers, labels, buttons, chips, kickers, or the footer.
- **Small-caps label** for kickers, bylines, group headers, and column headings: `text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground`.
- **Section headings** are `text-lg font-semibold` or `text-xl font-semibold`. Numbers and dates use `tabular-nums`, never `font-mono`.
- **Reading text** (articles, rulings) uses `leading-relaxed` and a measure around 65ch.

## Surfaces and lines

- **No card per list item.** Lists are hairline rows: `divide-y divide-border/60` or `border-b border-border/60`, with a consistent column grid (a fixed-width date column, for example) so the eye scans vertically. Row hover is `hover:bg-muted/40`. Group headers are a small-caps label with a hairline beneath, never a filled bar.
- **Boxes are for floating things only:** menus, popovers, dialogs, toasts, and form controls. Radius: `rounded-md` for controls, `rounded-sm` for images, `rounded-full` for chips.
- **No backdrop-blur, no gradients, no glow, no drop shadows on content.** Shadows belong to floating elements only.
- **Chips and filters:** `rounded-full border border-border text-sm`, 44px tall; active is `bg-foreground text-background`.
- **Imagery.** The archived splash plate appears sharp and at full contrast in exactly one place: the home masthead, an always-dark navy band (`app/page.tsx`). It is never a blurred wallpaper behind content. The sign-in pages and the Forge keep it as a full-bleed backdrop (`components/ui/background.tsx`), which is a product decision in those areas.

## Layout

- Container: `mx-auto w-full max-w-5xl px-4`, page padding `py-6 sm:py-10`.
- Mobile-first: tap targets at least 44px (`min-h-11`), no horizontal overflow, rows adapt for phones rather than hiding data.
- Nav (`components/top-nav.tsx`): a small icon before each label on desktop and in the mobile drawer, hairline bottom border, no shadow.
- Footer (`components/site-footer.tsx`): on every public page. Section link grid, wordmark, copyright, sponsors, coffee link. No Cinzel, no ornament.

## Motion

State-conveying only: `transition-colors` on interactive text, short entrance fades in the deck builder, `--ease-out-quart`. No bounce, no decorative animation, no animated backgrounds.

## Reference implementations

| Pattern | Where |
|---|---|
| Masthead | `app/page.tsx` |
| Agenda / ledger list | `app/tournaments/tournaments-client.tsx` |
| Q/A list | `app/rulings/page.tsx` |
| Lead story + hairline list | `app/articles/page.tsx`, `app/articles/components/PostCard.tsx` |
| Section index with hairlines | `app/page.tsx` (site sections) |
| Tokens | `app/globals.css`; `tailwind.config.ts` (`fontFamily.cinzel`, the `darkMode` variant covers `.dark` and `.jayden`) |

## Don't

A bordered card per list item. Identical tile grids. Hero-metric blocks. Gradient text. Glassmorphism. Blurred hero wallpaper. Pure `#fff` or `#000`. Blue accents. Cinzel on chrome. `font-mono` for dates. A new accent colour for a new feature.
