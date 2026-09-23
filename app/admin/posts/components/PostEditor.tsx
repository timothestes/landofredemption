"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import ToastNotification from "@/components/ui/toast-notification";
import ArticleBody from "@/app/articles/components/ArticleBody";
import { EMPTY_REFS, type ArticleRefs } from "@/app/articles/lib/refTypes";
import { excerptFromMarkdown, opensCardPicker, slugify, youtubeId } from "@/app/articles/lib/markdown";
import {
  createDraftAction,
  updatePostAction,
  publishPostAction,
  unpublishPostAction,
  schedulePostAction,
  cancelScheduleAction,
  deletePostAction,
  listTagsAction,
  resolveArticleRefsAction,
  searchCardsAction,
  type PostRow,
} from "../actions";
import { ACCEPT, type UploadKind } from "../lib/media";
import { uploadPostMedia } from "../lib/uploadMedia";
import { toDatetimeLocalValue, fromDatetimeLocalValue, isFutureIso } from "../lib/schedule";
import {
  continueList,
  insertBlock,
  minimalEdit,
  prefixLines,
  replaceOnce,
  wrapSelection,
  type EditResult,
} from "../lib/textarea";
import { MAX_EXCERPT, MAX_TITLE } from "../lib/validate";
import MarkdownToolbar, { type ToolbarAction } from "./MarkdownToolbar";
import TagInput from "./TagInput";
import CardPicker from "@/components/ui/CardPicker";
import DeckPicker from "./DeckPicker";

type Toast = { message: string; type: "success" | "error" } | null;
type Busy = null | "save" | "publish" | "schedule" | "unpublish" | "delete";

