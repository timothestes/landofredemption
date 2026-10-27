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
}

export default function CaptureButtons({ addFiles, chooseInputRef, disabled = false }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > 0) addFiles(files);
    input.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="min-h-11 w-full focus:outline-none sm:flex-1"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="mr-2 h-4 w-4" aria-hidden />
          {COPY.capturePrimary}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full focus:outline-none sm:flex-1"
          disabled={disabled}
          onClick={() => chooseInputRef.current?.click()}
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
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>{COPY.batchTip}</p>
        <p>{COPY.binderTip}</p>
      </div>
    </div>
  );
}
