"use client";

import { useEffect, useState } from "react";
import { canScanAction } from "../scan/actions";

// Resolved once per page load; the gate does not change within a session.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function resolveCanScan(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  inflight ??= canScanAction()
    .catch(() => false)
    .then((allowed) => {
      cached = allowed;
      return allowed;
    });
  return inflight;
}

/** Whether to show scanner entry links. False until resolved, and on error. */
export function useCanScan(enabled: boolean): boolean {
  const [allowed, setAllowed] = useState<boolean>(cached ?? false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    resolveCanScan().then((a) => {
      if (live) setAllowed(a);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  return enabled && allowed;
}
