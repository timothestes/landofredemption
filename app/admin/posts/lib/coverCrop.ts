// Cover crop: the pure sizing/naming helpers (unit-tested, no DOM) plus the
// one browser helper that draws the chosen rect onto a canvas and hands back
// a File for the existing upload path. Every public surface that shows a
// cover is 16:9 or an object-cover of it, so that is the only frame offered.
import { validateMediaFile } from "./media";

export const COVER_ASPECT = 16 / 9;
const MAX_COVER_WIDTH = 1920;

export interface CropPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

type OutputType = "image/png" | "image/jpeg";

/** Output size for a crop rect: scaled DOWN to `maxWidth` only, aspect kept, integers ≥ 1. */
export function cropOutputSize(px: { width: number; height: number }, maxWidth = MAX_COVER_WIDTH): { width: number; height: number } {
  const scale = px.width > maxWidth ? maxWidth / px.width : 1;
  return {
    width: Math.max(1, Math.round(px.width * scale)),
    height: Math.max(1, Math.round(px.height * scale)),
  };
}

/** PNG keeps its transparency; everything else is re-encoded as JPEG. */
export function cropOutputType(srcType: string): OutputType {
  return srcType === "image/png" ? "image/png" : "image/jpeg";
}

/** MIME type of an already-uploaded cover, from its URL's extension. */
export function typeFromUrl(url: string): string {
  let pathname = url;
  try {
    pathname = new URL(url, "https://placeholder.invalid").pathname;
  } catch {
    /* keep the raw string */
  }
  return /\.png$/i.test(pathname) ? "image/png" : "image/jpeg";
}

/**
 * `<base>-cover.jpg|png` (or `cover.jpg|png` when there is no source name),
 * so mediaPathname() picks up the extension that matches the encoding.
 */
export function croppedFileName(name: string, type: OutputType): string {
  const ext = type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "").trim();
  return `${base ? `${base}-cover` : "cover"}.${ext}`;
}

/**
 * Draw `px` of `src` onto a canvas and return it as a File ready for
 * uploadPostMedia. Browser only. `src` may be an object URL or a public Blob
 * URL (Vercel Blob sends `access-control-allow-origin: *`, so the anonymous
 * CORS load keeps the canvas untainted). Rejects with a user-facing message.
 */
export function renderCrop(src: string, px: CropPixels, srcType: string, name: string): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const type = cropOutputType(srcType);
      const { width, height } = cropOutputSize(px);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Couldn't crop this image."));
      ctx.drawImage(img, px.x, px.y, px.width, px.height, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Couldn't crop this image."));
          const file = new File([blob], croppedFileName(name, type), { type });
          const problem = validateMediaFile(file, "image");
          if (problem) reject(new Error(problem));
          else resolve(file);
        },
        type,
        0.9,
      );
    };
    img.onerror = () => reject(new Error("Couldn't load this image."));
    img.src = src;
  });
}
