import Link from "next/link";
import { Loader2 } from "lucide-react";
import LinkPending from "@/app/forge/components/LinkPending";
import { cn } from "@/lib/utils";

// scroll: false leaves the scroll position to the page being opened, which restores its own.
export type Crumb = { label: string; href?: string; scroll?: false };

// oneLine: never wrap. The last two crumbs truncate, since the first ones are short and fixed.
export default function ForgeBreadcrumbs({ items, className, oneLine = false }: { items: Crumb[]; className?: string; oneLine?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2 text-xs text-muted-foreground", className)}>
      <ol className={cn("flex items-center gap-1", !oneLine && "flex-wrap")}>
        {items.map((it, i) => {
          const truncates = oneLine && i >= items.length - 2;
          return (
            <li key={i} className={cn("flex items-center gap-1", oneLine && (truncates ? "min-w-0" : "shrink-0"))}>
              {i > 0 && <span aria-hidden className="shrink-0">›</span>}
              {it.href ? (
                <Link href={it.href} scroll={it.scroll} className={cn("hover:text-foreground hover:underline", truncates && "truncate")}>
                  {it.label}
                  <LinkPending><Loader2 className="ml-1 inline h-3 w-3 animate-spin" aria-hidden="true" /></LinkPending>
                </Link>
              ) : (
                <span aria-current="page" className={cn("font-medium text-foreground", truncates && "truncate")}>{it.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
