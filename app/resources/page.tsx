import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { RESOURCE_SECTIONS, RESOURCE_APP_TOOLS, type ResourceLink } from "@/lib/resources";

export const metadata = {
  title: "Redemption Resources",
  description:
    "Every official Redemption CCG document in one place — the REG rulebook, ORDIR dictionary, deck building rules, Paragon format files, and tournament host forms.",
  alternates: { canonical: "/resources" },
};

function ExternalIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5M15 3h6m0 0v6m0-6L10.5 13.5"
      />
    </svg>
  );
}

function ResourceRow({ link }: { link: ResourceLink }) {
  const Icon = link.icon;
  const body = (
    <>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          {link.label}
        </span>
        {link.internal ? null : <ExternalIcon />}
      </div>
      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
        {link.description}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-semibold tracking-wide">
          {link.internal ? "On this site" : "PDF"}
        </span>
        {link.version && <span>{link.version}</span>}
        {link.published && (
          <>
            {link.version && <span aria-hidden>·</span>}
            <span>Published {link.published}</span>
          </>
        )}
      </div>
    </>
  );

  const className =
    "group block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-muted/40";

  return link.internal ? (
    <Link href={link.href} className={className}>
      {body}
    </Link>
  ) : (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  );
}

export default function ResourcesPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">
          Redemption Resources
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          The official rulebooks, format documents, and host forms for Redemption CCG,
          collected in one place. Every link points at the current published version — when
          a new one comes out, this page is updated, so you can link here once instead of
          maintaining your own list.
        </p>

        {/* Jump links — the host section alone is ten documents long. */}
        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Sections">
          {RESOURCE_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              {section.title}
            </a>
          ))}
        </nav>

        {RESOURCE_SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="mt-10 scroll-mt-20">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {section.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
            <div className="mt-4 space-y-2">
              {section.links.map((link) => (
                <ResourceRow key={link.href} link={link} />
              ))}
            </div>
          </section>
        ))}

        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Tools on this site
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Free for anyone to use, no account needed to browse.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {RESOURCE_APP_TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="group block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {tool.label}
                </span>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                  {tool.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <p className="mt-12 text-xs text-muted-foreground leading-relaxed">
          Documents are published by{" "}
          <a
            href="https://www.cactusgamedesign.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Cactus Game Design
          </a>
          . Spotted a broken or out-of-date link?{" "}
          <Link href="/tracker/bug" className="underline underline-offset-2 hover:text-foreground">
            Let us know
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
