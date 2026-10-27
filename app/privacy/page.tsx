import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";

export const metadata = {
  title: "Privacy",
  description: "How Land of Redemption handles your data, including photos sent to the card scanner.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">Privacy</h1>

        <section className="mt-8">
          <h2 className="text-xl font-semibold text-foreground">Card scanner</h2>
          <p className="mt-3 text-base leading-relaxed text-foreground">
            Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days
            unless its safety systems flag them (then up to two years) and does not train on them.
            We keep the text we read from each card, not the photo.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-relaxed text-foreground">
            <li>We keep the text read from each card, plus token counts and cost. We do not keep the photo.</li>
            <li>Text read from photos where no card matched is deleted after 30 days.</li>
            <li>Scanning requires an account and is limited per user.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
