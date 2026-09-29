"use client";

import { useMemo } from "react";
import DeckDescription from "./DeckDescription";
import { resolveDeckDescriptionRefs } from "../lib/descriptionRefs";

// Builder preview: resolves `[[mentions]]` in the browser as the author types.
// The builder already ships the card catalog, so this costs nothing there. The
// public deck page must not use it — it gets refs from the server instead, so
// the catalog stays out of that bundle (clientBundleNoCatalog.test.ts).
export default function LiveDeckDescription({
  markdown,
  draft = false,
  className,
}: {
  markdown: string;
  draft?: boolean;
  className?: string;
}) {
  const refs = useMemo(() => resolveDeckDescriptionRefs(markdown), [markdown]);
  return <DeckDescription markdown={markdown} refs={refs} draft={draft} className={className} />;
}
