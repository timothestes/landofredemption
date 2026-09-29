import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadUpcomingListings } from "./actions";
import TournamentsClient from "./tournaments-client";

export const metadata = {
  title: "Upcoming Tournaments",
  description:
    "Find upcoming Redemption card game tournaments near you. Browse dates, locations, formats, and entry fees.",
  alternates: { canonical: "/tournaments" },
};

export default async function TournamentsPage() {
  const listings = await loadUpcomingListings();

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1">
        <TournamentsClient listings={listings} />
      </div>
      <SiteFooter />
    </div>
  );
}
