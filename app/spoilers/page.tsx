import TopNav from "../../components/top-nav";
import SiteFooter from "../../components/site-footer";
import { loadPublicSpoilersAction } from "./actions";
import SpoilersClient from "./spoilers-client";

export const metadata = {
  title: "Card Spoilers",
  description:
    "Preview cards from upcoming Redemption CCG sets as they are revealed.",
  alternates: { canonical: "/spoilers" },
};

export default async function SpoilersPage() {
  const { spoilers } = await loadPublicSpoilersAction();

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <TopNav />
      <div className="flex-1">
        <SpoilersClient initialSpoilers={spoilers} />
      </div>
      <SiteFooter />
    </div>
  );
}
