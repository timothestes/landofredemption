"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ArticlesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Articles error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="rounded-lg border border-border bg-card p-8 text-center max-w-sm mx-4">
        <p className="text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-sm text-muted-foreground">Loading this page failed. Please try again.</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button onClick={() => reset()}>Try again</Button>
          <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">
            Back to Articles
          </Link>
        </div>
      </div>
    </div>
  );
}
