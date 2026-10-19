"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Copies the card face to the clipboard as a PNG, so it pastes straight into Discord, a doc
// or a chat. `src` is the uploaded finished card or the server's render of the live draft
// (kind=rendered&v=working); either is re-encoded through a canvas because the clipboard
// takes image/png only.
//
// Safari grants the clipboard only inside the click's gesture and only to a ClipboardItem
// built synchronously — so the item is created first and handed a promise for the bytes
// (the WebKit-documented pattern), and every await happens inside that promise.

type Phase = "idle" | "busy" | "done" | "failed";

const LABEL: Record<Phase, string> = {
  idle: "Copy card image",
  busy: "Copying…",
  done: "Copied",
  failed: "Copy failed",
};

export default function CopyCardImageButton({
  src, prepare, onError, className,
}: {
  src: string;
  /** Runs before the image is fetched — the studio flushes its pending autosave here. */
  prepare?: () => Promise<unknown>;
  onError?: (message: string) => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const settle = (next: Phase) => {
    setPhase(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPhase("idle"), 2000);
  };

  const onClick = () => {
    if (phase === "busy") return;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      onError?.("This browser can't copy images to the clipboard.");
      settle("failed");
      return;
    }
    setPhase("busy");
    const png = (async () => {
      await prepare?.();
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
      return toPng(await res.blob());
    })();
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .then(() => settle("done"))
      .catch(() => {
        onError?.("Couldn't copy the card image.");
        settle("failed");
      });
  };

  const Icon = phase === "busy" ? Loader2 : phase === "done" ? Check : phase === "failed" ? X : Copy;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={LABEL[phase]}
      title={LABEL[phase]}
      disabled={phase === "busy"}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full border bg-background/70 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground disabled:cursor-wait",
        phase === "done" && "text-primary",
        phase === "failed" && "text-destructive",
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", phase === "busy" && "animate-spin")} aria-hidden="true" />
      <span role="status" aria-live="polite" className="sr-only">
        {phase === "done" ? "Card image copied" : phase === "failed" ? "Copy failed" : ""}
      </span>
    </button>
  );
}

/** Re-encode any browser-decodable image as PNG (same-origin, so the canvas stays untainted). */
async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
