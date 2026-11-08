"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { cn } from "@/lib/utils";
import { coerceFieldValue, displayValue, FIELD_LABELS, SUGGESTABLE_FIELDS } from "@/app/forge/lib/cardDiff";
import type { DesignCard } from "@/app/forge/lib/designCard";
import {
  addComment,
  resolveComment,
  applySuggestion,
  deleteComment,
  type CommentRow,
} from "@/app/forge/lib/comments";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import {
  appliedSuggestionNote,
  buildCommentEras,
  olderCommentsLabel,
  splitCommentEras,
  type AppliedSuggestion,
  type CommentEraItem,
} from "@/app/forge/lib/historyView";
import { useLocalStorageFlag } from "@/app/forge/lib/useLocalStorageFlag";
import { initials } from "./PresenceBar";
import { useStudioDraft, useStudioSync } from "./StudioSyncContext";

// Matches the pill in the set-level feed (SetCommentsFeed) — one pill style, not two.
const pillClass = "rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground";
const linkButtonClass = "text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50";

// Sentinel busy key for the new-comment composer, which has no comment id yet.
const COMPOSE = "__compose__";

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function OldToNew({ before, after }: { before: string | null; after: string }) {
  return (
    <>
      {before === null ? (
        <span className="font-normal text-muted-foreground">Not set</span>
      ) : (
        <span className="font-normal line-through decoration-rose-500 decoration-2">{before}</span>
      )}
      <span aria-hidden="true"> → </span>
      {after}
    </>
  );
}

// Old and new before Apply, from the editor's live draft, which is what Apply's flush sends.
// Its own component so that only this re-renders per keystroke, and only while a suggestion
// is still open.
function OpenSuggestionValue({ c, savedDraft }: { c: CommentRow; savedDraft: DesignCard }) {
  const draft = useStudioDraft() ?? savedDraft;
  const current = displayValue(draft[c.field as keyof DesignCard]);
  const suggested = displayValue(c.suggestedValue);
  if (suggested === null) return <span className="font-normal text-muted-foreground">no value given</span>;
  if (current === suggested) {
    return <>{suggested}<span className="font-normal text-muted-foreground"> · already in the draft</span></>;
  }
  return <OldToNew before={current} after={suggested} />;
}

