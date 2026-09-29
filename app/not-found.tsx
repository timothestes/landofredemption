import Link from "next/link";
import TopNav from "../components/top-nav";
import SiteFooter from "../components/site-footer";

export const metadata = {
  title: "Page Not Found",
  description: "The page you requested does not exist or has moved.",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav />
      <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="font-cinzel text-4xl font-bold tracking-tight">404</h1>
        <p className="text-muted-foreground">This page could not be found.</p>
        <Link href="/" className="text-primary underline underline-offset-4">
          Back to home
        </Link>
      </div>
      <SiteFooter />
    </div>
  );
}
