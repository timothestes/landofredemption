"use client";

import { useId, type CSSProperties } from "react";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { washColumns, washBands } from "@/app/forge/lib/frameAssets";
import { CANVAS, RECTS } from "@/app/forge/lib/frameGeometry";
import CardSvg, { INK } from "@/app/forge/components/CardSvg";

// Rough rendered card: the design team's frame (washes / icons / badges from the kit, chrome
// drawn as SVG from the template's geometry) around the live DesignCard. It is a draft for
// designers, not the print graphic — see the 2026-09-09 live-preview spec. The frame and all
// of the text are CardSvg, which the server renderer shares for play cards; this wrapper adds
// the wash and art layers underneath as lazy <img>s, so a big set grid only loads what shows.
// Plain <img> only (never next/image — the forge-no-next-image guardrail; art stays on the
// authed proxy).

const { w: CW, h: CH } = CANVAS;
const COPYRIGHT_YEAR = new Date().getFullYear();
const FONTS = {
  title: "ForgeTitle, 'Trebuchet MS', 'Segoe UI', sans-serif",
  stat: "ForgeStat, Georgia, 'Times New Roman', serif",
  body: "ForgeBody, system-ui, sans-serif",
};

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r?: number };

const pctX = (px: number) => `${(px / CW) * 100}%`;
const pctY = (px: number) => `${(px / CH) * 100}%`;
const place = (r: Rect): CSSProperties => ({
  position: "absolute", left: pctX(r.x), top: pctY(r.y), width: pctX(r.w), height: pctY(r.h),
});
/** A rect's corner radius as percentages of its own box, so it scales with the card. */
const radius = (r: Rect) => `${((r.r ?? 0) / r.w) * 100}% / ${((r.r ?? 0) / r.h) * 100}%`;
const identity = (publicPath: string) => publicPath;

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" loading="lazy" decoding="async" {...p} />;

export default function ForgeCardPreview({
  card, artUrl, className,
}: { card: DesignCard; artUrl?: string | null; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const columns = washColumns(card);
  // A dual-alignment card's evil column fades in over its good one, left to right.
  const split = columns.length > 1 ? washBands(2)[1]! : null;
  const B = RECTS.border, A = RECTS.art;

  return (
    <div
      className={className}
      role="img"
      aria-label={card.name ? `Card preview: ${card.name}` : "Card preview"}
      style={{
        position: "relative", aspectRatio: `${CW} / ${CH}`, width: "100%",
        overflow: "hidden", borderRadius: "3.73% / 2.67%", background: "#fff", color: INK,
        fontFamily: FONTS.body, userSelect: "none",
      }}
    >
      {/* 1. wash(es) inside the border rect, one column per alignment: each further brigade
            blends in below the one before, in equal bands, in the order of the icon box's
            bands. Each fade spans 40% / N of the height, so two brigades fade 40% to 60%. A
            dual-alignment card's evil column blends in over its good column the same way,
            left to right. */}
      {columns.map((col, c) => {
        const bands = washBands(col.length);
        const across = c > 0 && split ? `linear-gradient(to right, transparent ${split.from}%, #000 ${split.to}%)` : null;
        return (
          <div key={c} style={{
            ...place(B), borderRadius: radius(B), overflow: "hidden",
            ...(across ? { WebkitMaskImage: across, maskImage: across } : {}),
          }}>
            {col.length === 0 && <div style={{ position: "absolute", inset: 0, background: "#b9b3aa" }} />}
            {col.map((src, i) => {
              const band = bands[i];
              const mask = band ? `linear-gradient(to bottom, transparent ${band.from}%, #000 ${band.to}%)` : null;
              return (
                <Img key={i} src={src} style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
                  ...(mask ? { WebkitMaskImage: mask, maskImage: mask } : {}),
                }} />
              );
            })}
          </div>
        );
      })}

      {/* 2. art window: uploaded art clipped to the window, or, with no art yet, the frame's
            wash dimmed under a dark scrim — a white slot punched a hole in every draft grid
            (the "NO ART" label is drawn with the rest of the text, in the canvas below) */}
      <div style={{ ...place(A), borderRadius: radius(A), overflow: "hidden", background: artUrl ? "#fff" : "rgba(35,31,32,.42)" }}>
        {artUrl && <Img src={artUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>

      {/* 3. everything else, in canvas coordinates: CardSvg */}
      <CardSvg
        card={card} idPrefix={uid} fonts={FONTS} assetHref={identity}
        noArt={!artUrl} annotations year={COPYRIGHT_YEAR} rasters={null}
      />
    </div>
  );
}
