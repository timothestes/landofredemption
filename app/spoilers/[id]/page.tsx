import { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { loadSpoilerByIdAction } from "../actions";
import TopNav from "../../../components/top-nav";
import SiteFooter from "../../../components/site-footer";
import ShareButton from "./share-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const { spoiler } = await loadSpoilerByIdAction(id);

  if (!spoiler) {
    return { title: "Card Not Found" };
  }

  const description = [
    spoiler.set_name,
    spoiler.set_number ? `#${spoiler.set_number}` : null,
    "Redemption CCG Spoiler",
  ]
    .filter(Boolean)
    .join(" \u00B7 ");

  return {
    title: `${spoiler.card_name} - Spoiler`,
    description,
    openGraph: {
      title: spoiler.card_name,
      description,
      type: "article",
      siteName: "Land of Redemption",
      images: [
        {
          url: spoiler.image_url,
          width: spoiler.image_width || 600,
          height: spoiler.image_height || 840,
          alt: spoiler.card_name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: spoiler.card_name,
      description,
      images: [spoiler.image_url],
    },
  };
}

function formatSpoilDate(dateStr: string): string {
  const spoilDate = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - spoilDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Spoiled today";
  if (diffDays === 1) return "Spoiled yesterday";
  if (diffDays < 7) return `Spoiled ${diffDays} days ago`;

  return `Spoiled ${spoilDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

export default async function SpoilerCardPage({ params }: PageProps) {
  const { id } = await params;
  const { spoiler, related } = await loadSpoilerByIdAction(id);

  if (!spoiler) {
    notFound();
  }

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const isNew = new Date(spoiler.spoil_date).getTime() >= threeDaysAgo;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <TopNav />
      <div className="flex-1 max-w-3xl mx-auto px-4 py-6 sm:py-8 w-full">
        {/* Back link */}
        <Link
          href="/spoilers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to spoilers
        </Link>

        {/* Card display */}
        <div className="flex flex-col items-center">
          <div className="relative w-full max-w-lg aspect-[5/7] rounded-lg overflow-hidden bg-muted/50">
            <Image
              src={spoiler.image_url}
              alt={spoiler.card_name}
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              className="object-contain"
              priority
            />
          </div>

          {/* Card info */}
          <div className="mt-4 text-center w-full">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold">{spoiler.card_name}</h1>
              {isNew && (
                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded uppercase">
                  New
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-1">
              {spoiler.set_name}
              {spoiler.set_number && ` \u00B7 ${spoiler.set_number}`}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-0.5">
              {formatSpoilDate(spoiler.spoil_date)}
            </p>

            {/* Share actions */}
            <div className="mt-3">
              <ShareButton cardName={spoiler.card_name} />
            </div>
          </div>
        </div>

        {/* More from this set */}
        {related.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                More from {spoiler.set_name}
              </h2>
              <Link
                href="/spoilers"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all
              </Link>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
              {related.slice(0, 10).map((r) => {
                const rIsNew = new Date(r.spoil_date).getTime() >= threeDaysAgo;
                return (
                  <Link
                    key={r.id}
                    href={`/spoilers/${r.id}`}
                    className="group relative"
                  >
                    <div className="relative aspect-[5/7] w-full rounded-md overflow-hidden bg-muted/50">
                      <Image
                        src={r.image_url}
                        alt={r.card_name}
                        fill
                        sizes="(max-width: 640px) 33vw, 20vw"
                        className="object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]"
                      />
                      {rIsNew && (
                        <span className="absolute top-1 right-1 px-1 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold rounded uppercase">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium truncate px-0.5">
                      {r.card_name}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
