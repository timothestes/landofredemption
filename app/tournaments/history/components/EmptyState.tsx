import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
}

export function EmptyState({ icon: Icon, title }: EmptyStateProps) {
  return (
    <div className="py-16 text-center text-muted-foreground">
      <div className="mb-3 flex justify-center">
        <Icon className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
    </div>
  );
}
