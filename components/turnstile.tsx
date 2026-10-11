"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare Turnstile widget. Calls onToken with a fresh token, or null when
 * the token expires or the widget errors. Tokens are single-use: remount the
 * component (change its `key`) after a failed submit to get a new one.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const host = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const el = host.current;
    if (!siteKey || !el) return;
    let widgetId: string | null = null;
    let cancelled = false;

    const render = () => {
      if (cancelled || !window.turnstile) return;
      widgetId = window.turnstile.render(el, {
        sitekey: siteKey,
        theme: resolvedTheme === "dark" ? "dark" : "light",
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, resolvedTheme]);

  if (!siteKey) {
    return (
      <p className="text-sm text-destructive text-center">
        Bot protection is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY), so this form can&apos;t be
        submitted.
      </p>
    );
  }
  return <div ref={host} className="flex justify-center" />;
}
