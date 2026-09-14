// The Forge card frame as one <svg viewBox="0 0 750 1050">: chrome (text box, window outline,
// frame border, icon boxes, class icons, title) and the card's text, drawn from the live
// DesignCard. No "use client" and no hooks, so the server renderer (app/forge/lib/renderCard.ts)
// can render it: a route handler cannot call a client module's export.
//
// Two uses:
//  * ForgeCardPreview (browser) passes `rasters={null}`. The wash and art layers stay lazy HTML
//    <img>s under this overlay, and CSS font stacks name forge-fonts.css's @font-face families.
//  * renderCard (server) passes `rasters={{ art }}`. The svg becomes a standalone document that
//    also draws the washes and the art as <image>s underneath, for resvg.
//
// Rendered play cards are cached under RENDER_VERSION (app/forge/lib/renderVersion.ts). Bump it
// whenever this file's output changes.
//
// Coordinates: everything is laid out in the 750x1050 canvas from frameGeometry. Text must not be
// sized in container units (cqw): WebKit multiplies those by the page-zoom factor a second time,
// so a Safari reader with a remembered per-site zoom saw the ability run off the text box.

import type { DesignCard, StatValue } from "@/app/forge/lib/designCard";
import {
  washPaths, washBands, iconBox, classIcons, isPreviewApproximate, type IconBox,
} from "@/app/forge/lib/frameAssets";
import { textFit, textWidth, TEXT_WIDTH, TEXT_METRICS as TM } from "@/app/forge/lib/textFit";
import { CANVAS, RECTS, BORDER_STROKE } from "@/app/forge/lib/frameGeometry";

const { w: CW, h: CH } = CANVAS;
export const INK = "#231f20"; // the template's 100% K through its SWOP profile
// ForgeTitle (Symphony Black from the private font route, cap height 0.73em) averages ~0.53em
// per character; TITLE_EM adds a hair for the stroke and is used to size and squeeze titles.
// Sizes are cap heights measured off printed cards (title ~26 px, stats ~22 px on the canvas).
const TITLE_EM = 0.57;
const TITLE_MAX = 36, TITLE_MIN = 25;
// Printed titles: a black contour all the way around the letter, plus a hard shadow offset to
// the lower right (canvas px). The contour is a fixed width in the print template, not a share
// of the type size, so it reads heavier on the smaller type a long name shrinks to — which is
// what the printed cards show. TITLE_PAD keeps the contour and the shadow out of the clip.
const TITLE_SHADOW = { dx: 3, dy: 3, spread: 1.0 };
const TITLE_EDGE = 3;
const TITLE_PAD = 4;
// Arimo's ascent and descent (hhea, per em). A CSS line box puts its baseline half-leading
// plus ascent below its top; the printed text metrics were measured against line boxes laid
// out that way, so the SVG lines use the same arithmetic to land where they always have.
const FONT_ASC = 1854 / 2048, FONT_DESC = 434 / 2048;
const baselineIn = (top: number, lineHeight: number, size: number) =>
  top + (lineHeight - (FONT_ASC + FONT_DESC) * size) / 2 + FONT_ASC * size;
// The fit / approximate annotations, which are ours and not on the printed card.
const PILL = { size: 16, padX: 8, h: 22, gap: 4, r: 6, x: CW * 0.025, bottom: CH * 0.988 };

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r?: number };

export type CardSvgFonts = { title: string; stat: string; body: string };
export type CardSvgProps = {
  card: DesignCard;
  /** Prefix for clip/gradient/mask/filter ids; must be alphanumeric. */
  idPrefix: string;
  fonts: CardSvgFonts;
  /** Maps a frame-kit public path (/forge/frames/...) to the href to draw it from. */
  assetHref: (publicPath: string) => string;
  /** Label the art window NO ART. */
  noArt: boolean;
  /** Draw the Forge's own "doesn't fit" / "preview approximate" pills. */
  annotations: boolean;
  year: number;
  /** null: overlay only (browser). Otherwise a standalone document with washes and art. */
  rasters: null | { art: string | null };
};

