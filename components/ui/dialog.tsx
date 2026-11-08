"use client";

import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Dialog (root overlay)                                              */
/* ------------------------------------------------------------------ */

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  "aria-labelledby"?: string;
}

function Dialog({ open, onOpenChange, children, "aria-labelledby": labelledBy }: DialogProps) {
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  // ESC key dismissal
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Portal to <body>: an ancestor with transform/filter/backdrop-filter (e.g.
  // the pregame panel's backdrop-blur) becomes the containing block for fixed
  // descendants, which would confine the overlay to that ancestor's box —
  // clicks outside it never reach the overlay, so outside-click dismissal
  // silently breaks. Rendering from <body> keeps inset-0 viewport-sized.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {children}
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/*  DialogContent (the modal box — stops propagation)                  */
/* ------------------------------------------------------------------ */

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

function DialogContent({
  size = "sm",
  className,
  children,
  ...props
}: DialogContentProps) {
  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  };

  return (
    <div
      className={cn(
        "bg-[hsl(var(--dialog-bg))] border border-[hsl(var(--dialog-border))] rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/5 w-full mx-4 overflow-hidden",
        // Never exceed the viewport — cap height and let the body scroll so the
        // header/footer stay pinned and tall modals are fully usable on mobile.
        "flex flex-col max-h-[calc(100dvh-2rem)]",
        sizeClasses[size],
        className
      )}
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogHeader                                                       */
/* ------------------------------------------------------------------ */

function DialogHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 bg-[hsl(var(--dialog-header-bg))] border-b border-[hsl(var(--dialog-border))] px-6 py-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogTitle                                                        */
/* ------------------------------------------------------------------ */

function DialogTitle({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogDescription                                                  */
/* ------------------------------------------------------------------ */

function DialogDescription({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-muted-foreground mt-1", className)}
      {...props}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogBody                                                         */
/* ------------------------------------------------------------------ */

function DialogBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-h-0 overflow-y-auto px-6 py-4", className)} {...props}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogFooter                                                       */
/* ------------------------------------------------------------------ */

function DialogFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-[hsl(var(--dialog-border))] px-6 py-4 flex gap-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
};
