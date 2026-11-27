"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import QuoteTextarea from "./QuoteTextarea";
import { Button } from "@/components/ui/button";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { canonicalRef, parseRef } from "@/app/forge/lib/scriptureRef";
import { deriveTestamentAndGospel, formatTestament } from "@/app/decklist/card-search/data/testament";
import VerseFinderPanel from "./VerseFinderPanel";

// Reference + Scripture sit directly under the ability text: they are printed on the
// card, like the ability, not deck metadata. The verse finder expands in place beneath
// them. `onPreview` carries the panel's candidate excerpt and reference to the card face only — it is
// never saved.
export default function ScriptureFields({
  snapshot, update, onPreview,
}: {
  snapshot: DesignCard;
  update: (patch: Partial<DesignCard>) => void;
  onPreview: (candidate: { scripture: string; reference: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const scriptureId = useId();

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

  // Esc / the toggle close the panel from inside it; hand focus back to the toggle so the builder keeps their place.
  function closeToToggle() {
    close();
    toggleRef.current?.focus({ preventScroll: true });
  }

  // The panel is tall, so closing it can leave the page far below these fields. Bring them back
  // into view, in the same frame, and only as far as needed.
  const rootRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) rootRef.current?.scrollIntoView({ block: "nearest" });
    wasOpen.current = open;
  }, [open]);

  function edit(patch: Partial<DesignCard>) {
    setStatus(null);
    update(patch);
  }

  return (
    <div ref={rootRef} className="scroll-mt-[calc(var(--forge-chrome)+4rem)] space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        {/* Reference — scripture citation printed on the card */}
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium">Reference</span>
          <input
            value={snapshot.reference ?? ""}
            onChange={(e) => edit({ reference: e.target.value || undefined })}
            placeholder="e.g. Revelation 19:15"
            className="min-h-11 w-full rounded-md border bg-background px-3 py-2 text-base sm:min-h-0 sm:text-sm" />
          {/* One line of fixed height whatever it says, so typing a reference moves nothing below. */}
          <span className="mt-1 flex min-h-6 flex-wrap items-center gap-1.5 text-xs">
            {reference === "" ? (
              <span className="text-muted-foreground">The scripture reference printed on the card.</span>
            ) : testament ? (
              <>
                <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">{formatTestament(testament)}</span>
                {isGospel && (
                  <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">Gospel</span>
                )}
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-300">
                Couldn&rsquo;t determine testament from this reference.
              </span>
            )}
          </span>
        </label>
        {/* From sm, mt-6 lines the button up with the input under the label, and its width is fixed:
            the label follows the reference, and the field must not resize as it is typed. On a
            phone it takes its own row. */}
        <Button ref={toggleRef} type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:mt-6 sm:h-9 sm:w-64" aria-expanded={open}
          onClick={() => (open ? closeToToggle() : setOpen(true))}>
          <span className="truncate">{buttonLabel}</span>
        </Button>
      </div>

      {/* Scripture — the verse text printed on the card */}
      {/* A div, not a wrapping label: the "Make curly" line under the box is not part of its name. */}
      <div>
        <label htmlFor={scriptureId} className="mb-1 block text-sm font-medium">Scripture</label>
        <QuoteTextarea
          id={scriptureId}
          value={snapshot.scripture ?? ""}
          onChange={(e) => edit({ scripture: e.target.value || undefined })}
          placeholder="The scripture text printed on the card."
          className="h-20 w-full rounded-md border bg-background px-3 py-2 text-base sm:text-sm" />
      </div>

      {/* Mounted only while open, so every open starts from the card's current reference. */}
      {open && (
        <VerseFinderPanel
          snapshot={snapshot}
          initialQuery={snapshot.reference ?? ""}
          cardName={snapshot.name ?? null}
          onPreview={onPreview}
          onClose={closeToToggle}
          onUse={(patch) => {
            update(patch);
            close();
            // Hand focus back to the page so → steps to the next card.
            (document.activeElement as HTMLElement | null)?.blur();
            setStatus("Used · → next card");
          }} />
      )}

      <p role="status" className="text-xs text-muted-foreground">{status}</p>
    </div>
  );
}
