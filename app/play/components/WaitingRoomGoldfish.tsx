'use client';

import { useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useGameBackground } from '@/app/shared/hooks/useGameBackground';
import { CardPreviewProvider } from '@/app/goldfish/state/CardPreviewContext';
import { GameProvider } from '@/app/goldfish/state/GameContext';
import { CardLoupePanel } from '@/app/goldfish/components/CardLoupePanel';
import type { DeckDataForGoldfish } from '@/app/goldfish/types';
import { useVirtualCanvas } from '@/app/shared/layout/virtualCanvas';
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';

const DynamicGoldfishCanvas = dynamic(
  () => import('@/app/goldfish/components/GoldfishCanvas'),
  { ssr: false },
);

export const BANNER_HEIGHT = 48;

interface WaitingRoomGoldfishProps {
  deck: DeckDataForGoldfish;
  onLoadDeck?: () => void;
  /** Local player's display name (profiles.username-derived) — only used to
   *  gate the per-user cycling-token easter egg in goldfish. */
  username?: string | null;
}

function GoldfishArea({ deck, onLoadDeck }: { deck: DeckDataForGoldfish; onLoadDeck?: () => void }) {
  const backgroundImage = useGameBackground();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  const paragonEntries = useMemo(
    () => buildParagonEntries({
      players: [
        {
          id: 'goldfish-self',
          displayName: 'You',
          paragonName: deck.paragon ?? null,
          isSelf: true,
        },
      ],
    }),
    [deck.paragon],
  );

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `calc(100vh - ${BANNER_HEIGHT}px)`,
        overflow: 'hidden',
        background: '#0d0905',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Cave background (or the player's own image) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage,
          backgroundSize: 'cover',
          backgroundPosition: 'center 70%',
          backgroundRepeat: 'no-repeat',
          pointerEvents: 'none',
        }}
      />

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(ellipse 60% 50% at 50% 30%, rgba(180,120,40,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.75) 100%)
          `,
        }}
      />

      {/* Game area */}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <DynamicGoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            virtualWidth={virtualWidth}
            onLoadDeck={onLoadDeck}
            hideBackButton
          />
        )}
      </div>

      {/* Card preview panel */}
      <CardLoupePanel />

      {/* Paragon drawer — DOM overlay; self-hides when no paragon */}
      <ParagonDrawer paragons={paragonEntries} />
    </div>
  );
}

export default function WaitingRoomGoldfish({ deck, onLoadDeck, username }: WaitingRoomGoldfishProps) {
  return (
    <CardPreviewProvider>
      {/* Key on deck.id so swapping the deck remounts GameProvider with a fresh
          initial state — its useMemo is keyed to mount only. */}
      <GameProvider key={deck.id} deck={deck} username={username}>
        <GoldfishArea deck={deck} onLoadDeck={onLoadDeck} />
      </GameProvider>
    </CardPreviewProvider>
  );
}
