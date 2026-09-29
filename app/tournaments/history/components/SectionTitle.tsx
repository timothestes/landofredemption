interface SectionTitleProps {
  title: string;
  sub?: string;
}

export function SectionTitle({ title, sub }: SectionTitleProps) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
    </div>
  );
}
