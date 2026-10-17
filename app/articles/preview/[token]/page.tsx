import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import ArticleView from "../../components/ArticleView";
import { loadPostPreview } from "../../lib/queries";
import { resolveArticleRefs } from "../../lib/refs";

// A draft shared by secret link for proofreading. Rendered per request, never
// cached, so an edit shows on refresh and a link turned off stops at once.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const post = await loadPostPreview(token);
  return {
    title: post ? `Preview: ${post.title}` : "Preview not found",
    robots: { index: false, follow: false },
  };
}

export default async function ArticlePreviewPage({ params }: PageProps) {
  const { token } = await params;
  const post = await loadPostPreview(token);
  if (!post) notFound();
  // Once it's live the real article is the thing to read.
  if (post.status === "published") redirect(`/articles/${post.slug}`);
  const refs = await resolveArticleRefs(post.body_md);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="border-b border-border/60 bg-muted/50">
        <p className="mx-auto w-full max-w-2xl px-4 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Preview.</span> This article isn&apos;t published yet. Please
          don&apos;t share this link.
        </p>
      </div>
      <article className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
        <ArticleView post={post} refs={refs} />
      </article>
      <SiteFooter />
    </div>
  );
}
