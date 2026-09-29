"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Coffee } from "lucide-react";

import { SPONSORS } from "@/lib/sponsors";

// Routes that intentionally skip the footer because they own the full
// viewport (the deck-builder editors render a sticky-bottom Maybeboard strip
// that conflicts with anything below it). Add new editor routes here as they
// adopt the same pattern.
const HIDE_ON_PATHS = new Set<string>(["/decklist/card-search"]);

type FooterLink = { label: string; href: string };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Build",
    links: [
      { label: "Deck Builder", href: "/decklist/card-search?new=true" },
      { label: "Community decks", href: "/decklist/community" },
      { label: "Tier list", href: "/decklist/card-search/tier-list" },
    ],
  },
  {
    heading: "Compete",
    links: [
      { label: "Tournaments", href: "/tournaments" },
      { label: "Results", href: "/tournaments/results" },
      { label: "Metagame", href: "/tournaments/metagame" },
      { label: "History", href: "/tournaments/history" },
      { label: "RNRS points", href: "/tournaments/rnrs-points" },
    ],
  },
  {
    heading: "Learn",
    links: [
      { label: "Articles", href: "/articles" },
      { label: "Rulings", href: "/rulings" },
      { label: "Resources", href: "/resources" },
      { label: "Spoilers", href: "/spoilers" },
    ],
  },
  {
    heading: "Play",
    links: [{ label: "Play online", href: "/play" }],
  },
];

const LABEL_CLASS = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

// The sponsor logos swap by theme through next-themes. Scoped to this subtree
// so only the logos wait on `mounted`: they stay invisible until the client
// knows the theme, which avoids a light/dark flash on hydration.
function SponsorLogos() {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? (theme === "system" ? resolvedTheme : theme) : undefined;
  const isDark = activeTheme === "dark" || activeTheme === "jayden";

  return (
    <>
      {SPONSORS.map((sponsor) => (
        <a
          key={sponsor.name}
          href={sponsor.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center opacity-70 transition-opacity hover:opacity-100 sm:min-h-0"
          aria-label={`Visit ${sponsor.name}`}
        >
          <Image
            src={isDark ? sponsor.logoDark : sponsor.logoLight}
            alt={sponsor.name}
            width={sponsor.width}
            height={sponsor.height}
            className="h-7 w-auto object-contain"
            style={{ opacity: mounted ? 1 : 0 }}
          />
        </a>
      ))}
    </>
  );
}

export default function SiteFooter() {
  const pathname = usePathname();

  if (pathname && HIDE_ON_PATHS.has(pathname)) return null;

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
        <nav aria-label="Site" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className={LABEL_CLASS}>{column.heading}</h2>
              <ul className="mt-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="flex min-h-11 items-center py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:min-h-0"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-10 flex flex-col gap-6 border-t border-border/60 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {/* Both wordmarks ship; `dark:` matches .dark AND .jayden (tailwind.config.ts),
                so the swap is pure CSS — no theme hook, no hydration flash. */}
            <img
              src="/brand/lor-wordmark-dark.webp"
              alt=""
              aria-hidden
              width={450}
              height={122}
              className="h-6 w-auto dark:hidden"
            />
            <img
              src="/brand/lor-wordmark.webp"
              alt=""
              aria-hidden
              width={450}
              height={122}
              className="hidden h-6 w-auto dark:block"
            />
            <span className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Land of Redemption
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href="/sponsors"
              className={`${LABEL_CLASS} flex min-h-11 items-center transition-colors hover:text-foreground sm:min-h-0`}
            >
              Sponsored by
            </Link>
            <SponsorLogos />
            <Link
              href="/coffee"
              className="flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:min-h-0"
            >
              <Coffee className="h-3.5 w-3.5" aria-hidden />
              Buy me a coffee
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
