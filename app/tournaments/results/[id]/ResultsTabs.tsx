import Link from "next/link";

/**
 * Tab strip shared by the two public views of a finished tournament.
 *
 * These are real routes rather than client state so each view is linkable and
 * server-rendered. Rendered as the site's chip strip (rounded-full, 44px tall);
 * the active chip is filled with the foreground colour, and green stays reserved
 * for hover and CTAs rather than resting state.
 */
export default function ResultsTabs({
  tournamentId,
  active,
  showBreakdown,
}: {
  tournamentId: string;
  active: "standings" | "breakdown";
  showBreakdown: boolean;
}) {
  if (!showBreakdown) return null;

  const tabs = [
    { key: "standings" as const, label: "Standings", href: `/tournaments/results/${tournamentId}` },
    { key: "breakdown" as const, label: "Breakdown", href: `/tournaments/results/${tournamentId}/breakdown` },
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
