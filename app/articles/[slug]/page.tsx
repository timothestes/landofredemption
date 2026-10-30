import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import ArticleView from "../components/ArticleView";
import { resolveArticleRefs } from "../lib/refs";
import PostCard from "../components/PostCard";
import { postCoverUrl } from "../lib/coverImage";
import {
  listPublishedTags,
  loadPostBySlug,
  loadPostsByTag,
  loadPublishedPosts,
  postByline,
  postExcerpt,
} from "../lib/queries";

export const revalidate = 3600;

// Without generateStaticParams a dynamic segment is server-rendered on every
// request and never enters the ISR cache, so each of the ~1,300 article URLs
// cost a function invocation per crawler hit. Returning [] opts the route into
// static generation with dynamicParams (the default): nothing is prerendered
// at build time, and each slug is rendered once on first request and then
// served from the CDN until revalidated.
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadPostBySlug(slug);
  if (!post) return { title: "Article not found" };
  const description = postExcerpt(post);
  const cover = postCoverUrl(post);
  const images = cover ? [{ url: cover, alt: post.title }] : undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: `/articles/${slug}` },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      siteName: "Land of Redemption",
      publishedTime: post.published_at ?? undefined,
      authors: [postByline(post)],
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: images?.map((i) => i.url),
    },
  };
}

export default async function ArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = await loadPostBySlug(slug);
  if (!post) notFound();
  const cover = postCoverUrl(post);

  // Tags act as series. Prefer the post's RAREST tag (the author's own series)
  // over a broad category such as "News", which the WordPress import often put
  // first. listPublishedTags() is cached and sorted most-common first, so a
  // higher index means rarer. Untagged posts, and posts whose series has
  // nothing else in it, fall back to the already-cached page-1 list.
  const byFrequency = await listPublishedTags();
  const rarity = (t: string) => {
    const i = byFrequency.indexOf(t);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const series = post.tags.length > 0 ? [...post.tags].sort((a, b) => rarity(b) - rarity(a))[0] : null;
  const inSeries = series ? (await loadPostsByTag(series, 4)).filter((p) => p.id !== post.id) : [];
  const isSeries = inSeries.length > 0;
  const more = (isSeries ? inSeries : (await loadPublishedPosts({ page: 1 })).posts.filter((p) => p.id !== post.id)).slice(0, 3);
  // Card mentions and deck embeds: resolved here so the shared renderer stays
  // free of the card index and Supabase.
  const refs = await resolveArticleRefs(post.body_md);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <article className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: post.title,
              datePublished: post.published_at ?? undefined,
              dateModified: post.updated_at ?? undefined,
              author: { "@type": "Person", name: postByline(post) },
              ...(cover ? { image: [cover] } : {}),
            }),
          }}
        />
        <Link
          href="/articles"
          className="mb-5 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← All articles
        </Link>
        <ArticleView post={post} refs={refs} />
        {more.length > 0 && (
          <section aria-labelledby="keep-reading" className="mt-10 border-t border-border/60 pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="keep-reading" className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {isSeries ? `More in ${series}` : "Latest articles"}
              </h2>
              <Link
                href={isSeries ? `/articles?tag=${encodeURIComponent(series)}` : "/articles"}
                className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
              >
                {isSeries ? "All in this series →" : "All articles →"}
              </Link>
            </div>
            <div className="mt-4 flex flex-col divide-y divide-border/60">
              {more.map((p) => (
                <PostCard key={p.id} post={p} variant="compact" headingLevel={3} />
              ))}
            </div>
          </section>
        )}
      </article>
      <SiteFooter />
    </div>
  );
}
