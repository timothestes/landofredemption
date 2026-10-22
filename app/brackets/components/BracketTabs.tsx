import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The two views of a bracket, as real routes so each is linkable and
 * server-rendered. Same chip strip as the tournament results pages.
 */
export function BracketTabs({ bracketId, active }: { bracketId: string; active: 'bracket' | 'breakdown' }) {
  const tabs = [
    { key: 'bracket' as const, label: 'Bracket', href: `/brackets/${bracketId}` },
    { key: 'breakdown' as const, label: 'Breakdown', href: `/brackets/${bracketId}/breakdown` },
  ];
  return (
    <nav aria-label="Bracket views" className="mb-6 flex flex-wrap gap-2">
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border px-3 text-sm transition-colors',
              isActive
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-foreground/[0.03] text-muted-foreground hover:border-foreground/40 hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
