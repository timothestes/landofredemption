// The editor's client state, parked across an unmount it did not ask for.
//
// ensureId() rewrites /admin/posts/new to /admin/posts/<id> with
// history.replaceState and then router.refresh(). The refresh renders the
// [id] route, which is a different segment from /new, so Next unmounts the
// editor and mounts a fresh one whose `initial` prop is whatever row the
// server read — the title only, when the body's first update is still in
// flight. Anything typed before that moment vanished from the screen (the DB
// still had it), and the next autosave wrote the stale empty body back over
// it. The same remount hits a later Server Action's refresh (see
// reference_history_replacestate_needs_router_refresh).
//
// So the unmounting instance parks its state here and the mounting one
// adopts it when it is for the same post and fresh. Module scope, not
// storage: it only has to outlive one React commit, never a reload.

export interface DraftStash {
  id: string;
  title: string;
  slug: string;
  slugTouched: boolean;
  tags: string[];
  excerpt: string;
  cover: string | null;
  body: string;
  publishAt: string;
  scheduledAt: string | null;
  status: "draft" | "published";
  previewToken: string | null;
  dirty: boolean;
  /** Body caret to restore, or null when the body was not focused. */
  selection: { start: number; end: number } | null;
}

/** A remount lands within a second or two; anything older is a revisit. */
export const STASH_TTL_MS = 15_000;

let stash: (DraftStash & { at: number }) | null = null;

export function putDraftStash(s: DraftStash, now = Date.now()): void {
  stash = { ...s, at: now };
}

/** The stash for `id` when one was put within the TTL; null otherwise. Does not consume it. */
export function peekDraftStash(id: string, now = Date.now()): DraftStash | null {
  if (!stash || stash.id !== id || now - stash.at > STASH_TTL_MS) return null;
  const { at: _at, ...rest } = stash;
  return rest;
}

export function clearDraftStash(): void {
  stash = null;
}
