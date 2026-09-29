"use client";

import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Button } from "./ui/button";


export default function Header() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10 h-17 bg-background [.jayden_&]:bg-[hsl(270,20%,4%)]">
      <div className="w-full max-w-1xl flex justify-between items-center p-3 px-5 text-sm">
        <div className="flex gap-5 items-center font-semibold">
          <Link href="/">
            <img src="/brand/lor-wordmark-dark.webp" className="w-48 dark:hidden [.jayden_&]:hidden" alt="Land of Redemption" />
            <img src="/brand/lor-wordmark.webp" className="w-48 hidden dark:block [.jayden_&]:block" alt="Land of Redemption" />
          </Link>
        </div>
        <div className="flex items-center gap-3">
          {!hasEnvVars && <EnvVarWarning />}
          <Button asChild size="sm" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" variant="default">
            <Link href="/sign-up">Sign up</Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}