function statText(s: StatValue | undefined, t: StatValue | undefined): string {
  const f = (v: StatValue | undefined) => (v === null || v === undefined || v === "" ? "?" : String(v));
  return `${f(s)}/${f(t)}`;
}

/** Trim `text` to `width` with an ellipsis, the way `text-overflow: ellipsis` would. */
function clampText(text: string, size: number, width: number): string {
  if (textWidth(text, "bold", size) <= width) return text;
  let s = text;
  while (s && textWidth(`${s}…`, "bold", size) > width) s = s.slice(0, -1);
  return `${s}…`;
}

// Icon box: a rounded tab in the frame corner, drawn over the border the way printed boxes
// are (they overhang it by a hair). The outer corner follows the card corner; the other
// three are tighter. Fill is the brigade color (banded top to bottom, one band per brigade)
// or a badge; stats sit in the top band, the type icon at the template's slot.
const BOX_R = 22, BOX_OUTER_R = 42;
function tabPath({ x, y, w, h }: Rect, side: "left" | "right"): string {
  const [tl, tr] = side === "left" ? [BOX_OUTER_R, BOX_R] : [BOX_R, BOX_OUTER_R];
  const r = BOX_R;
  return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
    + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
}

function IconBoxG({ id, box, rect, side, stat, statFont, assetHref }: {
  id: string; box: IconBox; rect: Rect; side: "left" | "right"; stat: string | null;
  statFont: string; assetHref: (publicPath: string) => string;
}) {
  const { x, y, w, h } = rect;
  const d = tabPath(rect, side);
  // Each band below the first runs to the bottom over the one before. Two brigades split the
  // box 45 / 55 (the top band holds the stats); three or more split it evenly, as printed.
  const n = box.bands.length + 1;
  const first = n === 2 ? 0.45 : 1 / n;
  const bandTop = (i: number) => y + h * (first + (i * (1 - first)) / (n - 1));
  // Printed stats: one size whether "9/6" or "10/11" (digits ~27 px tall, tops 6 px below the
  // box top, centred), no outline; only an unusually long value gives ground.
  const statSize = stat && stat.length > 6 ? 30 : 41;
  return (
    <g>
      <clipPath id={id}><path d={d} /></clipPath>
      <path d={d} fill={box.fill} />
      {box.bands.map((fill, i) => (
        <rect key={i} x={x} y={bandTop(i)} width={w} height={y + h - bandTop(i)} fill={fill} clipPath={`url(#${id})`} />
      ))}
      {box.badge && (
        <image href={assetHref(box.badge)} x={x} y={y} width={w} height={h} preserveAspectRatio={`${box.badgeAlign} slice`} clipPath={`url(#${id})`} />
      )}
      {box.icon && box.iconRect && (
        <image href={assetHref(box.icon)} x={box.iconRect.x} y={box.iconRect.y} width={box.iconRect.w} height={box.iconRect.h} preserveAspectRatio="xMidYMid meet" />
      )}
      <path d={d} fill="none" stroke={INK} strokeWidth={4} />
      {stat && (
        <text
          x={x + w / 2 + (side === "left" ? -2 : 2)} y={y + 34} textAnchor="middle"
          fontFamily={statFont} fontSize={statSize}
          fill={box.darkText ? INK : "#fff"}
        >
          {stat}
        </text>
      )}
    </g>
  );
}

