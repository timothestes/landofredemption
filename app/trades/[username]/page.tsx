import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { loadPublicTradeListAction } from "../actions";
import { CARD_BY_FULL_KEY } from "../../decklist/card-search/data/cardIndex";
import { splitTradeItems, totalCopies, type TradeItem } from "../lib/tradeList";
import { sampleTradeItems } from "../lib/previewSample";
import TradeListView, { type DisplayTradeItem } from "./client";

interface PageProps {
  params: Promise<{ username: string }>;
}

// Shared by generateMetadata and the page so the list loads once per request.
const loadList = cache((username: string) => loadPublicTradeListAction(username));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const result = await loadList(decodeURIComponent(username));
  if (!result.found) return { title: "Trade List Not Found" };

  const { wants, haves } = splitTradeItems(result.items || []);
  const description = `${totalCopies(wants)} wanted · ${totalCopies(haves)} for trade`;
  return {
    title: `${result.username}'s Trade List`,
    description,
    // Shared by link; not something search engines should index.
    robots: { index: false, follow: false },
    openGraph: {
      title: `${result.username}'s Redemption trade list`,
      description,
      siteName: "Land of Redemption",
    },
  };
}

// The catalog lookup happens here so the client page doesn't ship it.
function withSetNames(items: TradeItem[]): DisplayTradeItem[] {
  return items.map((item) => ({
    ...item,
    setName:
      CARD_BY_FULL_KEY.get(`${item.cardName}|${item.cardSet}|${item.cardImgFile}`)?.officialSet ||
      item.cardSet,
  }));
}

export default async function TradeListPage({ params }: PageProps) {
  const { username } = await params;
  const result = await loadList(decodeURIComponent(username));
  if (!result.found || !result.username) notFound();

  return (
    <TradeListView
      username={result.username}
      items={withSetNames(result.previewMode ? sampleTradeItems() : result.items || [])}
      isOwner={result.isOwner ?? false}
      isShared={result.isShared ?? false}
      previewMode={result.previewMode ?? false}
      updatedAt={result.updatedAt ?? null}
    />
  );
}
