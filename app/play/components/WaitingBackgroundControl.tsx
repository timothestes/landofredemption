'use client';

import { useRef } from 'react';
import { FlipHorizontal2, ImagePlus, Trash2 } from 'lucide-react';
import { useGameBackgroundSettings } from '@/app/shared/hooks/useGameBackground';

/**
 * Table-background control for the "waiting for an opponent" card — the same
 * per-account store as the in-game gear menu (GameBackgroundSetting), styled
 * to sit with the card's visibility switch. The backdrop behind the card
 * repaints as soon as an upload lands, so this doubles as a preview. Only the
 * player sees their image. Hidden when signed out.
 */
export function WaitingBackgroundControl() {
  const { loaded, signedIn, row, busy, error, uploadFile, flip, setEnabled, remove } = useGameBackgroundSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!loaded || !signedIn) return null;

  const pick = () => inputRef.current?.click();
  const linkClass =
    'inline-flex min-h-[32px] items-center gap-1 px-1 text-[11px] text-amber-200/40 hover:text-amber-200/60 transition-colors disabled:opacity-50';

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) uploadFile(file);
        }}
      />
      {row ? (
        <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
          <button
            role="switch"
            aria-checked={row.enabled}
            aria-label="My table background"
            disabled={busy}
            onClick={() => setEnabled(!row.enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
              row.enabled ? 'bg-primary' : 'bg-amber-200/20'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                row.enabled ? 'translate-x-[19px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
          <span className="text-[11px] text-amber-200/40">
            {busy ? 'Saving…' : row.enabled ? 'My background on' : 'My background off'}
          </span>
          <button onClick={pick} disabled={busy} className={linkClass} title="Upload a different image">
            <ImagePlus className="h-3 w-3" />
            Replace
          </button>
          <button onClick={flip} disabled={busy} className={linkClass} title="Mirror your background left-to-right">
            <FlipHorizontal2 className="h-3 w-3" />
            Flip
          </button>
          <button onClick={remove} disabled={busy} className={linkClass} title="Delete your background image">
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      ) : (
        <button
          onClick={pick}
          disabled={busy}
          className={linkClass}
          title="Upload an image to play on. Only you see it."
        >
          <ImagePlus className="h-3 w-3" />
          {busy ? 'Uploading…' : 'Upload table background'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-300/70">
          {error}
        </p>
      )}
    </div>
  );
}
