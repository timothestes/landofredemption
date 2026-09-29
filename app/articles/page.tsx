import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadPublishedPosts, listPublishedTags, PAGE_SIZE } from "./lib/queries";
import PostCard from "./components/PostCard";

export const metadata: Metadata = {
  title: "Articles",
  description: "Strategy, deck techs, tournament reports and news for Redemption CCG.",
  alternates: { canonical: "/articles", types: { "application/rss+xml": "/articles/feed.xml" } },
};

interface PageProps {
  searchParams: Promise<{ page?: string; tag?: string }>;
}

/** Series chips in the rail before the long tail folds into "All topics". */
const RAIL = 10;

const CHIP =
  "inline-flex min-h-11 items-center rounded-full border border-border bg-foreground/[0.03] px-3 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground";

function pageHref(page: number, tag: string | null): string {
  const sp = new URLSearchParams();
  if (tag) sp.set("tag", tag);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/articles?${qs}` : "/articles";
}

export default async function ArticlesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const tag = sp.tag?.trim() || null;

  // Validate ?tag against the (cached) tag list before it reaches a cache key
  // and a count:exact scan — an unknown tag is the empty state, no DB work.
  const tags = await listPublishedTags();
  const known = tag && tags.includes(tag) ? tag : null;
  const { posts, total } =
    tag && !known ? { posts: [], total: 0 } : await loadPublishedPosts({ page, tag: known });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Past-the-end (?page=99, or the last post on a page being unpublished)
  // used to render an empty list with no pager and no way back. Land the
  // reader on the last real page instead.
  if (page > pageCount) redirect(pageHref(pageCount, tag));

  const others = tags.filter((t) => t !== tag);
  const rail = others.slice(0, RAIL);
  const more = others.slice(RAIL);

  // Page 1 without a tag filter opens with the newest post as the lead, the
  // next few beside it as headlines, and the remainder below as rows. Every
  // other page (or a tag filter) is the plain row list.
  const [lead, ...after] = page === 1 && !tag ? posts : [];
  const beside = after.slice(0, 4);
  const rest = after.slice(4);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:mb-8">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight sm:text-4xl">Articles</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} {total === 1 ? "article" : "articles"}
            {tag ? ` in “${tag}”` : ""}
          </p>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Browse by series
              </p>
              {/* One row that scrolls on phones (no visible scrollbar), wraps from sm up. */}
              <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {tag && (
                  <li className="shrink-0">
                    <Link
                      href="/articles"
                      className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-3 text-sm text-primary-foreground dark:text-background"
                    >
                      {tag} <span aria-hidden>×</span>
                      <span className="sr-only">clear tag filter</span>
                    </Link>
                  </li>
                )}
                {rail.map((t) => (
                  <li key={t} className="shrink-0">
                    <Link href={pageHref(1, t)} className={CHIP}>
                      {t}
                    </Link>
                  </li>
                ))}
              </ul>
              {more.length > 0 && (
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    All topics ({more.length}) <span aria-hidden>▾</span>
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {more.map((t) => (
                      <li key={t}>
                        <Link href={pageHref(1, t)} className={CHIP}>
                          {t}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </header>

        {total === 0 ? (
          <p className="text-muted-foreground">
            {tag ? (
              <>
                No articles tagged “{tag}”.{" "}
                <Link href="/articles" className="underline hover:text-foreground">
                  Show all articles
                </Link>
              </>
            ) : (
              "No articles yet."
            )}
          </p>
        ) : lead ? (
          <>
            <div className="grid gap-8 md:grid-cols-12 md:gap-x-10">
              <div className="md:col-span-7">
                <PostCard post={lead} priority />
              </div>
              {beside.length > 0 && (
                <div className="flex flex-col divide-y divide-border/60 border-t border-border/60 pt-6 md:col-span-5 md:border-t-0 md:pt-0">
                  {beside.map((p) => (
                    <PostCard key={p.id} post={p} variant="compact" />
                  ))}
                </div>
              )}
            </div>
            {rest.length > 0 && (
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 md:gap-x-10">
                {rest.map((p) => (
                  <PostCard key={p.id} post={p} variant="row" />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-10">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} variant="row" />
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Pagination">
            {page > 1 ? (
              <Link href={pageHref(page - 1, tag)} className="min-h-11 rounded-md px-3 py-2 hover:bg-muted">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={pageHref(page + 1, tag)} className="min-h-11 rounded-md px-3 py-2 hover:bg-muted">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
