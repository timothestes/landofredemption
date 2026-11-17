import { cn } from "@/lib/utils";
import { FORMATS, normalizeFormat } from "@/lib/formats";

// Formats not listed here (Unlimited, Teams) take the blue default.
const COLORS: Record<string, string> = {
  T2: "bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300",
  Paragon: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
  Limited: "bg-orange-100 dark:bg-orange-900/60 text-orange-700 dark:text-orange-300",
};
const DEFAULT_COLORS = "bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300";

/**
 * The coloured format chip shown beside a deck. Short label by default
 * (L, U, T2, P); `full` spells the format out (Limited, Unlimited, T2, Paragon).
 */
export function FormatBadge({
  format,
  full = false,
  className,
}: {
  format?: string | null;
  full?: boolean;
  className?: string;
}) {
  const id = normalizeFormat(format);
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none",
        COLORS[id] ?? DEFAULT_COLORS,
        className
      )}
    >
      {full ? FORMATS[id].id : FORMATS[id].badge}
    </span>
  );
}
