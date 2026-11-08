"use client";

import type { ReactNode } from "react";
import { useLinkStatus } from "next/link";

// Goes inside a Link: shows its children from the click until the new page arrives, so a slow
// page never looks like the click did nothing. Outside a Link it just shows `idle`.
export default function LinkPending({ idle = null, children }: { idle?: ReactNode; children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <>{pending ? children : idle}</>;
}
