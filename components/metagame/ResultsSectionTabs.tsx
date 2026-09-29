import Link from "next/link";

/**
 * Top-level tab strip across the two public results surfaces.
 *
 * Real routes rather than client state, matching the per-event tabs: each view
 * is linkable and server-rendered. Rendered as the site's chip strip (rounded-full,
 * 44px tall); the active chip is filled with the foreground colour, and green
 * stays reserved for hover and CTAs rather than resting state.
 */
export default function ResultsSectionTabs({
  active,
}: {
  active: "events" | "metagame";
}) {
  const tabs = [
    { key: "events" as const, label: "Events", href: "/tournaments/results" },
    { key: "metagame" as const, label: "Metagame", href: "/tournaments/metagame" },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border px-3 text-sm transition-colors ${
              isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-foreground/[0.03] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
