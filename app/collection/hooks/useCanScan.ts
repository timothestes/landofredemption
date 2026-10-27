"use client";

import { useEffect, useState } from "react";
import { canScanAction } from "../scan/actions";

// Resolved once per user per page load; the gate does not change within a
// session. Keyed by user id so a different sign-in never reuses a stale answer.
// Errors are not cached: a later mount retries.
const cached = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

function resolveCanScan(key: string): Promise<boolean> {
  const hit = cached.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = inflight.get(key);
  if (!p) {
    p = canScanAction()
      .then((allowed) => {
        cached.set(key, allowed);
        return allowed;
      })
      .catch(() => false)
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
  }
  return p;
}

/**
 * Whether to show scanner entry links. False until resolved, and on error.
 * userId: the signed-in user's id (null when unknown or signed out).
 */
export function useCanScan(enabled: boolean, userId: string | null): boolean {
  const key = userId ?? "";
  const [resolved, setResolved] = useState<{ key: string; allowed: boolean } | null>(
    enabled && cached.has(key) ? { key, allowed: cached.get(key)! } : null,
  );

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    resolveCanScan(key).then((a) => {
      if (live) setResolved({ key, allowed: a });
    });
    return () => {
      live = false;
    };
  }, [enabled, key]);

  return enabled && resolved?.key === key && resolved.allowed;
}