// Server-only layers, under the chrome: white card, the washes clipped to the border (each
// brigade after the first fades in through a luminance mask, black to white over washBands —
// the same bands as the browser preview's CSS masks), and the art window (cover-cropped).
function RasterLayers({ card, idPrefix, assetHref, art }: {
  card: DesignCard; idPrefix: string; assetHref: (publicPath: string) => string; art: string | null;
}) {
  const B = RECTS.border, A = RECTS.art;
  const washes = washPaths(card);
  const bands = washBands(washes.length);
  return (
    <>
      <rect x={0} y={0} width={CW} height={CH} fill="#fff" />
      <defs>
        <clipPath id={`${idPrefix}wb`}><rect x={B.x} y={B.y} width={B.w} height={B.h} rx={B.r} /></clipPath>
        <clipPath id={`${idPrefix}wa`}><rect x={A.x} y={A.y} width={A.w} height={A.h} rx={A.r} /></clipPath>
        {bands.map((band, i) => band && (
          <g key={i}>
            <linearGradient id={`${idPrefix}wg${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={band.from / 100} stopColor="#000" />
              <stop offset={band.to / 100} stopColor="#fff" />
            </linearGradient>
            <mask id={`${idPrefix}wm${i}`} maskUnits="userSpaceOnUse" x={B.x} y={B.y} width={B.w} height={B.h}>
              <rect x={B.x} y={B.y} width={B.w} height={B.h} fill={`url(#${idPrefix}wg${i})`} />
            </mask>
          </g>
        ))}
      </defs>
      <g clipPath={`url(#${idPrefix}wb)`}>
        {washes.length === 0 && <rect x={B.x} y={B.y} width={B.w} height={B.h} fill="#b9b3aa" />}
        {washes.map((src, i) => (
          <image
            key={i} href={assetHref(src)} x={B.x} y={B.y} width={B.w} height={B.h} preserveAspectRatio="xMidYMid slice"
            {...(bands[i] ? { mask: `url(#${idPrefix}wm${i})` } : {})}
          />
        ))}
      </g>
      <g clipPath={`url(#${idPrefix}wa)`}>
        <rect x={A.x} y={A.y} width={A.w} height={A.h} fill="#fff" />
        {art && <image href={art} x={A.x} y={A.y} width={A.w} height={A.h} preserveAspectRatio="xMidYMid slice" />}
      </g>
    </>
  );
}

export default function CardSvg({
  card, idPrefix, fonts, assetHref, noArt, annotations, year, rasters,
}: CardSvgProps) {
  const uid = idPrefix;
  const left = iconBox(card, "left");
  const right = iconBox(card, "right");
  const classes = classIcons(card);
  const fit = textFit(card);
  const approximate = isPreviewApproximate(card);

  const A = RECTS.art, B = RECTS.border, T = RECTS.textBox, I = RECTS.textInset;
  const name = card.name?.trim() || "Card Name";
  // Title: right-aligned, or centered between the boxes when there is a right box (as
  // printed Covenants / Curses are). Shrinks for long names, then squeezes the glyphs the
  // way printed cards condense long titles.
  const titleLeft = RECTS.title.x;
  const titleRight = right ? RECTS.rightBox.x - 12 : titleLeft + RECTS.title.w;
  const titleAvail = titleRight - titleLeft;
  const titleWidth = (size: number) => name.length * size * TITLE_EM;
  const titleSize = titleWidth(TITLE_MAX) > titleAvail ? Math.max(TITLE_MIN, (TITLE_MAX * titleAvail) / titleWidth(TITLE_MAX)) : TITLE_MAX;
  const titleSqueeze = titleWidth(titleSize) > titleAvail;
  const ids = card.identifiers ?? [];
  const stat = left?.withStats ? statText(card.strength, card.toughness) : null;

  // Ability: the lines textFit wrapped, at the printed size, top-anchored and never shrunk,
  // so the picture and the fit verdict agree. A long one runs into the verse, and the pill
  // at the bottom says by how much.
  const abilityRows: { text: string; y: number }[] = [];
  let abilityTop = T.y + TM.ability.top;
  fit.paragraphs.forEach((lines, p) => {
    if (p) abilityTop += TM.ability.paragraphGap;
    for (const text of lines) {
      abilityRows.push({ text, y: baselineIn(abilityTop, TM.ability.pitch, TM.ability.size) });
      abilityTop += TM.ability.pitch;
    }
  });

  // Verse: stacked up from the fixed reference line on the dark part of the box, and
  // justified the way print does it — every line but the last stretches its word spaces.
  const verseRows = fit.verseLines.map((text, i) => {
    const top = T.y + fit.verseTop + i * TM.verse.pitch;
    const spaces = text.split(" ").length - 1;
    const slack = TEXT_WIDTH - textWidth(text, "italic", TM.verse.size);
    const last = i === fit.verseLines.length - 1;
    return {
      text,
      y: baselineIn(top, TM.verse.pitch, TM.verse.size),
      wordSpacing: !last && spaces > 0 && slack > 0 ? slack / spaces : 0,
    };
  });

  // Credits: two right-aligned lines resting on the bottom of their slot.
  const C = RECTS.credits;
  const credits = [
    { text: `Illus. ${card.artistCredit?.trim() || "Artist Unknown"}`, size: 15 },
    { text: `© ${year} Cactus Game Design, Inc.`, size: 13 },
  ];
  let creditBottom = C.y + C.h;
  const creditRows = credits
    .slice()
    .reverse()
    .map(({ text, size }) => {
      const lineHeight = size * 1.3;
      creditBottom -= lineHeight;
      return { text: clampText(text, size, C.w), size, y: baselineIn(creditBottom, lineHeight, size) };
    })
    .reverse();

  // Identifier bubble — a pill straddling the art window and the text box.
  const ID = RECTS.idBubble;
  const idSize = 19, idPadX = 16;
  const idText = ids.length ? clampText(ids.join(", "), idSize, ID.w - 2 * idPadX) : "";
  const idW = idText ? Math.min(ID.w, textWidth(idText, "bold", idSize) + 2 * idPadX) : 0;

  const pills = annotations ? [
    ...(fit.over > 0 ? [{ key: "over", text: `Ability doesn't fit · ${fit.over} line${fit.over === 1 ? "" : "s"} over`, fill: "rgba(179,38,30,.92)" }] : []),
    ...(approximate ? [{ key: "approximate", text: "preview approximate", fill: "rgba(0,0,0,.7)" }] : []),
  ] : [];

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`} aria-hidden="true"
      {...(rasters
        ? { xmlns: "http://www.w3.org/2000/svg", width: CW, height: CH }
        : { style: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" } })}
    >
      {rasters && <RasterLayers card={card} idPrefix={uid} assetHref={assetHref} art={rasters.art} />}
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.8" />
          <stop offset={fit.gradient.light / T.h} stopColor="#fff" stopOpacity="0.8" />
          <stop offset={fit.gradient.dark / T.h} stopColor={INK} stopOpacity="1" />
          <stop offset="1" stopColor={INK} stopOpacity="1" />
        </linearGradient>
        <filter id={`${uid}s`} x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="#000" floodOpacity="0.8" />
        </filter>
      </defs>
      <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={`url(#${uid}g)`} stroke={INK} strokeWidth={2.5} />
      <rect x={A.x} y={A.y} width={A.w} height={A.h} rx={A.r} fill="none" stroke={INK} strokeWidth={4} />
      <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={B.r} fill="none" stroke={INK} strokeWidth={BORDER_STROKE} />
      {left && <IconBoxG id={`${uid}l`} box={left} rect={RECTS.leftBox} side="left" stat={stat} statFont={fonts.stat} assetHref={assetHref} />}
      {right && <IconBoxG id={`${uid}r`} box={right} rect={RECTS.rightBox} side="right" stat={null} statFont={fonts.stat} assetHref={assetHref} />}
      {classes.map((c) => (
        <image key={c.src} href={assetHref(c.src)} x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} preserveAspectRatio="xMidYMid meet" />
      ))}
      <clipPath id={`${uid}t`}><rect x={titleLeft - TITLE_PAD} y={RECTS.title.y - 12} width={titleAvail + 2 * TITLE_PAD} height={RECTS.title.h + 24} /></clipPath>
      {/* Title: a white face carrying a black contour, over a dark copy of itself offset to
            the lower right — the two things that make printed names read on any wash. */}
      {[TITLE_SHADOW, null].map((shadow, i) => (
        <text
          key={i}
          x={right ? (titleLeft + titleRight) / 2 : titleRight} y={RECTS.title.y + 42} textAnchor={right ? "middle" : "end"}
          clipPath={`url(#${uid}t)`} fontFamily={fonts.title} fontSize={titleSize}
          fill={shadow ? INK : "#fff"} stroke={INK} strokeWidth={shadow ? TITLE_SHADOW.spread : TITLE_EDGE} paintOrder="stroke" style={{ paintOrder: "stroke" }}
          transform={shadow ? `translate(${shadow.dx} ${shadow.dy})` : undefined}
          {...(titleSqueeze ? { textLength: titleAvail, lengthAdjust: "spacingAndGlyphs" as const } : {})}
        >
          {name}
        </text>
      ))}

      <g fontFamily={fonts.body} style={{ fontKerning: "none" }}>
        {noArt && (
          <text
            x={A.x + A.w / 2} y={baselineIn(A.y + (A.h - 26 * 1.4) / 2, 26 * 1.4, 26)} textAnchor="middle"
            fontSize={26} letterSpacing={26 * 0.14} fill="rgba(255,255,255,.62)"
          >
            NO ART
          </text>
        )}

        {/* identifier bubble */}
        {idText && (
          <g>
            <rect
              x={ID.x + (ID.w - idW) / 2} y={ID.y} width={idW} height={ID.h} rx={ID.h / 2}
              fill="rgba(0,0,0,0.75)" stroke={INK} strokeWidth={1.5}
            />
            <text
              x={ID.x + ID.w / 2} y={baselineIn(ID.y + (ID.h - idSize) / 2, idSize, idSize)} textAnchor="middle"
              fontSize={idSize} fontWeight={700} fill="#fff"
            >
              {idText}
            </text>
          </g>
        )}

        {/* ability */}
        {abilityRows.map((row, i) => (
          <text key={i} x={I.x + I.w / 2} y={row.y} textAnchor="middle" fontSize={TM.ability.size} fontWeight={700} fill={INK}>
            {row.text}
          </text>
        ))}

        {/* verse and its reference */}
        {verseRows.map((row, i) => (
          <text
            key={i} x={I.x} y={row.y} fontSize={TM.verse.size} fontStyle="italic" fill="#f2efe4"
            {...(row.wordSpacing ? { wordSpacing: row.wordSpacing } : {})}
          >
            {row.text}
          </text>
        ))}
        {card.reference && (
          <text
            x={I.x + I.w} y={baselineIn(T.y + TM.reference.top, TM.reference.size, TM.reference.size)} textAnchor="end"
            fontSize={TM.reference.size} fontWeight={700} fill="#f2efe4"
          >
            {card.reference}
          </text>
        )}

        {/* credits */}
        <g filter={`url(#${uid}s)`} fill="#fff" fontWeight={700}>
          {creditRows.map((row, i) => (
            <text key={i} x={C.x + C.w} y={row.y} textAnchor="end" fontSize={row.size}>{row.text}</text>
          ))}
        </g>

        {/* our own annotations, stacked up from the bottom-left corner */}
        {pills.map((pill, i) => {
          const w = textWidth(pill.text, "bold", PILL.size) + 2 * PILL.padX;
          const top = PILL.bottom - (pills.length - i) * PILL.h - (pills.length - 1 - i) * PILL.gap;
          return (
            <g key={pill.key} {...(pill.key === "over" ? { "data-fit": "over" } : {})}>
              <rect x={PILL.x} y={top} width={w} height={PILL.h} rx={PILL.r} fill={pill.fill} />
              <text
                x={PILL.x + PILL.padX} y={baselineIn(top, PILL.h, PILL.size)}
                fontSize={PILL.size} fontWeight={700} fill="#fff"
              >
                {pill.text}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
