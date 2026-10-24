import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { loadPublicTradeListAction, loadVisitorMatchDataAction } from "../actions";
import { splitTradeItems, totalCopies } from "../lib/tradeList";
import { withCardInfo } from "../lib/cardInfo";
import { getCardImageUrlOrNull } from "../../shared/utils/cardImageUrl";
import TradeListView from "./client";

interface PageProps {
  params: Promise<{ username: string }>;
}

// Shared by generateMetadata and the page so the list loads once per request.
const loadList = cache(loadPublicTradeListAction);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const result = await loadList(username);
  if (!result.found) return { title: "Trade List Not Found" };

  const { priorityWants, wants, haves } = splitTradeItems(result.items || []);
  const description = `${totalCopies(priorityWants) + totalCopies(wants)} wanted · ${totalCopies(haves)} for trade`;
  // Link-preview card: the top priority Want, else the first Want, else the first Have.
  const lead = priorityWants[0] ?? wants[0] ?? haves[0];
  const image = getCardImageUrlOrNull(lead?.cardImgFile) ?? undefined;
  const title = `${result.username}'s Redemption trade list`;

  return {
    title: `${result.username}'s Trade List`,
    description,
    // Shared by link; not something search engines should index.
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      siteName: "Land of Redemption",
      ...(image && { images: [{ url: image, width: 375, height: 525, alt: lead.cardName }] }),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image && { images: [image] }),
    },
  };
}

export default async function TradeListPage({ params }: PageProps) {
  const { username } = await params;
  const result = await loadList(username);
  if (!result.found || !result.username) notFound();

  const items = result.items || [];
  const isOwner = result.isOwner ?? false;
  const visitor = isOwner
    ? null
    : await loadVisitorMatchDataAction({
        wantNames: items.filter((i) => i.kind === "want").map((i) => i.cardName),
        haveNames: items.filter((i) => i.kind === "have").map((i) => i.cardName),
      });

  return (
    <TradeListView
      username={result.username}
      // Catalog join runs here so the client page doesn't ship the catalog.
      items={withCardInfo(items)}
      isOwner={isOwner}
      isShared={result.isShared ?? false}
      // Fixed locale/zone: a client-side toLocaleDateString would hydrate differently.
      updatedLabel={
        result.updatedAt
          ? new Date(result.updatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "America/New_York",
            })
          : null
      }
      visitor={visitor}
    />
  );
}
