import HeaderServer from "../../components/header-server";
import TopNav from "../../components/top-nav";
import SiteFooter from "../../components/site-footer";
import { Suspense } from "react";

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <div className="flex-1 flex flex-col">
        <Suspense fallback={null}>
          <HeaderServer />
        </Suspense>
        <main className="flex-1 flex flex-col min-h-0">{children}</main>
      </div>
      <SiteFooter />
    </div>
  );
}
