import {
  GAME_BACKGROUND_MAX_BYTES,
  GAME_BACKGROUND_MAX_EDGE,
  GAME_BACKGROUND_MAX_INPUT_BYTES,
  fitWithin,
} from './gameBackground';

/**
 * Browser-only: decode a picked image, shrink it to GAME_BACKGROUND_MAX_EDGE
 * and re-encode as WebP (JPEG where the browser cannot encode WebP — older
 * Safari silently hands back PNG). Re-encoding also strips EXIF/GPS and any
 * animation. Throws with a user-facing message.
 */
export async function encodeGameBackground(file: File): Promise<Blob> {
  // An empty type is common for .heic on desktop; let the decoder decide.
  if ((file.type && !file.type.startsWith('image/')) || file.type === 'image/svg+xml') {
    throw new Error('Pick a JPEG, PNG or WebP image');
  }
  if (file.size > GAME_BACKGROUND_MAX_INPUT_BYTES) {
    throw new Error(`Image too large. Maximum ${GAME_BACKGROUND_MAX_INPUT_BYTES / 1024 / 1024} MB.`);
  }

  const source = await decode(file);
  const { width, height } = fitWithin(source.width, source.height, GAME_BACKGROUND_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image');
  ctx.drawImage(source.image, 0, 0, width, height);
  source.close();

  let out = await toBlob(canvas, 'image/webp', 0.85);
  if (!out || out.type !== 'image/webp') out = await toBlob(canvas, 'image/jpeg', 0.85);
  if (out && out.size > GAME_BACKGROUND_MAX_BYTES) out = await toBlob(canvas, 'image/jpeg', 0.7);
  if (!out || out.size > GAME_BACKGROUND_MAX_BYTES) throw new Error('Could not shrink that image enough');
  return out;
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Some browsers decode formats (e.g. HEIC on Safari) only through <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Could not read that image. Try a JPEG or PNG.');
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
