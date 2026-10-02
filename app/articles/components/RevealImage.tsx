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
// The two faces carry the rounding, the shadow and the clipping. The element
// that turns must stay free of overflow and filters, which flatten its 3D.

const FACE = "absolute inset-0 overflow-hidden rounded-[5%_/_3.5%] shadow-lg shadow-black/30 [backface-visibility:hidden]";

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
        "not-prose group mx-auto my-8 block w-full max-w-[24rem] cursor-pointer focus:outline-none [perspective:1200px]",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-8 focus-visible:outline-foreground/40",
      )}
    >
      {/* Reduced motion gets no turn at all: the back fades off the face. */}
      <span
        className={cn(
          "relative block w-full transition-transform duration-[900ms] ease-[cubic-bezier(0.3,1.3,0.5,1)] [transform-style:preserve-3d]",
          revealed ? "motion-safe:[transform:rotateY(180deg)]" : "motion-safe:group-hover:[transform:rotateY(10deg)]",
        )}
        style={{ aspectRatio: ratio }}
      >
        <span className={cn(FACE, "motion-safe:[transform:rotateY(180deg)]")}>
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
              revealed && "translate-x-[250%] transition-transform delay-[450ms] duration-700 ease-out",
            )}
          />
        </span>
        <span className={cn(FACE, "transition-opacity duration-500", revealed && "motion-reduce:opacity-0")}>
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
