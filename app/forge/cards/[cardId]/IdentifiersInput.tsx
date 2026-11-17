"use client";

import { useEffect, useState } from "react";
import { QuoteInput } from "./QuoteTextarea";

// Comma-separated identifier list edited as free text. Like StatInput, it holds a
// local draft so transient input isn't clobbered by the controlled value. Parsing on
// every keystroke and re-joining the array — the old approach — stripped a trailing
// comma ("Genesis," → "Genesis", so a second identifier could never be started) and a
// space mid-word ("Chief " → "Chief", so multi-word identifiers like "Chief Priest"
// were untypeable). The parsed array commits upward on each change; the draft resyncs
// only when the model changes to something it doesn't already represent (an external
// load/reset), never on our own commits.
export default function IdentifiersInput({
  id,
  value,
  onChange,
  className,
  placeholder,
}: {
  id?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => value.join(", "));
  useEffect(() => {
    // `draft` is intentionally omitted: resync tracks external model changes, not
    // typing. The guard skips our own commits, whose array differs by reference but
    // not content, so an in-progress "Genesis, " isn't snapped back to "Genesis".
    if (!sameIds(value, parseIdentifiers(draft))) setDraft(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <QuoteInput
      id={id}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseIdentifiers(e.target.value));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

function parseIdentifiers(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
