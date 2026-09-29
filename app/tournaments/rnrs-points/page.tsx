import Image from "next/image";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { fetchAllRnrsData } from "@/lib/rnrs/fetch";
import RnrsClient from "./RnrsClient";

export const metadata = {
  title: "RNRS Points",
  description:
    "Redemption National Ranking System standings — leaderboards and player lookup across seasons and formats, with per-format point caps shown.",
};

// Sheet data is cached for an hour at the fetch layer; keep the page revalidating
// on the same cadence.
export const revalidate = 3600;

export default async function RnrsPointsPage() {
  const data = await fetchAllRnrsData();

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <RnrsClient data={data} />

        {/* Attribution — the supplied logo is the white-wordmark (dark-bg)
            variant, so it sits on a dark branded badge to stay legible in
            both light and dark themes. */}
        <div className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-8">
            <a
              href="https://thethreshingfloorpodcast.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-auto flex max-w-xs flex-col items-center gap-3 rounded-xl bg-zinc-900 px-6 py-6 text-center ring-1 ring-white/10 transition hover:ring-white/25"
            >
              <Image
                src="/threshingfloor/the-threshing-floor-logo-wheat-light-tag.png"
                alt="The Threshing Floor"
                width={120}
                height={128}
                className="h-20 w-auto"
              />
              <span className="text-sm text-zinc-300">
                RNRS Points brought to you by{" "}
                <span className="font-semibold text-white">
                  The Threshing Floor
                </span>
              </span>
            </a>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
