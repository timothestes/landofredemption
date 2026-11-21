import { GeistSans } from "geist/font/sans";
import { cn } from "@/lib/utils";
import { parseTournamentName } from "@/utils/tournament/displayName";

/**
 * A stored tournament name on two lines: the event, then a quiet "date ·
 * location". It goes inside a heading or a row and the first line takes that
 * element's font and size; the second is always small Geist, so it can sit in
 * a Cinzel h1. The full stored name stays on hover. A name that is not in the
 * generated shape prints on one line as it is.
 */
export function TournamentName({
  name,
  title,
  className,
}: {
  name: string;
  /** Hover text, where the page has something better to say than the stored name. */
  title?: string;
  className?: string;
}) {
  const parts = parseTournamentName(name);
  const meta = [parts.date, parts.location].filter(Boolean).join(" · ");
  return (
    <span className={className} title={title ?? name}>
      <span className="block">{parts.title}</span>
      {meta && (
        <span
          className={cn(
            GeistSans.className,
            "mt-0.5 block text-sm font-normal tracking-normal text-muted-foreground",
          )}
        >
          {meta}
        </span>
      )}
    </span>
  );
}
