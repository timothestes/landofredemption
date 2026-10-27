export const MAX_EDGE = 2576;
export const MAX_BYTES = 3 * 1024 * 1024;

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export class PrepareError extends Error {
  kind: 'heif' | 'too_large';
  constructor(kind: 'heif' | 'too_large') {
    super(kind);
    this.name = 'PrepareError';
    this.kind = kind;
  }
}

function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new PrepareError('heif'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** Decode, downscale to MAX_EDGE and re-encode as JPEG under MAX_BYTES. DOM-only. */
export async function prepareImage(file: File): Promise<Blob> {
  const img = await decode(file).catch(() => {
    throw new PrepareError('heif');
  });
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_EDGE);
  if (!w || !h) throw new PrepareError('heif');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PrepareError('heif');
  ctx.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.75, 0.65]) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new PrepareError('too_large');
}
