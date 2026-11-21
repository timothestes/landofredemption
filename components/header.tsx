"use client";

import { hasEnvVars } from "../utils/supabase/check-env-vars";
import { EnvVarWarning } from "./env-var-warning";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "./ui/button";
import { safeRedirectPath } from "../utils/auth/safeRedirectPath";

function AuthButtons({ query }: { query: string }) {
  return (
    <>
      <Button asChild size="sm" variant="outline">
        <Link href={`/sign-in${query}`}>Sign in</Link>
      </Button>
      <Button asChild size="sm" variant="default">
        <Link href={`/sign-up${query}`}>Sign up</Link>
      </Button>
    </>
  );
}

// Sign in and Sign up keep the page the visitor was headed to (a tournament join link, say).
// Reading the URL needs a Suspense boundary, or the auth pages can't be prerendered.
function AuthButtonsKeepingRedirect() {
  const redirectTo = safeRedirectPath(useSearchParams().get("redirectTo"), "");
  return <AuthButtons query={redirectTo ? `?redirectTo=${encodeURIComponent(redirectTo)}` : ""} />;
}

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
          <Suspense fallback={<AuthButtons query="" />}>
            <AuthButtonsKeepingRedirect />
          </Suspense>
        </div>
      </div>
    </nav>
  );
}
