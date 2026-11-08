"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCard } from "@/app/forge/lib/cards";

// The home page's "New idea": creates the card and opens the studio, the same call as
// New card on the Ideas page. createCard needs an elder, so render this only for elders
// and superadmins.
export default function NewIdeaTile() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await createCard("");
    if (r.ok === false) {
      setBusy(false);
      setError(r.error);
      return;
    }
    // Keep busy through navigation: a second tap would create a second card.
    router.push(`/forge/cards/${r.id}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={onCreate}
        disabled={busy}
        className="block w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-shadow hover:bg-muted/50 hover:shadow [.jayden_&]:bg-gradient-to-br [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)] [.jayden_&]:border-primary/30"
      >
        <div className="font-medium">New idea</div>
        <div className="text-sm text-muted-foreground">
          {busy ? "Creating…" : "Sketch a card in your private ideas."}
        </div>
      </button>
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  );
}
