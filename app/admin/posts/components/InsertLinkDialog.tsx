"use client";

import { useState, type KeyboardEvent } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { youtubeId } from "@/app/articles/lib/markdown";

// The link and YouTube toolbar actions. Replaces window.prompt: a link gets a
// text field (prefilled with the selection), a YouTube URL is validated
// inline so a bad paste stays in the field instead of closing the prompt.
// Insertion is the caller's: it has the selection the dialog was opened on.

const LABEL = "block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";
const FIELD = "mt-1 h-11 w-full rounded-md bg-muted/40 px-3 text-base text-foreground outline-none placeholder:text-muted-foreground";

export default function InsertLinkDialog({
  open,
  mode,
  initialText,
  onInsert,
  onClose,
}: {
  open: boolean;
  mode: "link" | "youtube";
  /** The body selection when the dialog opened; prefills the link text. */
  initialText: string;
  onInsert: (r: { href: string; text: string }) => void;
  onClose: () => void;
}) {
  const [href, setHref] = useState("");
  const [text, setText] = useState(initialText);

  // Reset on the render that opens the dialog (see CardPicker).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setHref("");
      setText(initialText);
    }
  }

  const youtube = mode === "youtube";
  const url = href.trim();
  const badYoutube = youtube && url !== "" && youtubeId(url) === null;
  const canInsert = youtube ? youtubeId(url) !== null : url !== "";

  const submit = () => {
    if (canInsert) onInsert({ href: url, text });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{youtube ? "Embed YouTube video" : "Insert link"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <label className={LABEL} htmlFor="insert-link-url">
              URL
            </label>
            <input
              id="insert-link-url"
              autoFocus
              type="url"
              inputMode="url"
              autoComplete="off"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={youtube ? "https://youtu.be/…" : "https://…"}
              className={FIELD}
            />
            {badYoutube && <p className="mt-1 text-xs text-destructive">That doesn&apos;t look like a YouTube link.</p>}
          </div>
          {!youtube && (
            <div>
              <label className={LABEL} htmlFor="insert-link-text">
                Text
              </label>
              <input
                id="insert-link-text"
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="link text"
                className={FIELD}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="min-h-11" onClick={submit} disabled={!canInsert}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
