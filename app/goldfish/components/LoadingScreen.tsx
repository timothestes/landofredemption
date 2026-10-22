'use client';

import { useEffect, useState } from 'react';
import { LOADING_MESSAGES } from '@/app/shared/constants/loadingMessages';
import { useGameBackground } from '@/app/shared/hooks/useGameBackground';

export function LoadingScreen({ progress, isForge }: { progress: number; isForge?: boolean }) {
  const backgroundImage = useGameBackground(isForge);
  // Randomize only after mount: picking during render runs on the server too,
  // and a different pick on the client is a hydration text mismatch.
  const [message, setMessage] = useState(LOADING_MESSAGES[0]);
  useEffect(() => {
    setMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
  }, []);
  const percent = Math.round(progress * 100);

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--gf-bg-dark)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
      }}
    >
      {/* Cave (or Forge) background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage,
          backgroundSize: 'cover',
          backgroundPosition: 'center 70%',
          backgroundRepeat: 'no-repeat',
          opacity: 0.4,
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <p
          className="font-cinzel"
          style={{
            color: 'var(--gf-text)',
            fontSize: 20,
            letterSpacing: '0.05em',
            marginBottom: 24,
          }}
        >
          {message}
        </p>

        {/* Progress bar */}
        <div
          style={{
            width: 'min(320px, 80vw)',
            height: 8,
            background: 'var(--gf-bg)',
            borderRadius: 2,
            overflow: 'hidden',
            margin: '0 auto',
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: 'var(--gf-text-dim)',
              transition: 'width 0.2s ease',
            }}
          />
        </div>

        <p
          style={{
            color: 'var(--gf-text-dim)',
            fontSize: 14,
            marginTop: 12,
            fontFamily: 'monospace',
          }}
        >
          {percent}%
        </p>
      </div>
    </div>
  );
}
