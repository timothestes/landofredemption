"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { candidateUrl } from "@/app/forge/components/ArtCandidatesPanel";
import SourceLinkDialog from "@/app/forge/components/SourceLinkDialog";
import { Button } from "@/components/ui/button";
import type { ArtCandidate } from "@/app/forge/lib/artCandidates";

// Source links for a card whose art is locked. It lives outside the studio's form because a control
// inside a disabled fieldset can't opt out of it. A link says where the art came from and changes
// nothing on the card, so it can still be corrected once a card is public.
export default function ArtSourceLinks({ cardId, candidates }: { cardId: string; candidates: ArtCandidate[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  if (candidates.length === 0) return null;

  return (
    <section aria-labelledby="art-source-links" className="rounded-lg border bg-card p-4">
      <h2 id="art-source-links" className="text-sm font-medium">Art source links</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The art on this card can’t change, but you can still correct where it came from.
      </p>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {candidates.map((c) => (
          <li key={c.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- forge art must use the authed proxy, never next/image */}
            <img src={candidateUrl(cardId, c.id)} alt="" loading="lazy" decoding="async"
              className="aspect-square w-full rounded-md border bg-muted/40 object-cover" />
            <Button type="button" variant="outline" aria-label={c.sourceUrl ? "Edit source link" : "Add source link"}
              className="mt-1 h-7 w-full gap-1 px-1 text-xs [@media(hover:none)]:h-11"
              onClick={() => setEditing(c.id)}>
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              {c.sourceUrl ? "Edit link" : "Add link"}
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <SourceLinkDialog cardId={cardId} candidateId={editing}
          sourceUrl={candidates.find((c) => c.id === editing)?.sourceUrl ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </section>
  );
}
