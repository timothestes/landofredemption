"use client";

import { timeAgo } from "@/app/forge/lib/relativeTime";
import { summarizeDiff, type FieldChange } from "@/app/forge/lib/cardDiff";
import FieldChanges from "./FieldChanges";
import {
  EVENT_LABEL,
  appliedSuggestionNote,
  VERSION_STATUS_LABEL,
  VERSION_PILL,
  versionVerb,
  splitHistoryForDisplay,
  type HistoryEvent,
} from "@/app/forge/lib/historyView";
import { useLocalStorageFlag } from "@/app/forge/lib/useLocalStorageFlag";

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  denied: "Denied",
  superseded: "Superseded",
};

function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        {summarizeDiff(changes)}
      </summary>
      <div className="mt-1.5">
        <FieldChanges changes={changes} />
      </div>
    </details>
  );
}

function renderEvent(e: HistoryEvent) {
  if (e.kind === "version") {
    const v = e.version;
    return (
      <li key={`v-${v.id}`} className="rounded-md border bg-muted px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">v{v.versionNumber} {versionVerb(v.status)}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${VERSION_PILL[v.status]}`}>
            {VERSION_STATUS_LABEL[v.status]}
          </span>
          <span className="text-xs text-muted-foreground">
            {v.authorName ?? "Forge member"} · {timeAgo(v.createdAt)}
          </span>
        </div>
        {v.note && <p className="mt-1 max-w-[70ch] whitespace-pre-wrap leading-relaxed text-muted-foreground">{v.note}</p>}
        <ChangeList changes={e.changes} />
      </li>
    );
  }
  if (e.kind === "proposal") {
    const p = e.proposal;
    return (
      <li key={`p-${p.id}`} className="rounded-md border px-2.5 py-2">
        <p className="max-w-[70ch] leading-relaxed">{p.summary ?? "Proposed change"}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
          {p.status === "accepted" && e.resultingVersionNumber != null && <> → v{e.resultingVersionNumber}</>}
          {" · proposed by "}
          <span className="font-medium text-foreground">{p.proposerName ?? "Forge member"}</span>
          {p.status === "accepted" && p.approverName && (
            <> · accepted by <span className="font-medium text-foreground">{p.approverName}</span></>
          )}
        </p>
        {p.status === "superseded" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {e.supersededBy
              ? <>Superseded when “{e.supersededBy}” was accepted.</>
              : <>Out of date — a direct release replaced the version it was based on.</>}
          </p>
        )}
        {/* A denial reason is marked by a rose rule rather than rose body text:
            text-destructive on the light page is 3.76:1, under AA at this size. */}
        {e.reasons.map((r) => (
          <p
            key={r.id}
            className={`mt-1.5 max-w-[70ch] whitespace-pre-wrap leading-relaxed ${
              p.status === "denied" ? "border-l-2 border-rose-500 pl-2" : ""
            }`}
          >
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{r.authorName ?? "Forge member"}</span>
              {" · "}
              {timeAgo(r.createdAt)}
              {" — "}
            </span>
            {r.body}
          </p>
        ))}
      </li>
    );
  }
  if (e.kind === "suggestion") {
    return (
      <li key={`s-${e.comment.id}`} className="rounded-md border px-2.5 py-2">
        {/* The relative time can differ between the server's render and this one. */}
        <p suppressHydrationWarning className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Suggestion applied</span>
          {" · suggested by "}
          {e.comment.authorName ?? "Forge member"}
          {" · "}
          {timeAgo(e.at)}
        </p>
        <div className="mt-1">
          <FieldChanges changes={[e.applied.change]} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{appliedSuggestionNote(e.applied)}</p>
      </li>
    );
  }
  return (
    <li key={`e-${e.event.id}`} className="px-2.5 py-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{EVENT_LABEL[e.event.action] ?? e.event.action}</span>
      {" · "}
      {e.event.actorName ?? "Forge member"}
      {" · "}
      {timeAgo(e.at)}
    </li>
  );
}

export default function CardHistory({ history, cardId }: { history: HistoryEvent[]; cardId: string }) {
  const [showOlder, setShowOlder] = useLocalStorageFlag(`forge:card:${cardId}:history-expanded`);
  const { recent, older, hiddenVersionCount } = splitHistoryForDisplay(history);
  if (history.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
        No history yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {recent.map(renderEvent)}
      {older.length > 0 && (
        <li>
          <button
            type="button"
            aria-expanded={showOlder}
            onClick={() => setShowOlder(!showOlder)}
            className="cursor-pointer select-none px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showOlder
              ? "Hide earlier versions"
              : `Show ${hiddenVersionCount} earlier version${hiddenVersionCount === 1 ? "" : "s"}`}
          </button>
        </li>
      )}
      {showOlder && older.map(renderEvent)}
    </ul>
  );
}
