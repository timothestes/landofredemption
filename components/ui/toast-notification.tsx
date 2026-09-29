"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, Info } from "lucide-react";

interface ToastNotificationProps {
  message: string;
  show: boolean;
  onClose: () => void;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
}

const icons = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Info,
};

const styles = {
  success: {
    icon: "bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary",
    border: "border-primary/20 dark:border-primary/30",
  },
  error: {
    icon: "bg-destructive/15 text-destructive dark:bg-red-500/20 dark:text-red-400",
    border: "border-destructive/20 dark:border-red-500/30",
  },
  warning: {
    icon: "bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
    border: "border-amber-500/20 dark:border-amber-500/30",
  },
  info: {
    icon: "bg-foreground/10 text-foreground",
    border: "border-border",
  },
};

const ToastNotification: React.FC<ToastNotificationProps> = ({
  message,
  show,
  onClose,
  type = "success",
  duration = 3000,
}) => {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (show) {
      setExiting(false);
      // Small delay to trigger enter animation
      requestAnimationFrame(() => setVisible(true));

      const timer = setTimeout(() => {
        setExiting(true);
        setTimeout(() => {
          setVisible(false);
          onClose();
        }, 200);
      }, duration);

      return () => clearTimeout(timer);
    } else {
      setVisible(false);
      setExiting(false);
    }
  }, [show, duration, onClose]);

  if (!show) return null;

  const Icon = icons[type];
  const s = styles[type];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed left-4 right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:left-auto sm:right-5 sm:bottom-5 sm:w-auto sm:max-w-md z-[100] flex items-start gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-xl backdrop-blur-sm transition-all duration-200",
        s.border,
        visible && !exiting
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          s.icon
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="flex-1 text-sm font-medium leading-snug text-foreground break-words">
        {message}
      </p>
      <button
        onClick={() => {
          setExiting(true);
          setTimeout(() => {
            setVisible(false);
            onClose();
          }, 200);
        }}
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default ToastNotification;
