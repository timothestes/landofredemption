"use client";

import { useState } from "react";

// Descoped card face (2026-07-03): replaces the ForgeCardPreview composite on the
// studio + display surfaces. Priority: finished-card image → text tile (name +
// raw text, with artwork at the top when present). Plain <img> only (never
// next/image — the forge-no-next-image guardrail forbids it; art stays on the
// authed /forge/api/art proxy).

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ComponentProps<"img">) => (
  <img alt="" loading="lazy" decoding="async" {...p} />
);

export default function ForgeCardFace({
  name, rawText, finishedUrl, artUrl, className,
}: {
  name: string | null;
  rawText: string | null;
  finishedUrl: string | null;
  artUrl: string | null;
  className?: string;
}) {
  // A grey card holds the place until the image paints, then goes, so a picture that isn't
  // quite 5:7 doesn't end up sitting on a plate. The ref catches an image already in the
  // browser's cache, whose load event can fire before React is listening.
  const [loaded, setLoaded] = useState(false);
  const box = { aspectRatio: "750 / 1050", width: "100%", containerType: "inline-size" as const };

  if (finishedUrl) {
    return (
      <div className={`${loaded ? "" : "rounded-[4%] bg-muted [.jayden_&]:bg-card/90"} ${className ?? ""}`} style={box}>
        <Img
          src={finishedUrl}
          ref={(el) => { if (el?.complete && el.naturalWidth > 0) setLoaded(true); }}
          onLoad={() => setLoaded(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "4%" }}
        />
      </div>
    );
  }

  const text = (rawText ?? "").trim();
  const title = name?.trim() || "Untitled";
  const empty = !name?.trim() && !text && !artUrl;

  return (
    <div
      className={`overflow-hidden rounded-[4%] border bg-muted/30 [.jayden_&]:bg-card/90 [.jayden_&]:border-primary/20 ${className ?? ""}`}
      style={{ ...box, display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {artUrl && <Img src={artUrl} style={{ width: "100%", height: "48%", objectFit: "cover" }} />}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "6%" }}>
        <p style={{ fontWeight: 700, fontSize: "clamp(11px, 4cqw, 16px)", marginBottom: "3%" }}>{title}</p>
        <p style={{ whiteSpace: "pre-wrap", fontSize: "clamp(10px, 3.4cqw, 14px)", lineHeight: 1.25, opacity: 0.75, overflow: "hidden" }}>
          {empty ? "No content yet" : text}
        </p>
      </div>
    </div>
  );
}
