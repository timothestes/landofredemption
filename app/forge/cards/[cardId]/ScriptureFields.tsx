"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { canonicalRef, parseRef } from "@/app/forge/lib/scriptureRef";
import { deriveTestamentAndGospel, formatTestament } from "@/app/decklist/card-search/data/testament";
import VerseFinderPanel from "./VerseFinderPanel";

// Reference + Scripture sit directly under the ability text: they are printed on the
// card, like the ability, not deck metadata. The verse finder expands in place beneath
// them. `onPreview` carries the panel's candidate excerpt to the card face only — it is
// never saved.
export default function ScriptureFields({
  snapshot, update, onPreview,
}: {
  snapshot: DesignCard;
  update: (patch: Partial<DesignCard>) => void;
  onPreview: (scripture: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Testament is never stored — it's derived from the reference. Mirror what the
  // deckbuilder's N.T./O.T. filter will see so designers get instant feedback
  // (and catch a mistyped reference that wouldn't classify).
  const reference = (snapshot.reference ?? "").trim();
  const { testament, isGospel } = deriveTestamentAndGospel(reference);

  const ref = parseRef(snapshot.reference ?? "");
  const buttonLabel = ref ? `Look up ${canonicalRef(ref.bookId, ref.chapter, ref.from, ref.to)}` : "Find verse";

  function close() {
    setOpen(false);
    onPreview(null);
  }

  function edit(patch: Partial<DesignCard>) {
    setStatus(null);
    update(patch);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        {/* Reference — scripture citation printed on the card */}
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium">Reference</span>
          <input
            value={snapshot.reference ?? ""}
            onChange={(e) => edit({ reference: e.target.value || undefined })}
            placeholder="e.g. Revelation 19:15"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <span className="mt-1 block text-xs text-muted-foreground">The scripture reference printed on the card.</span>
          {reference !== "" &&
            (testament ? (
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">{formatTestament(testament)}</span>
                {isGospel && (
                  <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">Gospel</span>
                )}
              </span>
            ) : (
              <span className="mt-1.5 block text-xs text-amber-700 dark:text-amber-300">
                Couldn&rsquo;t determine testament from this reference.
              </span>
            ))}
        </label>
        {/* mt-6 lines the button up with the input under the label. */}
        <Button type="button" variant="outline" size="sm" className="mt-6 shrink-0" aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}>
          {buttonLabel}
        </Button>
      </div>

      {/* Scripture — the verse text printed on the card */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Scripture</span>
        <textarea
          value={snapshot.scripture ?? ""}
          onChange={(e) => edit({ scripture: e.target.value || undefined })}
          placeholder="The scripture text printed on the card."
          className="h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>

      {/* Mounted only while open, so every open starts from the card's current reference. */}
      {open && (
        <VerseFinderPanel
          snapshot={snapshot}
          initialQuery={snapshot.reference ?? ""}
          onPreview={onPreview}
          onClose={close}
          onUse={(patch) => {
            update(patch);
            close();
            // Hand focus back to the page so → steps to the next card.
            (document.activeElement as HTMLElement | null)?.blur();
            setStatus("Used · → next card");
          }} />
      )}

      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
