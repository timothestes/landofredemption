import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";
import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";
import { cn } from "@/lib/utils";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadPublishedPosts } from "@/app/articles/lib/queries";
import PostCard from "@/app/articles/components/PostCard";

export const metadata: Metadata = {
  title: { absolute: "Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments" },
  alternates: { canonical: "/" },
};

const LINKS = [
  { href: "/decklist", title: "Deck Builder", desc: "Build, validate, and share Redemption decks." },
  { href: "/tournaments", title: "Tournaments", desc: "Events, standings, and live pairings." },
  { href: "/play", title: "Play Online", desc: "Play Redemption in your browser." },
  { href: "/rulings", title: "Rulings", desc: "Search official card rulings." },
  { href: "/resources", title: "Resources", desc: "Rulebooks, guides, and player documents." },
] as const;

export default async function Index(props: {
  searchParams: Promise<{
    code?: string;
    error?: string;
    error_description?: string;
    p?: string;
    page_id?: string;
    cat?: string;
  }>;
}) {
  const searchParams = await props.searchParams;

  if (searchParams.code) {
    redirect(
      `/auth/callback?code=${encodeURIComponent(searchParams.code)}&redirect_to=/tracker/reset-password`,
    );
  }

  if (searchParams.error) {
    // Token expired or invalid — send back to forgot-password with a message
    redirect(
      `/forgot-password?${new URLSearchParams({ error: searchParams.error_description ?? "The reset link has expired. Please request a new one." }).toString()}`,
    );
  }

  const legacy = await resolveLegacyWpParams(searchParams, async (id) => {
    const { data } = await createAnonClient()
      .from("posts").select("slug").eq("wp_post_id", id).maybeSingle();
    return data?.slug ?? null;
  });
  if (legacy.kind === "not-found") notFound();
  if (legacy.kind === "redirect") permanentRedirect(legacy.to);

  const { posts } = await loadPublishedPosts({ page: 1 });
  const [lead, ...rest] = posts.slice(0, 5);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      {/* Masthead. The one place the archived splash art appears, sharp and at
          full contrast. The band is the plate's own navy in BOTH themes: the art
          is a near-black render made for a dark header, and fading or multiplying
          it onto a light page only ever made a grey smear (see #447). A fixed dark
          nameplate over a light page is the classic editorial move, and it means
          one asset, no theme swap, no hydration flash. Art is hidden below `lg`,
          where the text needs the full width. */}
      <section className="relative overflow-hidden border-b border-white/10 bg-[hsl(228,22%,12%)] text-[hsl(210,20%,96%)]">
        <img
          src="/brand/hero-splash.webp"
          alt=""
          aria-hidden
          width={900}
          height={650}
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[min(56%,46rem)] object-cover object-[50%_18%] [mask-image:linear-gradient(to_right,transparent_0%,black_45%)] lg:block"
        />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-10 sm:py-14 lg:py-20">
          <h1 className="sr-only">
            Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments
          </h1>
          <img
            src="/brand/lor-wordmark.webp"
            alt=""
            aria-hidden
            width={450}
            height={122}
            className="h-auto w-full max-w-sm sm:max-w-md"
          />
          <p className="mt-5 max-w-lg text-[hsl(215,16%,72%)] sm:text-lg">
            Strategy, deck building, and tournaments for Redemption — the collectible card
            game of biblical battles.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/decklist/card-search?new=true"
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Build a deck
            </Link>
            <Link
              href="/tournaments"
              className="inline-flex min-h-11 items-center text-sm font-medium text-[hsl(215,16%,80%)] transition-colors hover:text-white"
            >
              Upcoming tournaments →
            </Link>
          </div>
        </div>
      </section>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8">
        {/* Section index, newspaper-style: hairlines instead of five identical boxes. */}
        <nav
          aria-label="Site sections"
          className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5 sm:gap-x-0 sm:divide-x sm:divide-border/60"
        >
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "group min-w-0 sm:px-5 sm:first:pl-0 sm:last:pr-0",
                // Five items in two columns would orphan the last one.
                i === LINKS.length - 1 && "col-span-2 sm:col-span-1",
              )}
            >
              <div className="font-semibold transition-colors group-hover:text-primary">{l.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{l.desc}</p>
            </Link>
          ))}
        </nav>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Latest articles</h2>
            <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">
              All articles →
            </Link>
          </div>
          {lead && (
            <div className="grid gap-6 md:grid-cols-2">
              <PostCard post={lead} priority headingLevel={3} />
              <div className="flex flex-col divide-y divide-border/60">
                {rest.map((post) => (
                  <PostCard key={post.slug} post={post} variant="compact" headingLevel={3} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
