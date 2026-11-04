"use client";

export type ViewId =
  | "tournaments"
  | "champions"
  | "players"
  | "trivia"
  | "stats"
  | "tape"
  | "search"
  | "detail"
  | "player";

// Note: "detail" and "player" are intentionally excluded — they are drill-down views, not top-level tabs.
const TABS: { id: ViewId; label: string }[] = [
  { id: "tournaments", label: "Tournaments" },
  { id: "champions", label: "Hall of Champions" },
  { id: "players", label: "Players" },
  { id: "trivia", label: "Trivia" },
  { id: "stats", label: "Advanced Metrics" },
  { id: "tape", label: "Tale of the Tape" },
  { id: "search", label: "Search" },
];

interface NavTabsProps {
  view: ViewId;
  setView: (view: ViewId) => void;
}

export default function NavTabs({ view, setView }: NavTabsProps) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border no-scrollbar scroll-fade-x">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setView(tab.id)}
          className={
            view === tab.id
              ? "shrink-0 px-4 py-3 text-sm font-medium text-primary border-b-2 border-primary"
              : "shrink-0 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border-b-2 border-transparent"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
