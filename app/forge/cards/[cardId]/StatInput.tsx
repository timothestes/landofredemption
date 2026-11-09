"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { parseStatInput, type StatValue } from "@/app/forge/lib/designCard";
import { isUnfinishedStat, statRefusedNote, statShown, statSidesNote } from "@/app/forge/lib/statField";

// Text input for a stat that may be a number, "X", or a paired dual-side value like "6 (0)".
// Commits upward as soon as the text parses (or empties) and keeps what you typed until you leave
// the field, which then shows what was stored. Text it can't save is refused out loud, and
// `warnTwoSides` says when a paired value is what got saved.
export default function StatInput({
  value,
  onCommit,
  className,
  warnTwoSides = false,
}: {
  value: StatValue | undefined;
  onCommit: (v: StatValue) => void;
  className?: string;
  warnTwoSides?: boolean;
}) {
  const [draft, setDraft] = useState(statShown(value));
  const [refused, setRefused] = useState(false);
  // A change from elsewhere replaces the text. This field's own commit doesn't: "4/1" is on its way
  // to "4/11", and rewriting it to "4 (1)" would leave the next digit outside the bracket.
  useEffect(() => {
    setDraft((d) => (parseStatInput(d) === (value ?? null) ? d : statShown(value)));
    setRefused(false);
  }, [value]);
  const sides = warnTwoSides && !refused ? statSidesNote(value) : null;
  return (
    <>
      <input
        type="text"
        placeholder="6 · X · 6/0"
        value={draft}
        aria-invalid={refused || undefined}
        className={cn(className, refused && "border-destructive")}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const parsed = parseStatInput(t);
          const saves = parsed !== null || t.trim() === "";
          if (saves) onCommit(parsed);
          setRefused(!saves && !isUnfinishedStat(t));
        }}
        onBlur={() => {
          if (draft.trim() && draft !== statShown(value) && parseStatInput(draft) === null) setRefused(true);
          setDraft(statShown(value));
        }}
      />
      {refused && <span role="alert" className="mt-1 block text-xs text-destructive">{statRefusedNote(value)}</span>}
      {sides && <span className="mt-1 block text-xs text-amber-600 dark:text-amber-500">{sides}</span>}
    </>
  );
}
