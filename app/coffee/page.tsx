import Link from "next/link";
import { Coffee } from "lucide-react";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { BUY_ME_A_COFFEE_URL } from "@/lib/sponsors";

export const metadata = {
  title: "Buy Me a Coffee",
  description:
    "Land of Redemption is free and has no ads. If it has been useful to you, buy me a coffee to help keep it running.",
  alternates: { canonical: "/coffee" },
};

const BILLS = [
  {
    title: "Hosting",
    desc: "The site, the tournament tracker, and the server that runs online play.",
  },
  {
    title: "Database",
    desc: "Every deck, event, standing, and ruling lives here.",
  },
  {
    title: "Card images",
    desc: "Thousands of card scans, served on every page.",
  },
];

/**
 * A cup with three steam wisps. The cup outline is lucide's Coffee glyph; the
 * wisps are separate paths so they can drift on their own timers. The motion
 * is defined in globals.css and switched off under prefers-reduced-motion.
 */
function SteamingCup() {
  return (
    <svg
      className="h-14 w-14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        className="coffee-steam text-zinc-500"
        style={{ animationDelay: "0s" }}
        d="M6 2v2"
      />
      <path
        className="coffee-steam text-zinc-500"
        style={{ animationDelay: "0.5s" }}
        d="M10 2v2"
      />
      <path
        className="coffee-steam text-zinc-500"
        style={{ animationDelay: "1s" }}
        d="M14 2v2"
      />
      <path
        className="text-zinc-100"
        d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"
      />
    </svg>
  );
}

export default function CoffeePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16">
        {/* Same dark panel as the home page hero, so the two pages read as one brand. */}
        <section className="rounded-xl bg-zinc-950 px-6 py-10 sm:px-10">
          <SteamingCup />
          <p className="mt-6 font-cinzel text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Keep the lights on
          </p>
          <h1 className="mt-2 font-cinzel text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            Buy me a coffee
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-zinc-300">
            Land of Redemption is a fan run site. It&apos;s free and has no ads!
            If you want to support and encourage me, feel free to buy me a coffee!
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a
              href={BUY_ME_A_COFFEE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Coffee className="h-4 w-4" aria-hidden />
              Buy me a coffee
            </a>
            <span className="text-xs text-zinc-500">
              Opens buymeacoffee.com/landofredemption in a new tab
            </span>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-cinzel text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Where it goes
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {BILLS.map((bill) => (
              <div key={bill.title} className="rounded-lg border bg-card p-4">
                <div className="font-semibold">{bill.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{bill.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-10 text-sm text-muted-foreground">
          Thanks as well to the{" "}
          <Link
            href="/sponsors"
            className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
          >
            sponsors
          </Link>{" "}
          who help cover these bills.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
