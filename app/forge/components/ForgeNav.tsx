"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Anvil } from "lucide-react";

// Inlined (not imported from lib/auth) so this client component never pulls the
// server-only supabase client into the browser bundle.
type ForgeRole = "superadmin" | "elder" | "playtester";

type NavItem = { href: string; label: string; match: (p: string) => boolean };

export default function ForgeNav({ role }: { role: ForgeRole }) {
  const pathname = usePathname() ?? "";

  const items: NavItem[] =
    role === "playtester"
      ? [
          { href: "/forge/play", label: "Play", match: (p) => p === "/forge/play" || p.startsWith("/forge/play/games") },
          { href: "/forge/play/sets", label: "Sets", match: (p) => p.startsWith("/forge/play/sets") || (/^\/forge\/play\/[^/]+$/.test(p) && !p.startsWith("/forge/play/decks") && !p.startsWith("/forge/play/games")) },
          { href: "/forge/play/decks", label: "Decks", match: (p) => p.startsWith("/forge/play/decks") && p !== "/forge/play/decks/new" },
          { href: "/forge/play/decks/new", label: "Deckbuilder", match: (p) => p === "/forge/play/decks/new" },
        ]
      : [
          { href: "/forge/ideas", label: "Ideas", match: (p) => p.startsWith("/forge/ideas") },
          { href: "/forge/sets", label: "Sets", match: (p) => p.startsWith("/forge/sets") },
          { href: "/forge/play", label: "Play", match: (p) => p.startsWith("/forge/play") && !p.startsWith("/forge/play/decks") },
          { href: "/forge/play/decks", label: "Decks", match: (p) => p.startsWith("/forge/play/decks") && p !== "/forge/play/decks/new" },
          { href: "/forge/play/decks/new", label: "Deckbuilder", match: (p) => p === "/forge/play/decks/new" },
          { href: "/forge/announcements", label: "Announcements", match: (p) => p.startsWith("/forge/announcements") },
          ...(role === "superadmin" || role === "elder"
            ? [{ href: "/forge/admin", label: "Admin", match: (p: string) => p.startsWith("/forge/admin") }]
            : []),
        ];

  return (
    // top-[65px], not top-16: TopNav is 65px tall (h-16 + its bottom border), so top-16
    // left a 1px seam that page content showed through. Opaque, not a translucent blur —
    // with a sticky row beneath it, the blur smeared that row's text as it passed under.
    <div className="sticky top-[65px] z-40 border-b bg-background">
      <div className="mx-auto flex max-w-full items-center gap-1 px-4">
        <Link
          href="/forge"
          className="mr-3 flex shrink-0 items-center gap-2 py-2 text-sm font-semibold tracking-wide text-foreground"
          style={{ fontFamily: "Cinzel, serif" }}
        >
          <Anvil className="hidden h-5 w-5 sm:block" aria-hidden="true" />
          <span>The Forge</span>
        </Link>
        <nav className="no-scrollbar scroll-fade-x flex items-center gap-1 overflow-x-auto pr-7">
          {items.map((it) => {
            const active = it.match(pathname);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
