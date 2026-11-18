"use client";

// Client flow for promoting a set to the public catalog. One screen per state
// of the release machine: preflight (no release yet) → staged (image audit +
// processing) → images_done (repo artifacts + verify-live) → live_verified
// (deck migration) → decks_migrated (post-release checklist).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getPromoteReport, promoteSet, applyRenameFix, getReleaseState,
  auditReleaseImages, setReleaseImageTransform, abortRelease,
  verifyReleaseLive, migrateReleaseDecks, listReleaseOverrides, deployCatalog,
  type PromoteReport, type ReleaseState, type ImageAuditRow, type PromoteIssue,
} from "@/app/forge/lib/promote";
import { PRINTER_PRESETS, type ReleaseImageTransform } from "@/app/forge/lib/catalogRow";
import { sameSelection } from "@/app/forge/lib/releaseSelection";

const BATCH_SIZE = 8;

const btn = "rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const btnRed = "rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const panel = "rounded-lg border bg-card p-4";

type Props = { setId: string; setName: string; setStatus: string; initialRelease: ReleaseState | null };

export default function PromoteClient({ setId, setName, setStatus, initialRelease }: Props) {
  const router = useRouter();
  const [release, setRelease] = useState<ReleaseState | null>(initialRelease);
  const [newWave, setNewWave] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async (warning?: string) => {
    setRelease(await getReleaseState(setId));
    setNewWave(false);
    setNotice(warning ?? null);
    router.refresh();
  };

  // A completed release still allows a follow-up wave for cards approved since.
  const done = release?.status === "decks_migrated";

  return (
    <div className="space-y-4">
      <StageHeader status={newWave ? null : (release?.status ?? null)} />
      {notice && <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p>}
      {release === null || (done && newWave) ? (
        <PreflightSection
          setId={setId}
          setName={setName}
          setStatus={setStatus}
          identityLocked={done}
          defaultSetCode={done ? release!.setCode : ""}
          defaultOfficialSet={done ? release!.officialSet : setName}
          onPromoted={refresh}
        />
      ) : (
        <>
          <ReleaseSection release={release} onChanged={refresh} />
          {done && (
            <button type="button" className={btn} onClick={() => setNewWave(true)}>
              Promote more cards (new wave)
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const STAGES = [
  { key: "preflight", label: "Preflight" },
  { key: "staged", label: "Images" },
  { key: "images_done", label: "Merge + verify" },
  { key: "live_verified", label: "Migrate decks" },
  { key: "decks_migrated", label: "Done" },
] as const;

function StageHeader({ status }: { status: string | null }) {
  const activeIdx = status === null ? 0 : STAGES.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>→</span>}
          <span
            className={
              i < activeIdx
                ? "text-foreground/70 line-through decoration-foreground/30"
                : i === activeIdx
                  ? "rounded bg-muted px-1.5 py-0.5 font-medium text-foreground"
                  : ""
            }
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function IssueList({ issues, tone, onRename }: {
  issues: PromoteIssue[];
  tone: "blocker" | "warning";
  onRename?: (cardId: string, suggestion: string) => void;
}) {
  if (issues.length === 0) return null;
  const color = tone === "blocker" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  return (
    <ul className="space-y-1 text-sm">
      {issues.map((iss, i) => (
        <li key={`${iss.code}-${iss.cardId ?? i}`} className="flex flex-wrap items-center gap-2">
          <span className={color}>{tone === "blocker" ? "✕" : "!"}</span>
          <span>{iss.message}</span>
          {iss.suggestion && iss.cardId && onRename && (
            <button type="button" className={btn} onClick={() => onRename(iss.cardId!, iss.suggestion!)}>
              Rename to “{iss.suggestion}”
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Preflight + the red button
// ---------------------------------------------------------------------------

function PreflightSection({ setId, setName, setStatus, identityLocked, defaultSetCode = "", defaultOfficialSet, onPromoted }: {
  setId: string; setName: string; setStatus: string; identityLocked: boolean;
  defaultSetCode?: string; defaultOfficialSet?: string;
  onPromoted: () => Promise<void>;
}) {
  const [setCode, setSetCode] = useState(defaultSetCode);
  const [officialSet, setOfficialSet] = useState(defaultOfficialSet ?? setName);
  const [report, setReport] = useState<PromoteReport | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null); // null → server default
  const [closeSet, setCloseSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRows, setShowRows] = useState(false);

  const runPreflight = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getPromoteReport(setId, setCode, officialSet, selected ?? undefined);
      setReport(r);
      if (!r) setError("Could not read the set.");
      else {
        setSelected(r.selectedCardIds);
        setCloseSet(r.closeEligible && setStatus !== "released");
      }
    } finally {
      setBusy(false);
    }
  };

  const rename = async (cardId: string, suggestion: string) => {
    if (!window.confirm(
      `Rename to “${suggestion}”?\n\nThis overwrites the card's working draft with its approved snapshot plus the new name, then re-releases and re-approves it.`,
    )) return;
    setBusy(true);
    try {
      const res = await applyRenameFix(cardId, suggestion);
      if (!res.ok) setError(res.error ?? "Rename failed");
      await runPreflight();
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await promoteSet(setId, setCode, officialSet, selected ?? undefined, closeSet);
      if (res.ok === false) {
        setError(res.error);
      } else {
        await onPromoted();
      }
    } finally {
      setBusy(false);
    }
  };

  const dirty =
    report !== null && selected !== null && !sameSelection(selected, report.selectedCardIds);
  const ready = report !== null && report.blockers.length === 0 && !dirty;

  return (
    <div className="space-y-4">
      <div className={panel}>
        <h2 className="text-sm font-semibold">Release identity</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {identityLocked
            ? "Locked to this set's earlier release — waves keep one catalog identity."
            : "The set code becomes the catalog’s short set value; the official name is its display name. Both are frozen at promote time."}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Set code</span>
            <input
              value={setCode}
              onChange={(e) => { setSetCode(e.target.value); setReport(null); }}
              placeholder="e.g. EoT"
              maxLength={16}
              readOnly={identityLocked}
              disabled={identityLocked}
              className={`w-32 rounded-md border bg-background px-2 py-1.5 text-sm${identityLocked ? " opacity-70" : ""}`}
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Official set name</span>
            <input
              value={officialSet}
              onChange={(e) => { setOfficialSet(e.target.value); setReport(null); }}
              readOnly={identityLocked}
              disabled={identityLocked}
              className={`w-64 rounded-md border bg-background px-2 py-1.5 text-sm${identityLocked ? " opacity-70" : ""}`}
            />
          </label>
          <button type="button" className={btn} onClick={runPreflight} disabled={busy || !setCode.trim()}>
            {busy ? "Checking…" : "Run preflight"}
          </button>
        </div>
      </div>

      {report && (
        <div className={panel}>
          <h2 className="text-sm font-semibold">
            Preflight — {report.eligibleCount} card{report.eligibleCount === 1 ? "" : "s"} to release
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.excludedArchived > 0 && <>Excluded: {report.excludedArchived} archived. </>}
            {report.excludedPromoted > 0 && <>{report.excludedPromoted} already promoted. </>}
            Promote freezes each card’s <em>approved</em> version — never the working draft.
          </p>
          <div className="mt-3 space-y-1">
            {report.roster.map((r) => {
              const isSel = (selected ?? report.selectedCardIds).includes(r.cardId);
              return (
                <label key={r.cardId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={r.group === "approved" ? isSel : false}
                    disabled={r.group !== "approved" || busy}
                    onChange={() => {
                      const cur = selected ?? report.selectedCardIds;
                      setSelected(isSel ? cur.filter((id) => id !== r.cardId) : [...cur, r.cardId]);
                    }}
                  />
                  <span className={r.group === "approved" ? "" : "text-muted-foreground"}>{r.title}</span>
                  {r.group === "unapproved" && (
                    <span className="text-xs text-muted-foreground">not final — can’t be included</span>
                  )}
                  {r.group === "promoted" && (
                    <span className="text-xs text-muted-foreground">already released</span>
                  )}
                </label>
              );
            })}
            <button
              type="button" className={`${btn} mt-1`} disabled={busy}
              onClick={() =>
                setSelected(report.roster.filter((r) => r.group === "approved").map((r) => r.cardId))
              }
            >
              Select all final cards
            </button>
            {dirty && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Selection changed — run preflight again to refresh the report.
              </p>
            )}
          </div>
          <div className="mt-3 space-y-3">
            <IssueList issues={report.blockers} tone="blocker" onRename={rename} />
            <IssueList issues={report.warnings} tone="warning" />
            {report.blockers.length === 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">No blockers.</p>
            )}
          </div>
          <button type="button" className={`${btn} mt-3`} onClick={() => setShowRows((v) => !v)}>
            {showRows ? "Hide" : "Show"} derived catalog rows
          </button>
          {showRows && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Name</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 pr-3 font-medium">Brigade</th>
                    <th className="py-1 pr-3 font-medium">Legality</th>
                    <th className="py-1 pr-3 font-medium">Artist</th>
                    <th className="py-1 pr-3 font-medium">Image file</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.cardId} className="border-t">
                      <td className="py-1 pr-3">{r.name}</td>
                      <td className="py-1 pr-3">{r.type}</td>
                      <td className="py-1 pr-3">{r.brigade}</td>
                      <td className="py-1 pr-3">{r.legality}</td>
                      <td className="py-1 pr-3">{r.artist || "—"}</td>
                      <td className="py-1 pr-3 font-mono">{r.imgFile}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {ready && (
        <div className="rounded-lg border border-red-600/40 bg-red-600/5 p-4">
          <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
            Promote to the public catalog
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This freezes the release manifest and marks every card promoted. Card <em>data</em> stays
            member-only until images are processed; the image step publishes them irreversibly.
          </p>
          <p className="mt-2 text-sm">
            Releasing <span className="font-semibold">{report.selectedCardIds.length}</span> of{" "}
            <span className="font-semibold">{report.totalReleasable}</span> remaining card
            {report.totalReleasable === 1 ? "" : "s"}.
          </p>
          {setStatus !== "released" && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closeSet}
                disabled={!report.closeEligible || busy}
                onChange={(e) => setCloseSet(e.target.checked)}
              />
              Close the set after this release (no new cards)
              {!report.closeEligible && (
                <span className="text-xs text-muted-foreground">
                  — {report.totalReleasable - report.selectedCardIds.length} card(s) not in this release; the set stays open
                </span>
              )}
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${setCode.trim()} to confirm`}
              className="w-56 rounded-md border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              className={btnRed}
              disabled={busy || confirmText.trim() !== setCode.trim()}
              onClick={promote}
            >
              {busy ? "Promoting…" : `Promote ${report.selectedCardIds.length} card${report.selectedCardIds.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-promote stages
// ---------------------------------------------------------------------------

function ReleaseSection({ release, onChanged }: { release: ReleaseState; onChanged: (warning?: string) => Promise<void> }) {
  return (
    <div className="space-y-4">
      <div className={panel}>
        <h2 className="text-sm font-semibold">
          {release.officialSet} <span className="font-mono text-muted-foreground">({release.setCode})</span>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {release.cardCount} cards · promoted {new Date(release.createdAt).toLocaleString()} · status{" "}
          <span className="font-medium text-foreground">{release.status}</span>
        </p>
      </div>
      {release.status === "staged" && <ImageStep release={release} onChanged={onChanged} />}
      {release.status === "images_done" && <MergeStep release={release} onChanged={onChanged} />}
      {release.status === "live_verified" && <MigrateStep release={release} onChanged={onChanged} />}
      {release.status === "decks_migrated" && <DoneStep release={release} />}
    </div>
  );
}

function AbortButton({ release, onChanged }: { release: ReleaseState; onChanged: (warning?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = async () => {
    setBusy(true);
    const affected = await listReleaseOverrides(release.id);
    let message =
      "Abort this release?\n\nUploaded public images are deleted, the manifest is removed, and every card returns to approved. Use this to fix a mistake before anything merges.";
    if (affected.length > 0) {
      message += `\n\n⚠️ ${affected.length} card(s) in this release have catalog-editor overrides or aliases (${affected.slice(0, 5).join(", ")}${affected.length > 5 ? ", …" : ""}). If the overlay was already pulled, aborting strands them as codegen-blocking orphans — delete those edits in /admin/catalog and land a \`make pull-card-overrides\` refresh first (or be ready to deploy with CATALOG_PREBUILD=0).`;
    }
    if (!window.confirm(message)) {
      setBusy(false);
      return;
    }
    const res = await abortRelease(release.id);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Abort failed");
    else await onChanged(res.warning);
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={`${btn} text-red-600 dark:text-red-400`} onClick={abort} disabled={busy}>
        {busy ? "Aborting…" : "Abort release"}
      </button>
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// Live preview of a crop decision: null rect = center cover-crop.
function CropPreviewBox({ src, rect }: { src: string; rect: { x: number; y: number; width: number; height: number } | null }) {
  return (
    <div className="relative w-24 overflow-hidden rounded border bg-muted" style={{ aspectRatio: "345 / 495" }}>
      {rect ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute max-w-none"
          style={{
            width: `${100 / rect.width}%`,
            height: `${100 / rect.height}%`,
            left: `${-(rect.x / rect.width) * 100}%`,
            top: `${-(rect.y / rect.height) * 100}%`,
          }}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

function transformKey(t: ReleaseImageTransform | null): string {
  if (!t || t.mode === "cover") return "cover";
  if (t.mode === "preset") return t.preset;
  return "crop";
}

function ImageStep({ release, onChanged }: { release: ReleaseState; onChanged: (warning?: string) => Promise<void> }) {
  const [audit, setAudit] = useState<ImageAuditRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const pendingCount = release.cardCount - release.uploadedCount;

  const runAudit = async () => {
    setBusy(true);
    try {
      setAudit(await auditReleaseImages(release.id));
    } finally {
      setBusy(false);
    }
  };

  const cropRows = useMemo(
    () => (audit ?? []).filter((r) => r.imageClass === "crop" || r.imageClass === "error"),
    [audit],
  );
  const autoRows = useMemo(
    () => (audit ?? []).filter((r) => r.imageClass === "exact" || r.imageClass === "resize"),
    [audit],
  );

  const pickTransform = async (row: ImageAuditRow, key: string) => {
    const transform: ReleaseImageTransform | null =
      key === "printer1" || key === "printer2" ? { mode: "preset", preset: key } : null;
    const res = await setReleaseImageTransform(release.id, row.cardId, transform);
    if (res.ok) {
      setAudit((a) => (a ?? []).map((r) => (r.cardId === row.cardId ? { ...r, transform } : r)));
    } else {
      setErrors((e) => [...e, `${row.name}: ${res.error}`]);
    }
  };

  const processImages = async () => {
    setBusy(true);
    setErrors([]);
    const ids = release.cards.filter((c) => !c.imageUploaded).map((c) => c.cardId);
    setProgress({ done: 0, total: ids.length });
    const failed: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const res = await fetch("/forge/api/promote/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ releaseId: release.id, cardIds: batch }),
        });
        if (!res.ok) {
          failed.push(`Batch failed (${res.status})`);
          continue;
        }
        const body = (await res.json()) as { results: { cardId: string; ok: boolean; error?: string }[] };
        for (const r of body.results) {
          if (!r.ok) {
            const name = release.cards.find((c) => c.cardId === r.cardId)?.name ?? r.cardId;
            failed.push(`${name}: ${r.error}`);
          }
        }
        setProgress({ done: Math.min(i + batch.length, ids.length), total: ids.length });
      }
    } finally {
      setErrors(failed);
      setBusy(false);
      setProgress(null);
      await onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <div className={panel}>
        <h3 className="text-sm font-semibold">Image processing — {pendingCount} pending</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Every card becomes a uniform 345×495 JPEG in the public image store. Exact and
          near-aspect images process automatically; others need a crop decision below.{" "}
          <span className="font-medium text-foreground">Uploading makes the images public.</span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={btn} onClick={runAudit} disabled={busy}>
            {audit === null ? "Run image audit" : "Re-run audit"}
          </button>
          <button type="button" className={btnRed} onClick={processImages} disabled={busy || pendingCount === 0}>
            {progress
              ? `Processing ${progress.done}/${progress.total}…`
              : `Process + publish ${pendingCount} images`}
          </button>
        </div>
        {audit !== null && (
          <p className="mt-2 text-xs text-muted-foreground">
            {autoRows.length} automatic · {cropRows.length} needing a crop decision
          </p>
        )}
        {errors.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-red-600 dark:text-red-400">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>

      {cropRows.length > 0 && (
        <div className={panel}>
          <h3 className="text-sm font-semibold">Crop decisions</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            These images deviate from card aspect. Default is a center cover-crop; the printer
            presets are the historical bleed-crops for print-resolution scans. The preview shows
            the exact final framing.
          </p>
          <ul className="mt-3 space-y-3">
            {cropRows.map((row) => {
              const src = `/forge/api/art/${row.cardId}?v=approved&kind=finished`;
              const current = transformKey(row.transform);
              const rect =
                current === "printer1" || current === "printer2"
                  ? PRINTER_PRESETS[current]
                  : null;
              return (
                <li key={row.cardId} className="flex flex-wrap items-center gap-3 border-t pt-3 first:border-t-0 first:pt-0">
                  <CropPreviewBox src={src} rect={rect} />
                  <div className="min-w-40">
                    <p className="text-sm font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.imageClass === "error"
                        ? <span className="text-red-600 dark:text-red-400">{row.error}</span>
                        : <>{row.width}×{row.height} · aspect {row.aspect.toFixed(3)} (target 0.697)</>}
                    </p>
                  </div>
                  {row.imageClass !== "error" && (
                    <div className="flex gap-1">
                      {(["cover", "printer1", "printer2"] as const).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => pickTransform(row, key)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            current === key ? "bg-muted font-medium" : "hover:bg-muted"
                          }`}
                        >
                          {key === "cover" ? "Center crop" : key === "printer1" ? "Printer 1" : "Printer 2"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AbortButton release={release} onChanged={onChanged} />
    </div>
  );
}

function MergeStep({ release, onChanged }: { release: ReleaseState; onChanged: (warning?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState(false);

  const deploy = async () => {
    setDeployBusy(true);
    setDeployError(null);
    setDeployed(false);
    try {
      const res = await deployCatalog();
      if (res.ok) setDeployed(true);
      else setDeployError(res.error ?? "Deploy failed");
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setDeployBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    setFailures([]);
    try {
      const res = await verifyReleaseLive(release.id);
      if (res.ok) {
        await onChanged();
      } else {
        setFailures(res.failures);
        setError(res.error ?? (res.failures.length > 0 ? "Not every card resolves on this deployment yet." : "Verification failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={panel}>
        <h3 className="text-sm font-semibold">Deploy the catalog</h3>
        <button type="button" className={`${btn} mt-2`} onClick={deploy} disabled={deployBusy}>
          {deployBusy ? "Deploying…" : "Deploy catalog"}
        </button>
        {deployError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{deployError}</p>}
        {deployed && (
          <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
            Build triggered — watch it in the{" "}
            <a
              href="https://vercel.com/land-of-redemptions-projects/redemption-tournament-tracker"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Vercel dashboard
            </a>
            , then Verify below once it’s live.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Any ordinary merge to main also picks this release up.</p>
      </div>
      <div className={panel}>
        <h3 className="text-sm font-semibold">Verify live</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Checks that <em>this deployment’s</em> own card catalog resolves every released card
          exactly (name, set, and image file). Passes once a deployment built after this release went live.
        </p>
        <button type="button" className={`${btn} mt-3`} onClick={verify} disabled={busy}>
          {busy ? "Verifying…" : `Verify ${release.cardCount} cards`}
        </button>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {failures.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {failures.slice(0, 20).map((f) => <li key={f}>✕ {f}</li>)}
            {failures.length > 20 && <li>… and {failures.length - 20} more</li>}
          </ul>
        )}
      </div>
      <AbortButton release={release} onChanged={onChanged} />
    </div>
  );
}

function MigrateStep({ release, onChanged }: { release: ReleaseState; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const migrate = async () => {
    if (!window.confirm(
      `Migrate ${release.affectedDecks ?? "all affected"} deck(s)?\n\nForge refs to released cards become public card entries. Each deck's prior contents are backed up first.`,
    )) return;
    setBusy(true);
    setError(null);
    const res = await migrateReleaseDecks(release.id);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Migration failed");
    else await onChanged();
  };

  return (
    <div className="space-y-4">
      <div className={panel}>
        <h3 className="text-sm font-semibold">Migrate forge decks</h3>
        <p className="mt-1 text-sm">
          {release.affectedDecks === null
            ? "Counting affected decks…"
            : `${release.affectedDecks} deck(s) still hold forge refs to this set.`}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          The set is verified live, so every ref rewrites to its public card. Duplicates from the
          double-listing window merge by summing quantities per zone. Idempotent — safe to re-run.
        </p>
        <button type="button" className={`${btn} mt-3`} onClick={migrate} disabled={busy}>
          {busy ? "Migrating…" : "Migrate decks"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function DoneStep({ release }: { release: ReleaseState }) {
  return (
    <div className={panel}>
      <h3 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Release complete</h3>
      <p className="mt-1 text-xs text-muted-foreground">Follow-ups that live outside the button:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          Paragon decision: add “{release.officialSet}” to <code className="rounded bg-muted px-1 text-xs">PARAGON_EXCLUDED_SETS</code>{" "}
          or accept Paragon-legality (a new set is Paragon-legal by default).
        </li>
        <li>
          Pricing: add a <code className="rounded bg-muted px-1 text-xs">set_aliases</code> row when YTG sells the set,
          else add “{release.setCode}” to <code className="rounded bg-muted px-1 text-xs">UNSOLD_SETS</code>.
        </li>
        {release.missingReference.length > 0 && (
          <li>
            Testament overrides needed (no scripture reference):{" "}
            {release.missingReference.join(", ")}.
          </li>
        )}
        <li><code className="rounded bg-muted px-1 text-xs">CARD_ABILITIES</code> entries for cards that warrant right-click abilities.</li>
        <li>Hand the set to the upstream Lackey plugin via the Forge Lackey export (it now emits the released identity).</li>
        <li>
          On eventual upstream absorption: if upstream imgFiles differ, re-run pricing matching,
          re-key testament overrides, and delete the orphaned card-images blobs.
        </li>
      </ul>
    </div>
  );
}
