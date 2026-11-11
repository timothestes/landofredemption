import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import TopNav from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { getPosterContext } from "./lib/auth";
import { loadPostLists, parsePage, parseQuery, PAGE_SIZE, type PostListRow } from "./lib/list";
import AuthorProfileCard from "./components/AuthorProfileCard";
import LocalDateTime from "./components/LocalDateTime";

export const metadata = { title: "Posts" };
export const dynamic = "force-dynamic";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Section({
  heading,
  count,
  posts,
  showAuthor,
  emptyText = "None.",
  footer,
  dateLabel = (p) => fmt(p.published_at ?? p.updated_at),
}: {
  heading: string;
  count: number;
  posts: PostListRow[];
  showAuthor: boolean;
  emptyText?: string;
  footer?: React.ReactNode;
  dateLabel?: (p: PostListRow) => React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {heading} · {count}
      </h2>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {posts.map((p) => (
            <li key={p.id}>
              <Link
                href={`/admin/posts/${p.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-card px-3 py-2 hover:bg-muted/60"
              >
                <span className="truncate font-medium">{p.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {showAuthor && p.author?.username ? `${p.author.username} · ` : ""}
                  {dateLabel(p)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}

function Pager({ page, pageCount, q }: { page: number; pageCount: number; q: string }) {
  const href = (n: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (n > 1) params.set("page", String(n));
    const s = params.toString();
    return s ? `/admin/posts?${s}` : "/admin/posts";
  };
  const cls = "inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm";
  const live = `${cls} bg-card hover:bg-muted/60`;
  const dead = `${cls} cursor-not-allowed text-muted-foreground/50`;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={live} rel="prev">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Newer
        </Link>
      ) : (
        <span className={dead} aria-disabled>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Newer
        </span>
      )}
      <span className="text-xs text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={href(page + 1)} className={live} rel="next">
          Older <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span className={dead} aria-disabled>
          Older <ChevronRight className="h-4 w-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}

export default async function PostsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await getPosterContext();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent
  const sp = await searchParams;
  const q = parseQuery(sp.q);
  const [lists, profileRes] = await Promise.all([
    loadPostLists(ctx, parsePage(sp.page), q),
    ctx.supabase.from("profiles").select("username, avatar_url, bio").eq("id", ctx.user.id).single(),
  ]);
  const profile = profileRes.data;
  const { page, pageCount, publishedTotal } = lists;
  const first = publishedTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, publishedTotal);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-cinzel text-2xl font-bold sm:text-3xl">Posts</h1>
          <Button asChild className="min-h-11">
            <Link href="/admin/posts/new">New post</Link>
          </Button>
        </div>
        <AuthorProfileCard
          username={profile?.username ?? null}
          initialAvatarUrl={profile?.avatar_url ?? null}
          initialBio={profile?.bio ?? null}
        />
        {lists.error && <p className="mb-4 text-sm text-destructive">{lists.error}</p>}
        {lists.scheduled.length > 0 && (
          <Section
            heading="Scheduled"
            count={lists.scheduled.length}
            posts={lists.scheduled}
            showAuthor={ctx.isSuperuser}
            dateLabel={(p) => (
              <>
                Scheduled for <LocalDateTime iso={p.scheduled_at!} />
              </>
            )}
          />
        )}
        {lists.drafts.length > 0 && (
          <Section heading="Drafts" count={lists.drafts.length} posts={lists.drafts} showAuthor={ctx.isSuperuser} />
        )}

        <div>
          <form action="/admin/posts" method="get" role="search" className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search published titles"
                aria-label="Search published posts by title"
                className="min-h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary" className="min-h-11">
              Search
            </Button>
            {q && (
              <Button asChild variant="ghost" className="min-h-11">
                <Link href="/admin/posts">Clear</Link>
              </Button>
            )}
          </form>
          <Section
            heading={q ? `Published matching “${q}”` : "Published"}
            count={publishedTotal}
            posts={lists.published}
            showAuthor={ctx.isSuperuser}
            emptyText={q ? "No published posts match that search." : "None."}
            footer={
              <>
                {publishedTotal > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing {first}–{last}, newest first
                  </p>
                )}
                {pageCount > 1 && <Pager page={page} pageCount={pageCount} q={q} />}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
