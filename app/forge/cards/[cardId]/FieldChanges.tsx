"use client";

import { isBlockChange, readsAsRedline, wordDiff, type FieldChange, type TextOp } from "@/app/forge/lib/cardDiff";

// Diff colours are rose/emerald, not destructive/primary:
//   - `--primary` is the brand accent, reserved for CTAs and active states. A version
//     entry that added nine fields used to render as nine lines of accent green.
//   - `text-destructive` on white is 3.76:1 — under AA for body copy, and this text is
//     14px, below the large-text threshold that would excuse it.
// So the hue lives in a 2px edge plus a faint tint while the text stays `text-foreground`.
// That reads in light, dark and jayden, where `--primary` is magenta and `bg-primary/10`
// vs `bg-destructive/10` are within ~1.02:1 of each other. Emerald/amber/violet/sky are
// already used at rest by STATUS_BADGE_CLASS, so this is the established palette.
const BEFORE = "whitespace-pre-wrap rounded border-l-2 border-rose-500 bg-rose-500/10 px-2 py-1 text-foreground";
const AFTER = "whitespace-pre-wrap rounded border-l-2 border-emerald-500 bg-emerald-500/10 px-2 py-1 text-foreground";
const FIRST = "whitespace-pre-wrap rounded border-l-2 border-border bg-muted px-2 py-1 text-foreground";
// Padded so a replaced word reads as two marks, not one: "2" then "3", never "23".
const DEL = "rounded-sm bg-rose-500/25 px-0.5 line-through decoration-rose-500";
const INS = "rounded-sm bg-emerald-500/25 px-0.5 font-medium no-underline";

function Marked({ ops }: { ops: TextOp[] }) {
  return (
    <>
      {ops.map((o, i) =>
        o.op === "del" ? <del key={i} className={DEL}>{o.text}</del>
          : o.op === "ins" ? <ins key={i} className={INS}>{o.text}</ins>
          : <span key={i}>{o.text}</span>,
      )}
    </>
  );
}

// A small change is one paragraph with the changed words marked. A rewrite stays as two
// paragraphs, with whatever words did change marked on each side.
function TextChange({ before, after }: { before: string; after: string }) {
  const ops = wordDiff(before, after);
  if (readsAsRedline(ops)) return <div className={FIRST}><Marked ops={ops} /></div>;
  return (
    <>
      <div className={BEFORE}><Marked ops={ops.filter((o) => o.op !== "ins")} /></div>
      <div className={AFTER}><Marked ops={ops.filter((o) => o.op !== "del")} /></div>
    </>
  );
}

export default function FieldChanges({
  changes,
  isNewCard,
}: {
  changes: FieldChange[];
  // Every field on a brand-new card is an addition — render the value plainly rather
  // than as "— → value", which is noise.
  isNewCard?: boolean;
}) {
  if (changes.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {changes.map((c) => {
        const firstValue = isNewCard || c.before === null;
        if (isBlockChange(c)) {
          return (
            <li key={c.field as string} className="space-y-1">
              <span className="font-medium">{c.label}</span>
              {firstValue ? (
                <div className={FIRST}>{c.after ?? "—"}</div>
              ) : c.after === null ? (
                <div className={BEFORE}>{c.before}</div>
              ) : (
                <TextChange before={c.before as string} after={c.after} />
              )}
            </li>
          );
        }
        return (
          <li key={c.field as string} className="leading-relaxed">
            <span className="font-medium">{c.label}:</span>{" "}
            {firstValue ? (
              <span>{c.after ?? "—"}</span>
            ) : (
              <>
                <span className="line-through decoration-rose-500 decoration-2">{c.before ?? "—"}</span>
                <span aria-hidden="true"> → </span>
                <span className="font-medium">{c.after ?? "—"}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
