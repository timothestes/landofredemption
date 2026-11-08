import { Button } from "@/components/ui/button";

// A search or filter that matched nothing, which must not read as an empty set or library.
export default function NoFilterMatches({ message, onClear }: { message: string; onClear: () => void }) {
  return (
    <div className="mx-auto mt-12 max-w-sm text-center">
      <p className="mb-3 break-words text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" className="h-8" onClick={onClear}>Clear filters</Button>
    </div>
  );
}
