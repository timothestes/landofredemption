'use client';

import { useEffect, useRef, useState } from 'react';
import { simplifyLostSoulName } from '@/lib/cards/cardAbilities';
import type { SoulCinematicCard } from '../hooks/useLostSoulCinematic';

const MAX_SHOWN_CARDS = 3;

interface Props {
  souls: SoulCinematicCard[];
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-screen overlay that plays a brief cinematic when one or more Lost Souls
 * arrive in Land of Bondage. Pure presentational — the dismiss timer lives in
 * `useLostSoulCinematic` so this component is safe under React strict-mode's
 * effect double-invocation.
 *
 * Renders as a DOM overlay above the Konva canvas so we don't touch the canvas
 * render loop. Animations are CSS-only on transform/opacity. Styles live in
 * app/globals.css (`.lsc-*` selectors and `@keyframes lsc-*`).
 */
export function LostSoulCinematic({ souls }: Props) {
  const [reduceMotion] = useState(prefersReducedMotion);

  if (souls.length === 0) return null;

  const shown = souls.slice(0, MAX_SHOWN_CARDS);
  const overflow = souls.length - shown.length;
  const rootClass = reduceMotion ? 'lsc-root lsc-reduced' : 'lsc-root';

  return (
    <div className={rootClass} aria-hidden="true">
      <div className="lsc-backdrop" />
      <div className="lsc-stage">
        <div className="lsc-cards">
          {shown.map((soul, i) => {
            const total = shown.length;
            const offset = i - (total - 1) / 2;
            const rot = offset * 4;
            const tx = offset * 28;
            const ty = Math.abs(offset) * 6;
            const z = total - Math.abs(Math.round(offset));
            return (
              <div
                key={soul.instanceId}
                className="lsc-slot"
                style={{
                  transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
                  zIndex: z,
                }}
              >
                <div className="lsc-card" style={{ animationDelay: `${i * 40}ms` }}>
                  <SoulImage
                    src={soul.imageUrl}
                    placeholderName={simplifyLostSoulName(soul.cardName)}
                  />
                  <ChainSvg instanceId={soul.instanceId} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="lsc-names">
          {shown.map(s => (
            <div key={s.instanceId} className="lsc-name">
              {simplifyLostSoulName(s.cardName)}
            </div>
          ))}
          {overflow > 0 && (
            <div className="lsc-name lsc-overflow">+{overflow} more</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Stadium-shape (rounded-rect) chain link with an inner hole, drawn as a
 * single path with `fill-rule="evenodd"`. The outer outline winds clockwise;
 * the inner hole winds counter-clockwise so evenodd punches it out.
 *
 * Coordinates are centered on (0,0) so the parent <g transform="translate(...)">
 * positions the link and CSS `transform-origin: center` scales it cleanly.
 */
const H_LINK_PATH =
  'M -14,-11 H 14 A 11 11 0 0 1 14,11 H -14 A 11 11 0 0 1 -14,-11 Z ' +
  'M -11,-4 H 11 A 4 4 0 0 0 11,4 H -11 A 4 4 0 0 0 -11,-4 Z';
const V_LINK_PATH =
  'M -11,-14 V 14 A 11 11 0 0 1 11,14 V -14 A 11 11 0 0 1 -11,-14 Z ' +
  'M -4,-11 V 11 A 4 4 0 0 0 4,11 V -11 A 4 4 0 0 0 -4,-11 Z';

/**
 * Seven chunky chain links across the card, alternating horizontal/vertical
 * orientation. Spacing of 36 against outer width 50 gives ~28% overlap at
 * each join so the simple z-order draw reads as interlock. Links extend past
 * the card edges so the chain appears to wrap around.
 */
const CHAIN_LINKS: { cx: number; vertical: boolean }[] = [
  { cx: -12, vertical: false },
  { cx: 24,  vertical: true  },
  { cx: 60,  vertical: false },
  { cx: 96,  vertical: true  },
  { cx: 132, vertical: false },
  { cx: 168, vertical: true  },
  { cx: 204, vertical: false },
];

function ChainSvg({ instanceId }: { instanceId: string }) {
  const hGradId = `lsc-h-grad-${instanceId}`;
  const vGradId = `lsc-v-grad-${instanceId}`;
  return (
    <svg
      className="lsc-chain"
      viewBox="0 0 240 280"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        {/* Gradient runs across the SHORT axis of the link so each tube reads
            as 3D-rounded (dark edge → bright top → dark edge). */}
        <linearGradient id={hGradId} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#140a02" />
          <stop offset="22%"  stopColor="#5a3e1c" />
          <stop offset="50%"  stopColor="#f0d089" />
          <stop offset="78%"  stopColor="#5a3e1c" />
          <stop offset="100%" stopColor="#140a02" />
        </linearGradient>
        <linearGradient id={vGradId} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#140a02" />
          <stop offset="22%"  stopColor="#5a3e1c" />
          <stop offset="50%"  stopColor="#f0d089" />
          <stop offset="78%"  stopColor="#5a3e1c" />
          <stop offset="100%" stopColor="#140a02" />
        </linearGradient>
      </defs>
      {CHAIN_LINKS.map((link, idx) => (
        // Outer <g> positions; inner <g> takes the CSS forge animation so
        // attribute-transform (translate) and CSS-transform (scale) don't fight.
        <g key={idx} transform={`translate(${link.cx} 140)`}>
          <g className={`lsc-link lsc-link-${idx}`}>
            <path
              d={link.vertical ? V_LINK_PATH : H_LINK_PATH}
              fill={`url(#${link.vertical ? vGradId : hGradId})`}
              fillRule="evenodd"
              stroke="#0d0701"
              strokeWidth="0.7"
            />
          </g>
        </g>
      ))}
    </svg>
  );
}

/**
 * Renders the soul image with a Cinzel-named placeholder shown until the
 * bitmap decodes. Prevents the cold-cache "blank brown card" on first arrival.
 *
 * Critically: the Konva canvas has usually already cached the image, so the
 * `load` event fires synchronously before React attaches `onLoad`. We catch
 * that case via `imgRef.current.complete` in a layout effect, otherwise the
 * image would stay at opacity 0 forever and the user would only see the
 * placeholder + chains over a dark card.
 */
function SoulImage({ src, placeholderName }: { src: string; placeholderName: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <>
      {/* Skip the <img> entirely when the src is empty (e.g. an unresolved
          Forge card) — an empty `src=""` triggers a browser refetch warning
          and never fires onLoad, so we'd be stuck on the placeholder anyway. */}
      {src && (
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          className={loaded ? 'lsc-card-img lsc-card-img-ready' : 'lsc-card-img'}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      )}
      {!loaded && (
        <span className="lsc-card-placeholder">{placeholderName}</span>
      )}
    </>
  );
}
