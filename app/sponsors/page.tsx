import Image from "next/image";
import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { SPONSORS } from "@/lib/sponsors";

export const metadata = {
  title: "Sponsors",
  description: "The sponsors who help keep Land of Redemption free for Redemption players.",
  alternates: { canonical: "/sponsors" },
};

function ExternalIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5M15 3h6m0 0v6m0-6L10.5 13.5"
      />
    </svg>
  );
}

export default function SponsorsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">Sponsors</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Land of Redemption is free to use. These sponsors help cover what it costs to run, and
          every link on this page goes straight to them.
        </p>

        <div className="mt-8 space-y-4">
          {SPONSORS.map((sponsor) => (
            <a
              key={sponsor.name}
              href={sponsor.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-5 rounded-lg border border-border bg-card p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40 sm:flex-row sm:text-left"
            >
              <div className="flex h-28 w-28 shrink-0 items-center justify-center">
                {/* The tailwind dark variant covers both the dark and jayden themes. */}
                <Image
                  src={sponsor.logoLight}
                  alt=""
                  width={sponsor.width}
                  height={sponsor.height}
                  className="h-24 w-auto object-contain dark:hidden"
                />
                <Image
                  src={sponsor.logoDark}
                  alt=""
                  width={sponsor.width}
                  height={sponsor.height}
                  className="hidden h-24 w-auto object-contain dark:block"
                />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
                  {sponsor.name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{sponsor.blurb}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-2">
                  Visit {sponsor.site}
                  <ExternalIcon />
                </span>
              </div>
            </a>
          ))}
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          Not a business? You can still help keep the site running.{" "}
          <Link
            href="/coffee"
            className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
          >
            Buy me a coffee
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
