"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "../../../../components/ui/dialog";
import { DeckVisibility } from "../types/deck";

type ShareKind = "deck" | "folder";

const OPTIONS: {
  value: DeckVisibility;
  label: string;
  description: (kind: ShareKind) => string;
  icon: React.ReactNode;
}[] = [
  {
    value: "private",
    label: "Private",
    description: (kind) => `Only you can see this ${kind}.`,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    value: "unlisted",
    label: "Unlisted",
    description: () => "Anyone with the link can view. Hidden from community search.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
  {
    value: "public",
    label: "Public",
    description: () => "Viewable by anyone and listed in community search.",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

interface ShareDeckModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId: string;
  deckName?: string;
  /** Current visibility (controlled by the parent). */
  visibility: DeckVisibility;
  /**
   * Apply a new visibility. The parent owns the server action, local-state
   * sync, and any "needs username" flow. The modal re-renders when the parent
   * updates the `visibility` prop.
   */
  onSetVisibility: (visibility: DeckVisibility) => void | Promise<void>;
  /** Defaults to "deck". A folder links to /decklist/folders/<id>. */
  kind?: ShareKind;
  /** Extra content under the options (e.g. a folder's private-deck notice). */
  children?: React.ReactNode;
}

/**
 * Focused dialog for choosing a deck's visibility and copying its share link.
 * Used by the deck builder and the My Decks list so sharing lives in one place
 * instead of cluttering the overflow menu.
 */
export default function ShareDeckModal({
  open,
  onOpenChange,
  deckId,
  deckName,
  visibility,
  onSetVisibility,
  kind = "deck",
  children,
}: ShareDeckModalProps) {
  const [pending, setPending] = useState<DeckVisibility | null>(null);
  const [copied, setCopied] = useState(false);

  const sharePath = kind === "folder" ? `/decklist/folders/${deckId}` : `/decklist/${deckId}`;
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}${sharePath}` : "";
  const isShared = visibility === "unlisted" || visibility === "public";

  async function select(v: DeckVisibility) {
    if (v === visibility) return;
    setPending(v);
    try {
      await onSetVisibility(v);
      // Switching to a shared state mints a link — drop it straight onto the
      // clipboard so the user can paste it immediately, with a confirmation.
      if (v === "unlisted" || v === "public") copyLink();
    } finally {
      setPending(null);
    }
  }

  function copyLink() {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share {kind}</DialogTitle>
          <DialogDescription>
            {deckName ? `Choose who can see "${deckName}".` : `Choose who can see this ${kind}.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-2">
          {OPTIONS.map((opt) => {
            const active = visibility === opt.value;
            const loading = pending === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => select(opt.value)}
                disabled={pending !== null}
                aria-pressed={active}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <span className={`mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {opt.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.description(kind)}</span>
                </span>
                {loading ? (
                  <svg className="w-5 h-5 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                ) : active ? (
                  <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}

          {isShared ? (
            <div className="pt-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Share link</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground"
                />
                <button
                  onClick={copyLink}
                  className="flex-shrink-0 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              {copied ? (
                <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-500">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Link copied to your clipboard
                </p>
              ) : null}
              <a
                href={sharePath}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Open {kind} page
              </a>
            </div>
          ) : (
            <p className="pt-2 text-sm text-muted-foreground">
              This {kind} is private. Switch to Unlisted or Public to get a shareable link.
            </p>
          )}

          {children}
        </DialogBody>

        <DialogFooter className="justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