// Module scope, NOT nested in the parent's render body. As a nested arrow function its
// element type changed identity every render, so React unmounted and remounted every
// comment on the card on each keystroke — which put the caret at the end of the reply box
// after every character typed.
function Comment({
  c,
  isReply,
  showApply,
  applied,
  savedDraft,
  busy,
  replyOpen,
  replyDraft,
  onToggleReply,
  onReplyDraft,
  onSendReply,
  onResolve,
  onApply,
  onDelete,
}: {
  c: CommentRow;
  isReply?: boolean;
  showApply: boolean;
  applied?: AppliedSuggestion;
  savedDraft: DesignCard;
  busy: boolean;
  replyOpen: boolean;
  replyDraft: string;
  onToggleReply: () => void;
  onReplyDraft: (v: string) => void;
  onSendReply: () => void;
  onResolve: () => void;
  onApply: () => void;
  onDelete: () => void;
}) {
  const author = c.authorName ?? "Forge member";
  const fieldLabel = c.field ? FIELD_LABELS[c.field] ?? c.field : null;
  return (
    <div className={cn("flex items-start gap-2.5 text-sm", isReply && "border-l pl-3")}>
      <span
        aria-hidden="true"
        title={author}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
      >
        {initials(c.authorName)}
      </span>
      <div className={cn("min-w-0 flex-1", c.resolved && !applied && "opacity-60")}>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{author}</span>
          <span aria-hidden="true">·</span>
          {timeAgo(c.createdAt)}
          {c.resolved && <span className={pillClass}>{applied ? "Applied" : "Resolved"}</span>}
        </p>

        <p className="mt-1 whitespace-pre-wrap leading-relaxed">{c.body}</p>

        {/* After the body: the comment is the argument, the suggestion is the concrete
            upshot and the action on it. It used to be a 12px footnote with Apply sitting
            in the same row as Delete. */}
        {fieldLabel && (
          <div className="mt-2 rounded-md border bg-muted px-2.5 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Suggested {fieldLabel}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words font-medium">
                {applied ? (
                  <OldToNew before={applied.change.before} after={applied.change.after as string} />
                ) : c.resolved ? (
                  valueText(c.suggestedValue) || <span className="font-normal text-muted-foreground">no value given</span>
                ) : (
                  <OpenSuggestionValue c={c} savedDraft={savedDraft} />
                )}
              </span>
              {showApply && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2.5 text-xs"
                  disabled={busy}
                  onClick={onApply}
                  aria-label={`Apply ${author}'s suggested ${fieldLabel}`}
                >
                  Apply
                </Button>
              )}
            </div>
            {applied && <p className="mt-1 text-xs text-muted-foreground">{appliedSuggestionNote(applied)}</p>}
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
          {!isReply && (
            <button type="button" onClick={onToggleReply} className={linkButtonClass} aria-label={`Reply to ${author}`}>
              {replyOpen ? "Cancel reply" : "Reply"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onResolve}
            className={linkButtonClass}
            aria-label={`${c.resolved ? "Unresolve" : "Resolve"} ${author}'s comment`}
          >
            {c.resolved ? "Unresolve" : "Resolve"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="ml-auto text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            aria-label={`Delete ${author}'s comment`}
          >
            Delete
          </button>
        </div>

        {replyOpen && (
          <div className="mt-2 space-y-1.5">
            {/* A textarea, not an input — replies here are sentences. Safe only because
                Comment is no longer remounted on every keystroke. */}
            <textarea
              autoFocus
              rows={2}
              value={replyDraft}
              onChange={(e) => onReplyDraft(e.target.value)}
              placeholder="Reply…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={busy || !replyDraft.trim()}
              onClick={onSendReply}
            >
              Send
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommentThread({
  cardId,
  comments,
  canApply,
  versions = [],
  applied,
  savedDraft,
}: {
  cardId: string;
  comments: CommentRow[];
  canApply: boolean;
  versions?: { versionNumber: number; createdAt: string; status: "draft" | "published" | "approved" | "superseded" }[];
  applied: Map<string, AppliedSuggestion>;
  savedDraft: DesignCard;
}) {
  const router = useRouter();
  const { flushPending } = useStudioSync();
  const [body, setBody] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Keyed by comment id: a single shared draft moved your half-typed reply to whichever
  // comment you opened next.
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  // Per-comment, so resolving one comment doesn't disable every button in the thread for
  // the length of a full RSC refresh.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CommentRow | null>(null);
  const [showOlder, setShowOlder] = useLocalStorageFlag(`forge:card:${cardId}:comments-expanded`);

  const run = async (
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void
  ) => {
    setErr(null);
    setBusyId(id);
    try {
      const r = await fn();
      if (r.ok === false) {
        setErr(r.error ?? "Action failed");
        return;
      }
      after?.();
      router.refresh();
    } catch (e) {
      // A thrown action used to surface as an unhandled rejection with no feedback at all.
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  // Card-level thread only (proposal-anchored comments live under their proposal).
  const cardComments = comments.filter((c) => c.proposalId === null);
  const top = cardComments.filter((c) => c.parentId === null);
  const repliesOf = (id: string) => cardComments.filter((c) => c.parentId === id);
  const currentVersionNumber = versions.length
    ? Math.max(...versions.map((v) => v.versionNumber))
    : null;

  const submitTop = () =>
    run(
      COMPOSE,
      () =>
        addComment({
          cardId,
          body,
          field: field || null,
          suggestedValue: field && value.trim() ? coerceFieldValue(field, value) : undefined,
        }),
      () => {
        setBody("");
        setField("");
        setValue("");
        setComposing(false);
      }
    );

  const commentProps = (c: CommentRow, isReply?: boolean) => ({
    c,
    isReply,
    showApply: !!c.field && c.suggestedValue != null && canApply && !c.resolved,
    applied: applied.get(c.id),
    savedDraft,
    busy: busyId === c.id,
    replyOpen: replyTo === c.id,
    replyDraft: replyDrafts[c.id] ?? "",
    onToggleReply: () => setReplyTo(replyTo === c.id ? null : c.id),
    onReplyDraft: (v: string) => setReplyDrafts((d) => ({ ...d, [c.id]: v })),
    onSendReply: () =>
      run(c.id, () => addComment({ cardId, parentId: c.id, body: replyDrafts[c.id] ?? "" }), () => {
        setReplyDrafts((d) => ({ ...d, [c.id]: "" }));
        setReplyTo(null);
      }),
    onResolve: () => run(c.id, () => resolveComment(c.id, cardId, !c.resolved)),
    onApply: () =>
      run(c.id, async () => {
        // Flush first: forge_apply_suggestion builds the new snapshot from the server's
        // copy, so a pending autosave landing afterwards would silently undo it. A failed
        // flush leaves that copy stale, so applying would drop the suggestion outright.
        const flushed = await flushPending();
        if (flushed.ok === false) return { ok: false, error: "Couldn’t save your latest edits — nothing was applied." };
        return applySuggestion(c.id, cardId);
      }),
    onDelete: () => setConfirmDelete(c),
  });

  const renderItem = (item: CommentEraItem) =>
    item.kind === "era" ? (
      <div
        key={`era-${item.versionNumber}`}
        className="flex items-center gap-2 text-[11px] text-muted-foreground"
        aria-hidden
      >
        <span className="h-px flex-1 bg-border" />
        v{item.versionNumber} {item.status === "draft" ? "updated" : "released"} ·{" "}
        {new Date(item.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        <span className="h-px flex-1 bg-border" />
      </div>
    ) : (
      <div key={item.comment.id} className="space-y-2">
        <Comment {...commentProps(item.comment)} />
        {repliesOf(item.comment.id).map((r) => (
          <Comment key={r.id} {...commentProps(r, true)} />
        ))}
      </div>
    );

  const eraItems = buildCommentEras(top, versions);
  const { shown, hiddenCommentCount } = splitCommentEras(eraItems, currentVersionNumber, repliesOf);

  return (
    <div className="space-y-4">
      {err && (
        <p role="status" aria-live="polite" className="text-sm text-destructive">
          {err}
        </p>
      )}

      {/* Thread first. The composer used to sit above it, so after a long scroll the
          discussion led with an empty textarea and "No comments yet." underneath it. */}
      {top.length === 0 ? (
        <p className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No comments yet — start the discussion.
        </p>
      ) : (
        <div className="space-y-4">
          {hiddenCommentCount > 0 && (
            <button
              type="button"
              aria-expanded={showOlder}
              onClick={() => setShowOlder(!showOlder)}
              className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground"
            >
              {olderCommentsLabel(showOlder, hiddenCommentCount)}
            </button>
          )}
          {(showOlder ? eraItems : shown).map(renderItem)}
        </div>
      )}

      {composing ? (
        <div className="space-y-2 rounded-md border p-2">
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Comment, or attach a field suggestion below…"
            className="h-20 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={field}
              onChange={(e) => setField(e.target.value)}
              aria-label="Attach a field suggestion"
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="">No field</option>
              {SUGGESTABLE_FIELDS.map((f) => (
                <option key={f as string} value={f as string}>
                  {FIELD_LABELS[f as string]}
                </option>
              ))}
            </select>
            {field && (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Suggested value (comma-separate lists)"
                aria-label="Suggested value"
                className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1"
              />
            )}
            <Button
              size="sm"
              className="ml-auto"
              disabled={busyId === COMPOSE || !body.trim()}
              onClick={submitTop}
            >
              Post
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        // Cancel keeps `body`, so an accidental collapse never loses what you typed —
        // the label says so when there is something to come back to.
        <Button variant="outline" size="sm" onClick={() => setComposing(true)}>
          {body.trim() ? "Continue your draft" : "Add a comment"}
        </Button>
      )}

      <ConfirmationDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        onConfirm={() => {
          const c = confirmDelete;
          setConfirmDelete(null);
          if (c) void run(c.id, () => deleteComment(c.id, cardId));
        }}
        variant="destructive"
        title="Delete this comment?"
        description="The comment and any replies to it are removed for everyone. This can't be undone."
        confirmLabel="Delete comment"
      />
    </div>
  );
}
