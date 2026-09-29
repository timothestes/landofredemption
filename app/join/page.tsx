"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { normalizeJoinCode } from "@/lib/tournament/joinCodeShared";

export default function JoinLandingPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeJoinCode(value);
    if (code === null) {
      setError(true);
      return;
    }
    router.push(`/join/${code}`);
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur-md">
        <h1 className="font-cinzel text-2xl font-bold tracking-tight text-foreground">Join a tournament</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the code your host gave you.
        </p>
        <form onSubmit={handleSubmit} className="mt-4">
          <label className="block text-sm font-medium text-foreground">
            Join code
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value.toUpperCase());
                setError(false);
              }}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={12}
              placeholder="T7K2QF"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg uppercase tracking-[0.3em] text-foreground"
            />
          </label>
          {error && (
            <p className="mt-2 text-sm text-destructive">
              That doesn&apos;t look like a valid code. Double-check and try again.
            </p>
          )}
          <Button type="submit" className="mt-4 w-full">
            Continue
          </Button>
        </form>
      </div>
    </main>
  );
}
