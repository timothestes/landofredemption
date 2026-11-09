"use client";

import type { ForgePresenceMeta } from "@/app/forge/lib/useForgeRealtime";

// Also used by the comment thread's avatars — playtest_members has no photo field.
export function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function PresenceBar({ others }: { others: ForgePresenceMeta[] }) {
  if (others.length === 0) return null;
  // Dedupe by userId (a member may have two tabs open).
  const seen = new Map<string, ForgePresenceMeta>();
  for (const o of others) seen.set(o.userId, o);
  const people = [...seen.values()];
  const editing = people.filter((p) => p.editing);
  return (
    <div className="mb-3 max-sm:pt-2">
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {people.map((p) => (
            <span
              key={p.userId}
              title={p.displayName ?? "Member"}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-medium text-muted-foreground"
            >
              {initials(p.displayName)}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {people.length === 1 ? "1 other person here" : `${people.length} others here`}
        </span>
      </div>
      {editing.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {editing.map((p) => p.displayName ?? "Someone").join(", ")}{" "}
          {editing.length === 1 ? "is" : "are"} also editing this card — changes use last-write-wins.
        </div>
      )}
    </div>
  );
}
