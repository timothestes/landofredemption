import HeaderServer from "../../components/header-server";
import TopNav from "../../components/top-nav";
import SiteFooter from "../../components/site-footer";

export default function TournamentsLayout({ children }) {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1 flex flex-col">
        <HeaderServer />
        <main className="flex-1 py-4">
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