const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// One editor for /admin/posts/new (initial = null) and /admin/posts/[id].
// The draft row is created lazily by ensureId() on the first save or upload;
// the URL is then rewritten in place with history.replaceState so the
// component keeps its state (a router.replace would remount it).
export default function PostEditor({ initial }: { initial: PostRow | null }) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState<"draft" | "published">(initial?.status ?? "draft");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(initial !== null);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? "");
  const [cover, setCover] = useState<string | null>(initial?.cover_image_url ?? null);
  const [body, setBody] = useState(initial?.body_md ?? "");
  // datetime-local string for the "Publish date" field. Pre-fills from a
  // pending schedule first (so reopening a scheduled draft shows the target
  // time), else the actual published_at.
  const [publishAt, setPublishAt] = useState(toDatetimeLocalValue(initial?.scheduled_at ?? initial?.published_at ?? null));
  // The server-persisted schedule, separate from `publishAt`: it only
  // changes via an explicit Schedule/Cancel action, never by editing the
  // field or by autosave, so a half-typed future date can't silently
  // schedule a post out from under the poster.
  const [scheduledAt, setScheduledAt] = useState<string | null>(initial?.scheduled_at ?? null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  // Drafts autosave silently (no busy, so the toolbar stays enabled); this is
  // the side channel the status text reads. Published posts never autosave:
  // updatePostAction revalidates the public page, so they keep explicit Update.
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Target of a leave-confirmation triggered by the generic nav-intercept
  // below (any internal link, not just "← Posts"); defaults to the posts
  // list since that's what the dialog always navigated to before.
  const pendingHrefRef = useRef("/admin/posts");
  // In-flight uploads. A counter, not a boolean: paste/drop bypass the locked
  // toolbar, so two uploads can overlap and must not clear each other's flag.
  const [uploadCount, setUploadCount] = useState(0);
  const uploading = uploadCount > 0;
  const [toast, setToast] = useState<Toast>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Card picker: opened by the toolbar (the selection becomes the query) or
  // by typing "[[" (the two brackets are the range the pick replaces).
  const [cardPicker, setCardPicker] = useState<{ open: boolean; query: string; from: number; to: number }>({
    open: false,
    query: "",
    from: 0,
    to: 0,
  });
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  // Resolved card mentions and deck embeds for the preview — the same
  // resolution the public page runs (app/articles/lib/refs.ts).
  const [refs, setRefs] = useState<ArticleRefs>(EMPTY_REFS);
  const refsSeq = useRef(0);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const idRef = useRef<string | null>(id);
  // Coalesces concurrent ensureId() callers (e.g. picking an image and
  // clicking Save before the first createDraftAction round trip lands) onto
  // a single in-flight draft-creation promise so we never insert two rows.
  const creatingRef = useRef<Promise<{ id: string; slug: string } | null> | null>(null);
  // Bumped by every field change. save() snapshots it before the request and
  // only echoes the server's tags/slug back if nothing changed in flight.
  const editVersion = useRef(0);
  // ensureId() resolves asynchronously and is memoized, so it must read the
  // CURRENT slug state rather than whatever was captured when it was built.
  const slugRef = useRef(slug);
  const slugTouchedRef = useRef(slugTouched);
  slugRef.current = slug;
  slugTouchedRef.current = slugTouched;
  // The slug createDraftAction actually assigned, which may be suffixed
  // ("hello-2") when the derived one was already taken. onTitle clears it
  // whenever it re-derives the slug locally so it can never go stale.
  const serverSlugRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  // Queues save() calls so their requests reach the server in the same order
  // they were made. Without this, a manual Save/Leave/Publish click while a
  // silent autosave is still in flight (the toolbar stays enabled during
  // autosave — see `uploading`/`locked` below) fires a second updatePostAction
  // concurrently; if that earlier autosave's request happens to reach
  // Postgres AFTER the later one (slow function instance, cold start), it
  // overwrites newer content/an uploaded image with what it captured a moment
  // earlier. Chaining onto the prior save's promise guarantees each call only
  // starts once the previous one's write has already landed.
  const savePromiseRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // The editVersion a failed save was built from. Autosave doesn't retry
  // until an edit moves past it, so a persistent error can't loop every 1.5s.
  const failedVersion = useRef<number | null>(null);
  // Numbers upload placeholders so two concurrent replaceOnce calls can't cross-resolve.
  const uploadSeq = useRef(0);
  // Render-assigned snapshot for the flush-on-unmount effect below save().
  const patch = {
    title,
    slug,
    excerpt: excerpt || null,
    body_md: body,
    cover_image_url: cover,
    tags,
    published_at: fromDatetimeLocalValue(publishAt),
  };
  const latest = useRef({ dirty, status, patch });
  latest.current = { dirty, status, patch };

  useEffect(() => {
    listTagsAction()
      .then((r) => {
        if (r.success !== false) setSuggestions(r.tags);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!body.includes("[[") && !body.includes("/decklist/")) {
      setRefs(EMPTY_REFS);
      return;
    }
    const id = ++refsSeq.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await resolveArticleRefsAction(body);
        if (id === refsSeq.current && r.success !== false) setRefs(r.refs);
      } catch {
        // The preview keeps the last good refs; the next edit retries.
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [body]);

  const fail = (message: string) => setToast({ message, type: "error" });

  const onTitle = (v: string) => {
    setTitle(v);
    // Once published the slug field is disabled (slugTouched can never flip
    // true), so this must not re-derive after publish or it silently poisons
    // the locked slug on the next save.
    if (status === "draft" && !slugTouched) {
      setSlug(slugify(v));
      serverSlugRef.current = null;
    }
    editVersion.current += 1;
    setDirty(true);
  };

  // Resolves the draft's id and its SERVER slug. createDraftAction may
  // suffix the slug on collision (e.g. "hello-2"), or fill in a derived slug
  // that came out empty (a CJK/emoji-only title), so the row's slug can
  // differ from the client-derived one still sitting in state. Reconciling
  // here rather than in save() means EVERY entry point gets it — the media
  // and cover pickers create the draft too, and a picker-created draft whose
  // slug was never reconciled made the next save fail with "That slug is
  // already taken" (or the slug regex, for the empty case).
  // The picker takes names, not an ActionResult; a failure keeps the list showing.
  const searchCards = useCallback(async (q: string) => {
    const r = await searchCardsAction(q);
    return r.success === false ? [] : r.cards;
  }, []);

  const ensureId = useCallback((): Promise<{ id: string; slug: string } | null> => {
    if (idRef.current) return Promise.resolve({ id: idRef.current, slug: serverSlugRef.current ?? slugRef.current });
    if (creatingRef.current) return creatingRef.current;
    const promise = (async (): Promise<{ id: string; slug: string } | null> => {
      try {
        const r = await createDraftAction({ title });
        if (r.success === false) {
          fail(r.error);
          return null;
        }
        idRef.current = r.post.id;
        setId(r.post.id);
        serverSlugRef.current = r.post.slug;
        // Lock the server's slug in when it differs, so a later title edit
        // doesn't re-derive the one that just collided.
        if (!slugTouchedRef.current) {
          setSlug(r.post.slug);
          if (r.post.slug !== slugRef.current) setSlugTouched(true);
        }
        window.history.replaceState(null, "", `/admin/posts/${r.post.id}`);
        router.refresh();
        return { id: r.post.id, slug: r.post.slug };
      } finally {
        creatingRef.current = null;
      }
    })();
    creatingRef.current = promise;
    return promise;
  }, [title]);

  const selection = () => {
    const el = bodyRef.current;
    return { start: el?.selectionStart ?? body.length, end: el?.selectionEnd ?? body.length };
  };

  const applyEdit = (res: EditResult) => {
    const el = bodyRef.current;
    const d = minimalEdit(body, res.value);
    if (!d) return; // e.g. prefixLines on an already-prefixed line
    // insertText/delete over just the changed range keeps the browser's undo
    // stack; the textarea's onChange fires synchronously inside the command
    // and updates body/editVersion/dirty exactly as if the text had been
    // typed. Fall back to replacing the controlled value when it is unavailable.
    if (el) {
      el.focus();
      el.setSelectionRange(d.start, d.end);
      // Firefox treats an empty insertText as a no-op, so deletions use "delete".
      const done = d.text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, d.text);
      if (done && el.value === res.value) {
        // Set the selection now, not in a rAF: DOM and state already agree so
        // React leaves the value alone, and a deferred move would yank the
        // caret back from under a fast typist's next keystroke.
        el.setSelectionRange(res.selectionStart, res.selectionEnd);
        return;
      }
    }
    setBody(res.value);
    editVersion.current += 1;
    setDirty(true);
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(res.selectionStart, res.selectionEnd);
    });
  };

  const onToolbar = (action: ToolbarAction) => {
    const sel = selection();
    switch (action) {
      case "bold":
        return applyEdit(wrapSelection(body, sel, "**"));
      case "italic":
        return applyEdit(wrapSelection(body, sel, "_"));
      case "heading":
        return applyEdit(prefixLines(body, sel, "## "));
      case "quote":
        return applyEdit(prefixLines(body, sel, "> "));
      case "list":
        return applyEdit(prefixLines(body, sel, "- "));
      case "link": {
        const url = window.prompt("Link URL");
        if (!url) return;
        // A scheme-less "example.com" would become a RELATIVE href under
        // /articles/<slug>; keep schemes, site-relative paths and anchors as typed.
        const u = url.trim();
        const href = /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u) ? u : `https://${u}`;
        return applyEdit(wrapSelection(body, sel, "[", `](${href})`, "link text"));
      }
      case "youtube": {
        const url = window.prompt("YouTube URL");
        if (!url) return;
        if (!youtubeId(url)) return fail("That doesn't look like a YouTube URL");
        return applyEdit(insertBlock(body, sel, url.trim()));
      }
      case "card":
        return setCardPicker({ open: true, query: body.slice(sel.start, sel.end).trim(), from: sel.start, to: sel.end });
      case "deck":
        return setDeckPickerOpen(true);
      case "image":
        return imageInput.current?.click();
      case "audio":
        return audioInput.current?.click();
    }
  };

  const refocusBody = () => {
    requestAnimationFrame(() => bodyRef.current?.focus());
  };

  const onPickCard = (name: string) => {
    const { from, to } = cardPicker;
    const text = `[[${name}]]`;
    const caret = from + text.length;
    setCardPicker((p) => ({ ...p, open: false }));
    applyEdit({ value: body.slice(0, from) + text + body.slice(to), selectionStart: caret, selectionEnd: caret });
  };

  const onPickDeck = (url: string) => {
    setDeckPickerOpen(false);
    applyEdit(insertBlock(body, selection(), url));
  };

  const onPickMedia = async (kind: UploadKind, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    let postId: string;
    try {
      const draft = await ensureId();
      if (!draft) return;
      postId = draft.id;
    } catch {
      fail("Something went wrong. Check your connection and try again.");
      return;
    }
    const seq = ++uploadSeq.current;
    const placeholder = kind === "image" ? `![Uploading ${file.name} ${seq}…]()` : `[Uploading ${file.name} ${seq}…]()`;
    setBody((b) => insertBlock(b, selection(), placeholder).value);
    editVersion.current += 1;
    setDirty(true);
    setUploadCount((n) => n + 1);
    try {
      const { url } = await uploadPostMedia(postId, file, kind);
      const label = file.name.replace(/\.[^.]+$/, "");
      const md = kind === "image" ? `![${label}](${url})` : `[${label}](${url})`;
      setBody((b) => replaceOnce(b, placeholder, md));
      editVersion.current += 1;
    } catch (e) {
      setBody((b) => replaceOnce(b, placeholder, ""));
      editVersion.current += 1;
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadCount((n) => n - 1);
    }
  };

  const onPickCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    let postId: string;
    try {
      const draft = await ensureId();
      if (!draft) return;
      postId = draft.id;
    } catch {
      fail("Something went wrong. Check your connection and try again.");
      return;
    }
    setUploadCount((n) => n + 1);
    try {
      const { url } = await uploadPostMedia(postId, file, "image");
      setCover(url);
      editVersion.current += 1;
      setDirty(true);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadCount((n) => n - 1);
    }
  };

  // `silent` is the autosave path: it reports through `autosave` instead of
  // busy/toast, so the toolbar never locks and errors don't spam toasts.
  const save = (opts: { silent?: boolean } = {}): Promise<boolean> => {
    const run = savePromiseRef.current.then(() => runSave(opts));
    savePromiseRef.current = run;
    return run;
  };

  const runSave = async (opts: { silent?: boolean } = {}): Promise<boolean> => {
    savingRef.current = true;
    if (opts.silent) setAutosave("saving");
    else setBusy("save");
    const v = editVersion.current;
    try {
      const draft = await ensureId();
      if (!draft) {
        if (opts.silent) setAutosave("error");
        failedVersion.current = v;
        return false;
      }
      // On the very first save, ensureId() may have just created the draft
      // with a server-suffixed slug (title collision) that differs from the
      // client-derived one still in state — send the server's slug instead,
      // and lock it in so a later title edit doesn't re-derive the collision.
      let patchSlug = slug;
      if (!slugTouched) {
        patchSlug = draft.slug;
        setSlug(draft.slug);
        if (draft.slug !== slug) setSlugTouched(true);
      }
      const r = await updatePostAction(draft.id, {
        title,
        slug: patchSlug,
        excerpt: excerpt || null,
        body_md: body,
        cover_image_url: cover,
        tags,
        published_at: fromDatetimeLocalValue(publishAt),
      });
      if (r.success === false) {
        if (opts.silent) setAutosave("error");
        else fail(r.error);
        failedVersion.current = v;
        return false;
      }
      // Only echo the server's tags/slug and clear dirty if nothing changed
      // while the request was in flight — otherwise we'd stomp a newer edit
      // and falsely tell the poster there's nothing left to save.
      if (editVersion.current === v) {
        setTags(r.post.tags);
        setSlug(r.post.slug);
        setDirty(false);
        setAutosave("saved");
      } else {
        setAutosave("idle");
      }
      return true;
    } catch {
      if (opts.silent) setAutosave("error");
      else fail("Something went wrong. Check your connection and try again.");
      failedVersion.current = v;
      return false;
    } finally {
      savingRef.current = false;
      if (!opts.silent) setBusy(null);
    }
  };

  // Autosave (drafts only). Every field is a dep so the fired closure is the
  // latest; `autosave` is a dep so a save that finished while the writer kept
  // typing re-arms. The title gate keeps ensureId() from creating "Untitled"
  // rows on the first keystrokes of a new post, and `!uploading` keeps an
  // "Uploading…" placeholder out of the saved body.
  useEffect(() => {
    if (status !== "draft" || !dirty || busy !== null || uploading || !title.trim()) return;
    if (failedVersion.current === editVersion.current) return;
    const t = window.setTimeout(() => {
      if (!savingRef.current) void save({ silent: true });
    }, 1500);
    return () => window.clearTimeout(t);
    // `save` is intentionally omitted: it is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, title, slug, excerpt, tags, cover, publishAt, dirty, status, busy, uploading, autosave]);

  // Last-resort fallback for unmounts this component never sees a click for
  // (e.g. browser back/forward). Not relied on for the common case below: a
  // fetch kicked off from an unmount cleanup routinely loses the race against
  // the navigation that triggered it and comes back net::ERR_ABORTED, so this
  // alone silently drops the edit far more often than it saves it.
  useEffect(
    () => () => {
      const l = latest.current;
      if (idRef.current && l.dirty && l.status === "draft") void updatePostAction(idRef.current, l.patch);
    },
    [],
  );

  // The real fix for "a nav-bar link unmounts the editor mid-debounce and the
  // edit vanishes": save BEFORE the navigation happens, not after, the same
  // way onLeave already does for "← Posts" (skipped here via
  // data-post-editor-back). Published posts keep the explicit-Update model —
  // leaving one with unsaved edits always asks instead of silently saving.
  //
  // Reads latest.current rather than calling save() directly: save() is
  // recreated every render and closes over that render's title/body/tags,
  // but this effect's own closure is fixed at mount (deps: [router]) —
  // calling the mount-time save() would ship a stale patch. It also waits
  // out any autosave already in flight (savingRef) before sending its own
  // update, so a slow earlier request can't land after this one and stomp
  // the just-added tag back out with what it captured a moment earlier.
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!latest.current.dirty) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.dataset.postEditorBack !== undefined) return;
      if (anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      e.preventDefault();
      const href = anchor.getAttribute("href")!;
      pendingHrefRef.current = href;
      if (latest.current.status === "draft" && idRef.current) {
        void (async () => {
          while (savingRef.current) await new Promise((res) => setTimeout(res, 50));
          const id = idRef.current;
          if (!id) return setConfirmLeave(true);
          const r = await updatePostAction(id, latest.current.patch).catch(() => null);
          if (r && r.success !== false) router.push(href);
          else setConfirmLeave(true);
        })();
      } else {
        setConfirmLeave(true);
      }
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const onSave = async () => {
    if (await save()) setToast({ message: status === "published" ? "Updated" : "Draft saved", type: "success" });
  };

  const onPublish = async () => {
    // save() first: it writes the field's published_at (if the poster
    // backdated it) before publishPostAction reads `current.published_at`.
    if (!(await save())) return;
    setBusy("publish");
    try {
      const r = await publishPostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setStatus("published");
      setScheduledAt(null);
      setToast({ message: "Published", type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onSchedule = async () => {
    const iso = fromDatetimeLocalValue(publishAt);
    if (!iso) return;
    if (!(await save())) return;
    setBusy("schedule");
    try {
      const r = await schedulePostAction(idRef.current!, iso);
      if (r.success === false) return fail(r.error);
      setScheduledAt(iso);
      setToast({ message: `Scheduled for ${formatScheduled(iso)}`, type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onCancelSchedule = async () => {
    setBusy("schedule");
    try {
      const r = await cancelScheduleAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setScheduledAt(null);
      setToast({ message: "Schedule canceled", type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onUnpublish = async () => {
    setBusy("unpublish");
    try {
      const r = await unpublishPostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setStatus("draft");
      setToast({ message: "Unpublished", type: "success" });
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setBusy("delete");
    try {
      const r = await deletePostAction(idRef.current!);
      if (r.success === false) return fail(r.error);
      setDirty(false);
      latest.current.dirty = false;
      router.push("/admin/posts");
    } catch {
      fail("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const locked = busy !== null || uploading;
  const willSchedule = status === "draft" && isFutureIso(fromDatetimeLocalValue(publishAt));

  // "← Posts" is a client-side navigation, which beforeunload never sees.
  // Save a draft and go; anything else (published edits, a failed save) asks.
  const onLeave = async (e: React.MouseEvent) => {
    if (!dirty || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (status === "draft" && !locked && (await save())) {
      router.push("/admin/posts");
      return;
    }
    pendingHrefRef.current = "/admin/posts";
    setConfirmLeave(true);
  };

  const saveState = uploading
    ? "Uploading…"
    : busy === "save" || autosave === "saving"
      ? "Saving\u2026"
      : autosave === "error"
        ? "Save failed"
        : dirty
          ? "Unsaved"
          : autosave === "saved"
            ? "Saved"
            : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 xl:max-w-[1400px]">
      {/* Sticky under the z-50 h-16 TopNav so Save/Publish stay reachable while
          writing on a phone; dialogs (z-50, portaled) and the toast still win. */}
      <div className="sticky top-16 z-40 -mx-4 mb-4 flex items-center justify-between gap-2 bg-background/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/posts"
            onClick={onLeave}
            data-post-editor-back
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
          >
            ← Posts
          </Link>
          <span
            className={`hidden rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider sm:inline-flex ${
              status === "published"
                ? "bg-primary/15 text-primary"
                : scheduledAt
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {status === "published" ? "published" : scheduledAt ? "scheduled" : "draft"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className={`text-xs ${saveState === "Save failed" ? "text-destructive" : "text-muted-foreground"}`}>
            {saveState}
          </span>
          {status === "published" && (
            <Button asChild variant="outline" className="min-h-11 px-3 sm:px-4">
              <a href={`/articles/${slug}`} target="_blank" rel="noreferrer">
                View
              </a>
            </Button>
          )}
          <Button variant="outline" className="min-h-11 px-3 sm:px-4" onClick={onSave} disabled={locked}>
            {busy === "save" ? "Saving\u2026" : status === "published" ? "Update" : "Save draft"}
          </Button>
          {status === "draft" ? (
            <Button className="min-h-11 px-3 sm:px-4" onClick={willSchedule ? onSchedule : onPublish} disabled={locked}>
              {busy === "publish"
                ? "Publishing\u2026"
                : busy === "schedule"
                  ? "Scheduling\u2026"
                  : willSchedule
                    ? "Schedule"
                    : "Publish"}
            </Button>
          ) : (
            <Button variant="outline" className="min-h-11 px-3 sm:px-4" onClick={onUnpublish} disabled={locked}>
              {busy === "unpublish" ? "Unpublishing\u2026" : "Unpublish"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div>
            <Input
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder="Title"
              maxLength={MAX_TITLE}
              aria-label="Title"
              className="h-12 text-lg font-semibold"
            />
            {title.length >= MAX_TITLE - 20 && (
              <span className="mt-1 block text-right text-xs text-muted-foreground">
                {title.length}/{MAX_TITLE}
              </span>
            )}
          </div>

          <div className="rounded-md bg-card">
            <div role="tablist" aria-label="Editor view" className="m-2 inline-flex rounded-md bg-muted/40 p-0.5 lg:hidden">
              {(["write", "preview"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`min-h-11 rounded px-4 text-sm capitalize ${
                    tab === t ? "bg-background font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="grid lg:grid-cols-2">
              {/* min-w-0: the toolbar's one-row min-content width must scroll inside the pane, not widen the page. */}
              <div className={`min-w-0 ${tab === "write" ? "" : "hidden lg:block"}`}>
                <MarkdownToolbar onAction={onToolbar} disabled={locked} />
                {/* Always in view on desktop so nobody has to find a tooltip; phones
                    get the same two moves from the placeholder and the preview tip. */}
                <p className="hidden bg-muted/40 px-3 py-1 text-xs text-muted-foreground lg:block">
                  Type <kbd className="rounded bg-background px-1 font-mono text-[11px] text-foreground">[[</kbd> to mention
                  a card {"\u00b7"} a deck link on its own line embeds it
                </p>
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBody(v);
                    editVersion.current += 1;
                    setDirty(true);
                    // Typing "[[" opens the card picker; the pick replaces the brackets.
                    const caret = e.target.selectionStart;
                    if (opensCardPicker(v, caret, (e.nativeEvent as InputEvent).inputType)) {
                      setCardPicker({ open: true, query: "", from: caret - 2, to: caret });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    const mod = e.metaKey || e.ctrlKey;
                    if (mod && !e.altKey && !e.shiftKey) {
                      const k = e.key.toLowerCase();
                      const action = k === "b" ? "bold" : k === "i" ? "italic" : k === "k" ? "link" : null;
                      if (action) {
                        e.preventDefault();
                        if (!locked) onToolbar(action);
                      } else if (k === "s") {
                        e.preventDefault();
                        if (!locked) void onSave();
                      }
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      const r = continueList(body, selection());
                      if (r) {
                        e.preventDefault();
                        applyEdit(r);
                      }
                    }
                  }}
                  // Files only; plain text paste/drop keeps the browser default.
                  onPaste={(e) => {
                    const f = e.clipboardData.files;
                    if (f.length) {
                      e.preventDefault();
                      void onPickMedia("image", f);
                    }
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    const f = e.dataTransfer.files;
                    if (f.length) {
                      e.preventDefault();
                      void onPickMedia("image", f);
                    }
                  }}
                  placeholder="Write in markdown… Type [[ to mention a card. A deck link on its own line embeds the deck."
                  aria-label="Body"
                  spellCheck
                  className="min-h-[50vh] w-full resize-y bg-transparent p-3 font-mono text-base leading-relaxed outline-none lg:min-h-[70vh] lg:text-sm"
                />
              </div>
              <div className={`${tab === "preview" ? "" : "hidden lg:block"} rounded-b-md bg-muted/20 p-4 lg:rounded-r-md`}>
                {body.trim() ? (
                  <ArticleBody markdown={body} refs={refs} draft />
                ) : (
                  <p className="flex min-h-[40vh] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                    Nothing to preview yet. Card mentions show the card on hover; a deck link on its own line becomes the
                    deck.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* content-start: at xl the aside shares a grid row with the editor, whose
            preview can be thousands of px tall for a long article; without it the
            grid's default align-content:stretch spreads the five fields over that
            whole height. */}
        <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <label className={LABEL}>
            Slug
            <Input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
                editVersion.current += 1;
                setDirty(true);
              }}
              disabled={status === "published"}
              className="mt-1 h-12 font-mono text-sm normal-case tracking-normal"
            />
            {status === "published" && <span className="mt-1 block normal-case tracking-normal">Locked after publishing</span>}
          </label>

          <label className={LABEL}>
            Publish date
            <Input
              type="datetime-local"
              value={publishAt}
              onChange={(e) => {
                setPublishAt(e.target.value);
                editVersion.current += 1;
                setDirty(true);
              }}
              disabled={locked}
              className="mt-1 h-12 text-sm normal-case tracking-normal"
            />
            <span className="mt-1 block normal-case tracking-normal">
              {willSchedule
                ? "A future date — publishes automatically at this time."
                : status === "published"
                  ? "Shown as this post's publish date."
                  : "Leave blank to use today. A past date backdates the post."}
            </span>
            {scheduledAt && (
              <button
                type="button"
                onClick={onCancelSchedule}
                disabled={locked}
                className="mt-1 text-xs normal-case tracking-normal text-muted-foreground underline hover:text-foreground"
              >
                Cancel schedule
              </button>
            )}
          </label>

          <div>
            <span className={LABEL}>Tags</span>
            <div className="mt-1">
              <TagInput
                value={tags}
                onChange={(t) => {
                  setTags(t);
                  editVersion.current += 1;
                  setDirty(true);
                }}
                suggestions={suggestions}
                disabled={locked}
              />
            </div>
          </div>

          <div>
            <span className={LABEL}>Cover image</span>
            {/* Focusable so a click-then-paste can replace or set the cover
                without opening the file picker; drop works the same as the
                body textarea's image drop. */}
            <div
              tabIndex={0}
              aria-label="Cover image drop zone. Click, then paste or drop an image."
              onPaste={(e) => {
                const f = e.clipboardData.files;
                if (f.length) {
                  e.preventDefault();
                  void onPickCover(f);
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                const f = e.dataTransfer.files;
                if (f.length) {
                  e.preventDefault();
                  void onPickCover(f);
                }
              }}
              className="mt-1 rounded-md outline-none"
            >
              {cover ? (
                <div className="space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover} alt="" className="w-full rounded-md object-cover" style={{ aspectRatio: "16 / 9" }} />
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setCover(null);
                      editVersion.current += 1;
                      setDirty(true);
                    }}
                    disabled={locked}
                  >
                    Remove cover
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="min-h-11" onClick={() => coverInput.current?.click()} disabled={locked}>
                  Upload cover
                </Button>
              )}
              <p className="mt-1 normal-case tracking-normal text-[11px] text-muted-foreground">
                Click here, then paste (⌘V) or drop an image
              </p>
            </div>
          </div>

          <label className={LABEL}>
            Excerpt ({excerpt.length}/{MAX_EXCERPT})
            <textarea
              value={excerpt}
              onChange={(e) => {
                setExcerpt(e.target.value);
                editVersion.current += 1;
                setDirty(true);
              }}
              maxLength={MAX_EXCERPT}
              rows={4}
              placeholder="Optional. Shown on article cards, in the feed and in link previews."
              className="mt-1 w-full rounded-md bg-muted/40 p-2 text-sm normal-case tracking-normal text-foreground outline-none"
            />
            {!excerpt.trim() && body.trim() !== "" && (
              <span className="mt-1 line-clamp-2 text-xs normal-case tracking-normal text-muted-foreground">
                Readers will see: {excerptFromMarkdown(body)}
              </span>
            )}
          </label>

          {id && (
            <Button
              variant="ghost"
              className="min-h-11 justify-self-start text-muted-foreground hover:text-destructive sm:col-span-2 xl:col-span-1"
              onClick={() => setConfirmDelete(true)}
              disabled={locked}
            >
              Delete
            </Button>
          )}
        </aside>
      </div>

      <input
        ref={imageInput}
        type="file"
        accept={ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          void onPickMedia("image", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept={ACCEPT.audio}
        className="hidden"
        onChange={(e) => {
          void onPickMedia("audio", e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={coverInput}
        type="file"
        accept={ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          void onPickCover(e.target.files);
          e.target.value = "";
        }}
      />

      <CardPicker
        open={cardPicker.open}
        initialQuery={cardPicker.query}
        search={searchCards}
        onPick={onPickCard}
        onClose={() => {
          setCardPicker((p) => ({ ...p, open: false }));
          refocusBody();
        }}
      />
      <DeckPicker
        open={deckPickerOpen}
        onPick={onPickDeck}
        onClose={() => {
          setDeckPickerOpen(false);
          refocusBody();
        }}
      />
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={onDelete}
        title="Delete this post?"
        description="This removes the post and its uploaded media. It cannot be undone."
        confirmLabel="Delete"
      />
      <ConfirmationDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        variant="warning"
        title="Leave without saving?"
        description="Unsaved changes will be lost."
        confirmLabel="Leave"
        onConfirm={() => {
          setDirty(false);
          latest.current.dirty = false;
          router.push(pendingHrefRef.current);
        }}
      />
      <ToastNotification
        show={toast !== null}
        message={toast?.message ?? ""}
        type={toast?.type}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
