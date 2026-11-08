"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// For a member with no display name; the layout renders it for no one else. Not sticky, so it
// stays out of --forge-chrome and scrolls away with the page.
export default function NamePrompt() {
  // That page is the prompt.
  if (usePathname() === "/forge/welcome") return null;
  return (
    <p className="border-b bg-background px-4 py-1.5 text-xs text-muted-foreground">
      Other members see you as “Forge member”.{" "}
      <Link href="/forge/welcome" className="font-medium text-foreground underline underline-offset-2">
        Pick a display name
      </Link>
    </p>
  );
}
