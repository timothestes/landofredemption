import Link from "next/link";
import { postByline, postExcerpt, type PublicPost } from "../lib/queries";

export function formatPostDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface PostCardProps {
  post: PublicPost;
  /**
   * `default` = the lead story: cover, kicker, title, excerpt and byline stacked as plain text.
   * `compact` = thumbnail + title row for a `divide-y` list (landing headlines, "More in …").
   * `row` = wider thumbnail, kicker, title, one-line excerpt and byline; draws its own top hairline
   * so it works in a multi-column grid where `divide-y` can't.
   */
  variant?: "default" | "compact" | "row";
  /** Eager, high-priority cover — only for the one card that is the page's LCP. */
  priority?: boolean;
  headingLevel?: 2 | 3;
}

function CoverImage({ src, priority }: { src: string; priority: boolean }) {
  // The wrapper owns the aspect ratio; the image fills it absolutely so a
  // tall cover can't grow the box (h-full on a static img never resolved
  // against the ratio-derived height, so every cover laid out at natural size).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/** Cover slot for the ~3% of posts without an image: a Cinzel initial on the muted plate. */
function CoverPlate({ title }: { title: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-center justify-center font-cinzel text-4xl font-semibold text-muted-foreground/50"
    >
      {title.trim().charAt(0)}
    </span>
  );
}

// The title link is stretched over the whole card (`after:absolute after:inset-0`
// on a `relative` article), so the entire row/tile is the tap target while the
// accessible name stays the title. The kicker link sits above it with z-10.
const STRETCHED = "hover:underline after:absolute after:inset-0";

/** House small-caps label: kickers and bylines. Never Cinzel. */
const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

export default function PostCard({ post, variant = "default", priority = false, headingLevel = 2 }: PostCardProps) {
  const href = `/articles/${post.slug}`;
  const H = `h${headingLevel}` as const;
  const byline = [postByline(post), formatPostDate(post.published_at)].filter(Boolean).join(" · ");
  const kicker = post.tags[0];
  const kickerHref = kicker ? `/articles?tag=${encodeURIComponent(kicker)}` : null;

  if (variant === "compact") {
    return (
      <article className="relative flex gap-3 py-3 first:pt-0">
        <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-sm bg-muted/60 sm:w-28">
          {post.cover_image_url ? (
            <CoverImage src={post.cover_image_url} priority={false} />
          ) : (
            <CoverPlate title={post.title} />
          )}
        </div>
        <div className="min-w-0">
          <p className={LABEL}>{byline}</p>
          <H className="mt-1 line-clamp-2 font-cinzel text-base font-semibold leading-snug">
            <Link href={href} className={STRETCHED}>
              {post.title}
            </Link>
          </H>
        </div>
      </article>
    );
  }

  if (variant === "row") {
    return (
      <article className="relative flex gap-4 border-t border-border/60 py-4">
        <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-sm bg-muted/60 sm:w-36">
          {post.cover_image_url ? (
            <CoverImage src={post.cover_image_url} priority={false} />
          ) : (
            <CoverPlate title={post.title} />
          )}
        </div>
        <div className="min-w-0">
          {kickerHref && (
            <Link href={kickerHref} className={`relative z-10 block w-fit hover:text-foreground ${LABEL}`}>
              {kicker}
            </Link>
          )}
          <H className="mt-1 line-clamp-2 font-cinzel text-base font-semibold leading-snug sm:text-lg">
            <Link href={href} className={STRETCHED}>
              {post.title}
            </Link>
          </H>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:line-clamp-1">{postExcerpt(post)}</p>
          <p className={`mt-1.5 ${LABEL}`}>{byline}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="relative flex flex-col gap-2">
      <div className="relative mb-2 aspect-[16/9] w-full overflow-hidden rounded-sm bg-muted/60">
        {post.cover_image_url ? (
          <CoverImage src={post.cover_image_url} priority={priority} />
        ) : (
          <CoverPlate title={post.title} />
        )}
      </div>
      {kickerHref && (
        <Link href={kickerHref} className={`relative z-10 self-start hover:text-foreground ${LABEL}`}>
          {kicker}
        </Link>
      )}
      <H className="font-cinzel text-2xl font-semibold leading-snug lg:text-3xl lg:leading-tight">
        <Link href={href} className={STRETCHED}>
          {post.title}
        </Link>
      </H>
      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground sm:text-base">{postExcerpt(post)}</p>
      <p className={`mt-1 ${LABEL}`}>{byline}</p>
    </article>
  );
}
