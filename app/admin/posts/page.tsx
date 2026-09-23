import Link from "next/link";
import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import { Button } from "@/components/ui/button";
import { getPosterContext } from "./lib/auth";
import { listMyPostsAction, type PostRow } from "./actions";
import AuthorProfileCard from "./components/AuthorProfileCard";

export const metadata = { title: "Posts" };
export const dynamic = "force-dynamic";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtScheduled(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Section({
  heading,
  posts,
  showAuthor,
  dateLabel = (p) => fmt(p.published_at ?? p.updated_at),
}: {
  heading: string;
  posts: PostRow[];
  showAuthor: boolean;
  dateLabel?: (p: PostRow) => string;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {heading} · {posts.length}
      </h2>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
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
    </section>
  );
}

export default async function PostsAdminPage() {
  const ctx = await getPosterContext();
  if (!ctx) notFound(); // invisible to everyone else — portal precedent
  const [r, profileRes] = await Promise.all([
    listMyPostsAction(),
    ctx.supabase.from("profiles").select("username, avatar_url, bio").eq("id", ctx.user.id).single(),
  ]);
  const posts = r.success === false ? [] : r.posts;
  const profile = profileRes.data;

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
        {r.success === false && <p className="mb-4 text-sm text-destructive">{r.error}</p>}
        <Section
          heading="Scheduled"
          posts={posts.filter((p) => p.status === "draft" && p.scheduled_at !== null)}
          showAuthor={ctx.isSuperuser}
          dateLabel={(p) => `Scheduled for ${fmtScheduled(p.scheduled_at!)}`}
        />
        <Section heading="Drafts" posts={posts.filter((p) => p.status === "draft" && p.scheduled_at === null)} showAuthor={ctx.isSuperuser} />
        <Section heading="Published" posts={posts.filter((p) => p.status === "published")} showAuthor={ctx.isSuperuser} />
      </div>
    </div>
  );
}
