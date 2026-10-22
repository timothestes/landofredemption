'use client';

import { useRef, useMemo, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { GameProvider } from '../state/GameContext';
import { CardPreviewProvider } from '../state/CardPreviewContext';
import { LoadingScreen } from '../components/LoadingScreen';
import { CardLoupePanel } from '../components/CardLoupePanel';
import { useImagePreloader } from '../hooks/useImagePreloader';
import type { DeckDataForGoldfish } from '../types';
import { getCardImageUrl } from '../../shared/utils/cardImageUrl';
import { useVirtualCanvas } from '@/app/shared/layout/virtualCanvas';
import { DeckPickerModal } from '@/app/play/components/DeckPickerModal';
import type { DeckOption } from '@/app/play/components/DeckPickerCard';
import { ParagonDrawer } from '@/app/shared/components/ParagonDrawer';
import { useGameBackground } from '@/app/shared/hooks/useGameBackground';
import { buildParagonEntries } from '@/app/shared/utils/paragonEntries';

const GoldfishCanvas = dynamic(() => import('../components/GoldfishCanvas'), { ssr: false });

interface GoldfishClientProps {
  deck: DeckDataForGoldfish;
  /** Logged-in user's profile username — only used to gate the cycling-token
   *  easter egg. Null when not signed in. */
  username?: string | null;
}

function GoldfishGameArea({ deck, onLoadDeck }: { deck: DeckDataForGoldfish; onLoadDeck: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  // Collect all unique image URLs to preload
  const imageUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const c of deck.cards) {
      if (c.card_img_file) {
        urls.add(getCardImageUrl(c.card_img_file));
      }
    }
    return Array.from(urls);
  }, [deck.cards]);

  const { isReady, progress } = useImagePreloader(imageUrls);

  // The player's own uploaded image when they have one on; otherwise Forge
  // decks play against the forge background and everything else the cave.
  const backgroundImage = useGameBackground(deck.isForge);

  // Warm the canvas chunk while the loading screen is up — GoldfishCanvas is
  // dynamically imported, and without this it only starts downloading after
  // isReady flips, leaving the cave background briefly unshaded.
  useEffect(() => {
    import('../components/GoldfishCanvas');
  }, []);

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

  if (!isReady) {
    return <LoadingScreen progress={progress} isForge={deck.isForge} />;
  }

  return (
    <div
      className="gf-area-enter"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--gf-bg-dark)',
        cursor: 'default',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Cave (or Forge) background image — shared across game area and loupe */}
      <div
        className="cave-bg"
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

      {/* Torch glow + vignette overlays */}
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

      {/* Game area container — ref measures available space after loupe */}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <GoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            virtualWidth={virtualWidth}
            onLoadDeck={onLoadDeck}
          />
        )}
      </div>

      {/* Loupe preview panel — right side */}
      <CardLoupePanel />

      {/* Paragon drawer — DOM overlay; self-hides when no paragon */}
      <ParagonDrawer paragons={paragonEntries} />
    </div>
  );
}

export default function GoldfishClient({ deck, username }: GoldfishClientProps) {
  const router = useRouter();
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [pendingDeck, setPendingDeck] = useState<DeckOption | null>(null);

  useEffect(() => {
    localStorage.setItem('lastPlayedDeckId', deck.id);
  }, [deck.id]);

  return (
    <CardPreviewProvider>
      <GameProvider deck={deck} username={username}>
        <GoldfishGameArea deck={deck} onLoadDeck={() => setShowDeckPicker(true)} />
      </GameProvider>

      <DeckPickerModal
        open={showDeckPicker}
        onOpenChange={setShowDeckPicker}
        onSelect={(picked) => {
          setShowDeckPicker(false);
          if (picked.id === deck.id) return;
          setPendingDeck(picked);
        }}
        selectedDeckId={deck.id}
      />

      {pendingDeck && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'rgba(var(--gf-bg-dark-rgb), 0.97)',
              border: '1px solid rgba(var(--gf-border-rgb), 0.3)',
              borderRadius: 8,
              padding: '20px 28px',
              maxWidth: 320,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--gf-accent-rgb), 0.08)',
            }}
          >
            <p style={{ fontFamily: 'Georgia, serif', color: 'var(--gf-text-bright)', fontSize: 13, lineHeight: 1.5 }}>
              Clear the current game and load <strong>{pendingDeck.name}</strong>?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
              <button
                onClick={() => setPendingDeck(null)}
                style={{
                  padding: '7px 18px',
                  background: 'transparent',
                  border: '1px solid rgba(var(--gf-border-rgb), 0.3)',
                  borderRadius: 4,
                  color: 'rgba(var(--gf-accent-rgb), 0.6)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = pendingDeck.id;
                  setPendingDeck(null);
                  router.push(`/goldfish/${id}`);
                }}
                style={{
                  padding: '7px 18px',
                  background: 'rgba(var(--gf-accent-rgb), 0.15)',
                  border: '1px solid rgba(var(--gf-accent-rgb), 0.5)',
                  borderRadius: 4,
                  color: 'var(--gf-text-bright)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'Georgia, serif',
                }}
              >
                Load Deck
              </button>
            </div>
          </div>
        </div>
      )}
    </CardPreviewProvider>
  );
}
