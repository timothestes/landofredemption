"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A spoiler image that starts face down: `![alt](url "reveal")` in the
// markdown. A tap turns the card over, and the next one turns it back.
// Showmanship, not secrecy — the image URL is in the page either way.
//
// Spans throughout: markdown puts an image inside a <p>, where a <div> is
// invalid HTML and warns on hydration.
//
// The turn is one flat element rotating, with its own perspective(), and the
// two faces trading `visibility` as it passes edge-on. It deliberately uses no
// preserve-3d and no backface-visibility: inside a <button>, Firefox and
// Safari each leave the turned-away back showing, mirrored, on top of the face.

// The swap waits 55ms: where the 150ms turn passes edge-on. Written as a raw
// property because tailwindcss-animate also claims `delay-*`, `duration-*` and
// `ease-*`, which makes their arbitrary forms (`delay-[55ms]`) ambiguous —
// Tailwind warns and generates nothing for them.
const FACE =
  "absolute inset-0 overflow-hidden rounded-[5%_/_3.5%] shadow-lg shadow-black/30 transition-[visibility] duration-0 [transition-delay:55ms]";

export default function RevealImage({ src, alt }: { src?: string; alt: string }) {
  const [revealed, setRevealed] = useState(false);
  // Card-shaped until the image says otherwise, so the back has a size before
  // the face has loaded.
  const [ratio, setRatio] = useState("5 / 7");
  const faceRef = useRef<HTMLImageElement>(null);

  const measure = () => {
    const img = faceRef.current;
    if (img?.naturalWidth) setRatio(`${img.naturalWidth} / ${img.naturalHeight}`);
  };
  // onLoad never fires for an image that finished loading before hydration.
  useEffect(measure, []);

  return (
    <button
      type="button"
      onClick={() => setRevealed((r) => !r)}
      aria-label={revealed ? undefined : "Reveal image"}
      className={cn(
        "not-prose group mx-auto my-8 block w-full max-w-[24rem] cursor-pointer focus:outline-none",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-8 focus-visible:outline-foreground/40",
      )}
    >
      {/* Reduced motion gets no turn at all: the faces just trade places. */}
      <span
        className={cn(
          "relative block w-full transition-transform",
          revealed
            ? "motion-safe:[transform:perspective(1200px)_rotateY(180deg)]"
            : "motion-safe:[transform:perspective(1200px)_rotateY(0deg)] motion-safe:group-hover:[transform:perspective(1200px)_rotateY(10deg)]",
        )}
        style={{ aspectRatio: ratio }}
      >
        {/* Mirrored, so it reads the right way round once the turn mirrors it back. */}
        <span className={cn(FACE, "motion-safe:-scale-x-100", !revealed && "invisible")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={faceRef}
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={measure}
            className="h-full w-full object-cover"
          />
          {/* One pass of light across the face as it lands. */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 w-1/2 -translate-x-[150%] -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent motion-reduce:hidden",
              revealed && "translate-x-[250%] transition-transform duration-700 ease-out",
            )}
          />
        </span>
        <span className={cn(FACE, revealed && "invisible")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gameplay/cardback.webp" alt="" className="h-full w-full object-cover" />
        </span>
      </span>
      <span
        className={cn(
          "mt-3 block text-center text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground transition-opacity duration-300",
          revealed && "opacity-0",
        )}
      >
        Tap to reveal
      </span>
    </button>
  );
}
