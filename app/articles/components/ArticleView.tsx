import Link from "next/link";
import ArticleBody from "./ArticleBody";
import AuthorBio from "./AuthorBio";
import { formatPostDate } from "./PostCard";
import EditLink from "../[slug]/EditLink";
import { coverImageProps } from "../lib/coverImage";
import { postByline, type PublicPost } from "../lib/queries";
import type { ArticleRefs } from "../lib/refTypes";

// Header, cover, body and author bio: everything a reader sees of the post
// itself. Shared by the public article page and the draft preview link so a
// proofreader sees exactly what readers will.
export default function ArticleView({ post, refs }: { post: PublicPost; refs: ArticleRefs }) {
  const byline = [postByline(post), formatPostDate(post.published_at)].filter(Boolean).join(" · ");
  return (
    <>
      <header className="mb-6">
        {post.tags.length > 0 && (
          <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {post.tags.map((t) => (
              <Link key={t} href={`/articles?tag=${encodeURIComponent(t)}`} className="hover:text-foreground">
                {t}
              </Link>
            ))}
          </p>
        )}
        <h1 className="font-cinzel text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{post.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">by {byline}</p>
          <EditLink postId={post.id} authorId={post.author_id} />
        </div>
      </header>
      {post.cover_image_url && (
        // Natural aspect ratio, no plate: a wide cover is never letterboxed.
        // Only a very tall cover is capped, and object-contain keeps it whole.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...coverImageProps(post.cover_image_url, [640, 828, 1080, 1200, 1920])}
          sizes="(min-width: 768px) 736px, 100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
          className="mb-6 h-auto max-h-[60vh] w-full rounded-sm object-contain"
        />
      )}
      <ArticleBody markdown={post.body_md} refs={refs} />
      <AuthorBio post={post} />
    </>
  );
}
