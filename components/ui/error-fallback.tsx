"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Prefix for the console line, e.g. "Decklist error". */
  label: string;
};

/**
 * The block every route-level error.tsx renders, so a
 * failure looks the same wherever it happens: plain message, retry, a way home. flex-1 fills a
 * flex parent (root <main>, decklist layout); min-h keeps it centred in a block one.
 */
export default function ErrorFallback({ error, reset, label }: Props) {
  useEffect(() => {
    console.error(`${label}:`, error);
  }, [error, label]);

  return (
    <div className="flex flex-1 min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <p className="text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-sm text-muted-foreground">Loading this page failed. Please try again.</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button onClick={() => reset()}>Try again</Button>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
