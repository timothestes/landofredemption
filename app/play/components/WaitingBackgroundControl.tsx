'use client';

import { useRef } from 'react';
import { FlipHorizontal2, ImagePlus, Trash2 } from 'lucide-react';
import { useGameBackgroundSettings } from '@/app/shared/hooks/useGameBackground';
import { LobbySettingRow, LobbySwitch, lobbyTextButtonClass } from './LobbySettingRow';

/**
 * Table-background row for the "waiting for an opponent" card — the same
 * per-account store as the in-game gear menu (GameBackgroundSetting). The
 * backdrop behind the card repaints as soon as an upload lands, so this
 * doubles as a preview. Only the player sees their image. Hidden when signed
 * out.
 */
export function WaitingBackgroundControl() {
  const { loaded, signedIn, row, busy, error, uploadFile, flip, setEnabled, remove } = useGameBackgroundSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!loaded || !signedIn) return null;

  const pick = () => inputRef.current?.click();
  const iconClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-200/50 hover:bg-amber-200/5 hover:text-amber-200/90 transition-colors disabled:opacity-50';

  const hint = error ? (
    <span role="alert" className="text-red-300/80">{error}</span>
  ) : busy ? (
    row ? 'Saving…' : 'Uploading…'
  ) : (
    'Only you see it'
  );

  return (
    <LobbySettingRow label="Table background" hint={hint}>
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
        <>
          {row.enabled && (
            <button onClick={flip} disabled={busy} className={iconClass} title="Flip" aria-label="Flip background">
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={pick} disabled={busy} className={iconClass} title="Replace" aria-label="Replace background">
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={remove} disabled={busy} className={iconClass} title="Remove" aria-label="Remove background">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <LobbySwitch checked={row.enabled} onChange={setEnabled} label="Use my table background" disabled={busy} />
        </>
      ) : (
        <button onClick={pick} disabled={busy} className={lobbyTextButtonClass}>
          <ImagePlus className="h-3 w-3" />
          Upload
        </button>
      )}
    </LobbySettingRow>
  );
}
