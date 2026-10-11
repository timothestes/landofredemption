"use client";

import { Fragment } from "react";
import { Bold, Italic, Heading2, Quote, List, Link2, Image as ImageIcon, Youtube, Music, WalletCards, Layers } from "lucide-react";

export type ToolbarAction =
  | "bold"
  | "italic"
  | "heading"
  | "quote"
  | "list"
  | "link"
  | "card"
  | "deck"
  | "image"
  | "youtube"
  | "audio";

type ToolbarButton = { action: ToolbarAction; label: string; Icon: typeof Bold; shortcut?: string };

// Three groups, each with its own icon colour so the row reads at a glance:
// text tools stay neutral, references (link, card, deck) are sky, media is
// violet. One hue per GROUP, in the status chips' muted -700 / dark:-400
// recipe so both themes keep the contrast; green stays reserved for CTAs.
// `shortcut` is the letter bound with Cmd/Ctrl in the editor's onKeyDown;
// it lands in `title` only, so the accessible name stays the bare label.
const GROUPS: { tone: string; buttons: ToolbarButton[] }[] = [
  {
    tone: "text-muted-foreground hover:bg-background hover:text-foreground",
    buttons: [
      { action: "bold", label: "Bold", Icon: Bold, shortcut: "B" },
      { action: "italic", label: "Italic", Icon: Italic, shortcut: "I" },
      { action: "heading", label: "Heading", Icon: Heading2 },
      { action: "quote", label: "Quote", Icon: Quote },
      { action: "list", label: "Bulleted list", Icon: List },
    ],
  },
  {
    tone: "text-sky-700 hover:bg-sky-500/15 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300",
    buttons: [
      { action: "link", label: "Link", Icon: Link2, shortcut: "K" },
      { action: "card", label: "Mention a card (or type [[)", Icon: WalletCards },
      { action: "deck", label: "Embed a deck", Icon: Layers },
    ],
  },
  {
    tone: "text-violet-700 hover:bg-violet-500/15 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300",
    buttons: [
      { action: "image", label: "Upload image", Icon: ImageIcon },
      { action: "youtube", label: "Embed YouTube video", Icon: Youtube },
      { action: "audio", label: "Upload audio", Icon: Music },
    ],
  },
];

export default function MarkdownToolbar({
  onAction,
  disabled,
}: {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      // 36px buttons and the two dividers fit the 448px desktop write pane on
      // one row (the 4px gap is what makes that true); touch devices keep
      // 44px targets (data-input-mode is set on <html> by useInputMode) and
      // wrap by group onto a second row instead of scrolling sideways, so
      // every button is visible. The hairline dividers hide on touch, where
      // one would land at a row edge, and the group gap widens instead.
      className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-t-md bg-muted/60 p-1 [html[data-input-mode=touch]_&]:gap-x-2"
    >
      {GROUPS.map(({ tone, buttons }, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="h-5 w-px bg-border [html[data-input-mode=touch]_&]:hidden" />}
          <div className="flex gap-0.5">
            {buttons.map(({ action, label, Icon, shortcut }) => (
              <button
                key={action}
                type="button"
                title={shortcut ? `${label} (Ctrl+${shortcut} / ⌘${shortcut})` : label}
                aria-label={label}
                disabled={disabled}
                // Keep the textarea's focus and selection when a button is clicked.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAction(action)}
                className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 outline-none disabled:opacity-50 [html[data-input-mode=touch]_&]:h-11 [html[data-input-mode=touch]_&]:min-w-11 ${tone}`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
