"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { redeemPosterInvite } from "@/app/admin/posts/lib/invites";

export default function AcceptPosterForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    setBusy(true);
    setFailed(false);
    const r = await redeemPosterInvite(token);
    setBusy(false);
    if (r.ok) router.push("/admin/posts");
    else setFailed(true);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="font-cinzel text-2xl font-bold tracking-tight">
        You&apos;re invited to post
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Accepting lets you write and publish your own articles at /articles. You can only edit
        your own posts.
      </p>
      {failed && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This invite link is invalid, expired, or already used. Ask whoever invited you for a fresh link.
        </p>
      )}
      <Button onClick={accept} disabled={busy} className="mt-4 w-full">
        {busy ? "Accepting…" : "Accept & start posting"}
      </Button>
    </main>
  );
}
