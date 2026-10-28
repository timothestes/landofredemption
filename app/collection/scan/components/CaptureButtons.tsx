'use client';

import { useRef, type ChangeEvent, type RefObject } from 'react';
import { Camera, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COPY } from '../copy';

interface Props {
  addFiles: (files: File[]) => void;
  /** The Choose-from-photos input, so a failed photo's "Choose another" can re-open it. */
  chooseInputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  /** False while files must not join the tray (committing, or a picker left open across a commit). */
  accepting: boolean;
  /** Runs before the file picker opens: after an add, starts a new batch. */
  onBeforeOpen?: () => void;
  hint?: string | null;
  /** The tips are for a first photo; once the tray has photos they push the review list below the fold. */
  showTips: boolean;
}

export default function CaptureButtons({
  addFiles, chooseInputRef, disabled = false, accepting, onBeforeOpen, hint, showTips,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = input.files ? Array.from(input.files) : [];
    // A picker opened before a commit can return after it; those photos must not join a committed tray.
    if (files.length > 0 && accepting) addFiles(files);
    input.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="min-h-11 w-full focus:outline-none sm:flex-1"
          disabled={disabled}
          onClick={() => {
            onBeforeOpen?.();
            cameraRef.current?.click();
          }}
        >
          <Camera className="mr-2 h-4 w-4" aria-hidden />
          {COPY.capturePrimary}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full focus:outline-none sm:flex-1"
          disabled={disabled}
          onClick={() => {
            onBeforeOpen?.();
            chooseInputRef.current?.click();
          }}
        >
          <Images className="mr-2 h-4 w-4" aria-hidden />
          {COPY.captureSecondary}
        </Button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onChange}
      />
      <input
        ref={chooseInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={onChange}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {showTips && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{COPY.batchTip}</p>
          <p>{COPY.binderTip}</p>
        </div>
      )}
    </div>
  );
}
