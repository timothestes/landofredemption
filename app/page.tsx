import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { createAnonClient } from "@/utils/supabase/anon";
import { resolveLegacyWpParams } from "@/lib/wp/legacyParams";
import { cn } from "@/lib/utils";
import TopNav from "@/components/top-nav";
import SponsorFooter from "@/components/sponsor-footer";
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
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8">
        <section className="flex gap-8 border-b border-border/60 pb-8 sm:pb-10">
          <div className="min-w-0 flex-1">
            <h1 className="sr-only">
              Land of Redemption – Redemption CCG Strategy, Deck Building, and Tournaments
            </h1>
            {/* Both wordmarks ship; `dark:` matches .dark AND .jayden (tailwind.config.ts),
                so the swap is pure CSS — no theme hook, no hydration flash. */}
            <img
              src="/brand/lor-wordmark-dark.webp"
              alt=""
              aria-hidden
              width={450}
              height={122}
              className="h-auto w-full max-w-md dark:hidden"
            />
            <img
              src="/brand/lor-wordmark.webp"
              alt=""
              aria-hidden
              width={450}
              height={122}
              className="hidden h-auto w-full max-w-md dark:block"
            />
            <p className="mt-6 max-w-2xl text-muted-foreground sm:text-lg">
              Strategy, deck building, and tournaments for Redemption — the collectible card
              game of biblical battles. Build and share decks, register for events, read
              player articles, and play online.
            </p>
          </div>
          {/* Archived splash art from the old landofredemption.com WordPress header. The
              original plate is a near-black render made for a dark header, so it ships as-is
              for dark themes; `-light` is the same drawing with its levels restored to ink on
              transparent, since multiplying the dark plate onto white only made a grey smear.
              Same two-file swap as the wordmark above (`dark:` covers .dark and .jayden). A
              radial mask dissolves both on all four sides so the art reads as texture, not a
              pasted box. Hidden below `lg` — no free column to put it in. */}
          <div className="relative hidden w-64 shrink-0 lg:block xl:w-80">
            <img
              src="/brand/hero-splash-light.webp"
              alt=""
              aria-hidden
              width={640}
              height={462}
              className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-multiply [mask-image:radial-gradient(65%_65%_at_50%_45%,black_20%,transparent_100%)] dark:hidden"
            />
            <img
              src="/brand/hero-splash.webp"
              alt=""
              aria-hidden
              width={900}
              height={650}
              className="absolute inset-0 hidden h-full w-full object-cover opacity-70 [mask-image:radial-gradient(65%_65%_at_50%_45%,black_20%,transparent_100%)] dark:block"
            />
          </div>
        </section>

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
      <SponsorFooter />
    </div>
  );
}
