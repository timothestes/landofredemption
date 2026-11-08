import type { ReactNode } from "react";
import Link from "next/link";
import { MessageSquare, GitPullRequest } from "lucide-react";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { cardRawText } from "@/app/forge/lib/designCard";
import { STATUS_LABEL, STATUS_BADGE_CLASS } from "@/app/forge/lib/lifecycleCopy";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

export type GridSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

export default function ForgeCardGrid({
  cards, showStatus = false, selection, leading, commentCounts, proposalCounts, releaseBadges, versionNumbers,
}: {
  cards: ForgeCardFull[];
  showStatus?: boolean;
  selection?: GridSelection;
  leading?: ReactNode;
  commentCounts?: Record<string, number>;
  proposalCounts?: Record<string, number>;
  releaseBadges?: Record<string, string>;
  // Latest version per card — appended to the status pill ("Draft · v2").
  versionNumbers?: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {leading}
      {cards.map((c) => {
        const t = Date.parse(c.updatedAt) || 0;
        // Shelved cards recede: desaturate + dim the face so they read as inactive
        // at a glance. Title + dashed status badge stay legible.
        const shelved = c.status === "archived";
        const faceClass = shelved ? "opacity-60 grayscale transition duration-200 group-hover:opacity-100 group-hover:grayscale-0" : undefined;
        const artUrl = c.hasArt ? `/forge/api/art/${c.id}?t=${t}` : null;
        const count = commentCounts?.[c.id] ?? 0;
        const propCount = proposalCounts?.[c.id] ?? 0;
        const release = releaseBadges?.[c.id];
        const inner = (
          <>
            <div className="relative">
              {/* Finished image when there is one; otherwise the rendered composite of the
                  live snapshot (same rule as the studio). */}
              {c.hasFinished ? (
                <ForgeCardFace
                  name={c.snapshot.name ?? null}
                  rawText={cardRawText(c.snapshot)}
                  finishedUrl={`/forge/api/art/${c.id}?kind=finished&t=${t}`}
                  artUrl={artUrl}
                  className={faceClass}
                />
              ) : (
                <ForgeCardPreview card={c.snapshot} artUrl={artUrl} className={faceClass} />
              )}
              {count > 0 && (
                <span
                  className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm"
                  title={`${count} unresolved comment${count === 1 ? "" : "s"}`}
                >
                  <MessageSquare className="h-3 w-3" />
                  {count}
                </span>
              )}
              {propCount > 0 && (
                <span
                  className="absolute bottom-1 right-1 z-10 flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shadow-sm backdrop-blur-sm dark:text-amber-400"
                  title={`${propCount} open proposal${propCount === 1 ? "" : "s"}`}
                >
                  <GitPullRequest className="h-3 w-3" />
                  {propCount}
                </span>
              )}
              {release && (
                <span
                  className="absolute bottom-1 left-1 z-10 rounded-full border bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm"
                  title={`Latest version ${release}`}
                >
                  {release}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <p className="min-w-[6rem] flex-1 truncate text-xs text-muted-foreground">{c.title ?? "Untitled"}</p>
              {showStatus && (
                <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE_CLASS[c.status] ?? "text-muted-foreground"}`}>
                  {STATUS_LABEL[c.status] ?? c.status}
                  {versionNumbers?.[c.id] != null && <> · v{versionNumbers[c.id]}</>}
                </span>
              )}
            </div>
          </>
        );
        if (selection?.active) {
          const isSel = selection.selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => selection.onToggle(c.id)}
              aria-pressed={isSel}
              className="group relative block text-left transition hover:opacity-90"
            >
              <span
                aria-hidden
                className={`absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border-2 text-sm font-bold shadow-md ${
                  isSel ? "border-primary bg-primary text-primary-foreground" : "border-gray-400 bg-white text-transparent"
                }`}
              >
                {isSel ? "✓" : ""}
              </span>
              {isSel && (
                <span aria-hidden className="pointer-events-none absolute -inset-0.5 rounded-lg border border-primary/40" />
              )}
              {inner}
            </button>
          );
        }
        return (
          <Link key={c.id} href={`/forge/cards/${c.id}`} className="group block transition hover:opacity-90">
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
