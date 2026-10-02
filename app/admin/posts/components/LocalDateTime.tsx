"use client";

import { useSyncExternalStore } from "react";
import { formatScheduled } from "../lib/schedule";

const subscribe = () => () => {};

// A timestamp in the viewer's own timezone, zone abbreviation included. The
// server (UTC on Vercel) can't know that zone, so the server render and the
// hydration pass show the time as UTC — labelled as such — and it switches
// to local time as soon as the browser takes over.
export default function LocalDateTime({ iso }: { iso: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return <time dateTime={iso}>{formatScheduled(iso, hydrated ? undefined : "UTC")}</time>;
}
