'use client';

import { useRef, type ReactNode } from 'react';
import { FlipHorizontal2, ImagePlus, Image as ImageIcon, ImageOff, Palette, Trash2 } from 'lucide-react';
import { useGameBackgroundSettings } from '@/app/shared/hooks/useGameBackground';

/**
 * Gear-menu section for the player's own table background. Only the player
 * sees it — opponents and spectators keep their own (or the default) art.
 * Hidden when signed out, since the image is stored per account.
 */
export function GameBackgroundSetting() {
  const { loaded, signedIn, row, busy, error, matchUi, uploadFile, flip, setEnabled, remove, setMatchUi } = useGameBackgroundSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!loaded || !signedIn) return null;

  return (
    <>
      <div style={{ height: 1, background: 'var(--gf-border, #3d2e1f)', margin: '4px 0' }} />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) uploadFile(file);
        }}
      />
      {row ? (
        <>
          <MenuButton
            onClick={() => setEnabled(!row.enabled)}
            disabled={busy}
            pressed={row.enabled}
            title="Show your uploaded image behind the table. Only you see it."
          >
            {row.enabled ? <ImageIcon size={14} /> : <ImageOff size={14} />}
            {row.enabled ? 'My Background On' : 'My Background Off'}
          </MenuButton>
          {row.enabled && (
            <MenuButton
              onClick={() => setMatchUi(!matchUi)}
              pressed={matchUi}
              title="Tint the menus and panels to match your background. Only you see it."
            >
              <Palette size={14} />
              {matchUi ? 'Match UI Colors On' : 'Match UI Colors Off'}
            </MenuButton>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <MenuButton onClick={() => inputRef.current?.click()} disabled={busy} title="Upload a different image">
              <ImagePlus size={14} />
              {busy ? 'Working…' : 'Replace'}
            </MenuButton>
            <MenuButton onClick={flip} disabled={busy} title="Mirror your background left-to-right">
              <FlipHorizontal2 size={14} />
              Flip
            </MenuButton>
            <MenuButton onClick={remove} disabled={busy} title="Delete your background image">
              <Trash2 size={14} />
              Remove
            </MenuButton>
          </div>
        </>
      ) : (
        <MenuButton
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="Upload an image to play on. Only you see it."
        >
          <ImagePlus size={14} />
          {busy ? 'Uploading…' : 'Upload Background'}
        </MenuButton>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: '#e8a08a', maxWidth: 220 }}>
          {error}
        </span>
      )}
    </>
  );
}

function MenuButton({ children, onClick, disabled, pressed, title }: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '6px 4px',
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        color: 'var(--gf-text, #e8d5a3)',
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
