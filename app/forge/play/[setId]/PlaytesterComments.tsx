"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addComment, deleteComment, listCardComments, type CommentRow } from "@/app/forge/lib/comments";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import { withDeadline } from "@/app/forge/lib/withDeadline";

const FAILED = "Couldn’t do that. Check your connection and try again.";

export default function PlaytesterComments({
  cardId,
  currentUserId,
}: {
  cardId: string;
  currentUserId: string;
}) {
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [pending, start] = useTransition();
  const [posting, setPosting] = useState(false);

  const load = () => listCardComments(cardId).then(setComments);
  // Reload whenever the open card changes.
  useEffect(() => {
    setComments(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await withDeadline(fn(), { ok: false, error: FAILED });
      if (!r.ok) {
        alert(r.error ?? FAILED);
      } else {
        // Reload first: clearing the box before the list has the comment left "No comments
        // yet" on screen with your text gone, which looks like it was thrown away.
        await withDeadline(load(), undefined);
        after?.();
      }
      setPosting(false);
    });

  const roots = (comments ?? []).filter((c) => c.parentId === null);
  const repliesOf = (id: string) => (comments ?? []).filter((c) => c.parentId === id);

  const Comment = ({ c, isReply }: { c: CommentRow; isReply?: boolean }) => (
    <div className={`rounded-md border p-2 text-sm ${isReply ? "ml-4" : ""}`}>
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.authorName ?? "Forge member"}</span>
        {" · "}
        {timeAgo(c.createdAt)}
      </p>
      <p className="whitespace-pre-wrap">{c.body}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {!isReply && (
          <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="hover:underline">
            Reply
          </button>
        )}
        {c.createdBy === currentUserId && (
          <button
            disabled={pending}
            onClick={() => confirm("Delete this comment?") && run(() => deleteComment(c.id, cardId))}
            className="text-destructive hover:underline"
          >
            Delete
          </button>
        )}
      </div>
      {replyTo === c.id && (
        <div className="mt-2 flex items-center gap-1">
          <input
            autoFocus
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Reply…"
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !replyBody.trim()}
            onClick={() =>
              run(
                () => addComment({ cardId, parentId: c.id, body: replyBody }),
                () => {
                  setReplyBody("");
                  setReplyTo(null);
                }
              )
            }
          >
            Send
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border p-2">
        <textarea
          value={body}
          disabled={posting}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment for the designers…"
          className="h-16 w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          className="ml-auto flex"
          disabled={pending || !body.trim()}
          onClick={() => {
            setPosting(true);
            run(() => addComment({ cardId, body }), () => setBody(""));
          }}
        >
          {posting ? "Posting…" : "Post"}
        </Button>
      </div>

      {comments === null ? (
        <p className="text-xs text-muted-foreground">Loading comments…</p>
      ) : roots.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comments yet. Be the first.</p>
      ) : (
        roots.map((c) => (
          <div key={c.id} className="space-y-2">
            <Comment c={c} />
            {repliesOf(c.id).map((r) => (
              <Comment key={r.id} c={r} isReply />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
