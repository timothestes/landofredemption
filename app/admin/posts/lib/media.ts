// Shared by the browser (pre-flight validation, pathname) and the token route
// (the limits Vercel Blob enforces). No server-only imports here.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export type UploadKind = "image" | "audio";

/** `accept` attribute for the hidden file inputs. */
export const ACCEPT: Record<UploadKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  audio: "audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav",
};

export function limitsFor(kind: UploadKind): { types: string[]; maxBytes: number } {
  return kind === "audio"
    ? { types: [...AUDIO_TYPES], maxBytes: MAX_AUDIO_BYTES }
    : { types: [...IMAGE_TYPES], maxBytes: MAX_IMAGE_BYTES };
}

/** Error message, or null when the file may be uploaded. Pure. */
export function validateMediaFile(file: { type: string; size: number }, kind: UploadKind): string | null {
  const { types, maxBytes } = limitsFor(kind);
  if (!types.includes(file.type)) {
    return kind === "audio" ? "Audio must be MP3, M4A, OGG or WAV" : "Images must be JPEG, PNG, WebP or GIF";
  }
  if (file.size > maxBytes) return `File too large. Maximum ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  return null;
}

/** `posts/<postId>/<sanitised-base>.<ext>` — the token route requires this prefix. */
export function mediaPathname(postId: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const rawExt = dot === -1 ? "" : fileName.slice(dot + 1);
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const rawBase = dot === -1 ? fileName : fileName.slice(0, dot);
  const base =
    rawBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "file";
  return `posts/${postId}/${base}.${ext}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMERA_NAME_RE = /^(IMG|DSC|PXL|DCIM|Screenshot|Screen Shot)[ _-]?\d/i;

/**
 * Default alt text for an uploaded image: the file name made readable, or ""
 * when the name is a camera/screenshot/UUID/number that says nothing, so the
 * published alt attribute is left empty for the poster to fill rather than
 * shipping as "IMG_4821".
 */
export function altFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  if (CAMERA_NAME_RE.test(base) || UUID_RE.test(base) || /^\d+$/.test(base)) return "";
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The JSON the browser sends as clientPayload; null when malformed. */
export function parseClientPayload(raw: string | null): { postId: string; kind: UploadKind } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { postId?: unknown; kind?: unknown };
    if (typeof p.postId === "string" && UUID_RE.test(p.postId) && (p.kind === "image" || p.kind === "audio")) {
      return { postId: p.postId, kind: p.kind };
    }
  } catch {
    /* fall through */
  }
  return null;
}
