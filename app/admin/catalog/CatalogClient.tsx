"use client";

import { useMemo, useRef, useState } from "react";
import TopNav from "../../../components/top-nav";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { cardNameKey } from "@/lib/cards/nameKey";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import {
  CARD_IMAGE_WIDTH,
  CARD_IMAGE_HEIGHT,
  CARD_IMAGE_ASPECT,
  AUTO_RESIZE_TOLERANCE,
  PRINTER_PRESETS,
  type ReleaseImageTransform,
} from "@/app/forge/lib/catalogRow";
import { EDITABLE_FIELDS, type EditableField } from "./lib/editorShared";
import { diffPending, type BundledOverlay, type PendingItem } from "./lib/pendingDiff";
import {
  saveOverride,
  deleteOverride,
  type OverrideRow,
  type ImageVersionRow,
  type AliasRow,
} from "./actions";
import AliasEditor from "./AliasEditor";
import bundledOverlay from "@/scripts/data/card-overrides.json";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Tab = "edit" | "pending";

const FIELD_LABELS: Record<EditableField, string> = {
  officialSet: "Official Set",
  type: "Type",
  brigade: "Brigade",
  strength: "Strength",
  toughness: "Toughness",
  class: "Class",
  identifier: "Identifier",
  specialAbility: "Special Ability",
  rarity: "Rarity",
  reference: "Reference",
  alignment: "Alignment",
  legality: "Legality",
  artist: "Artist",
};

const MULTILINE_FIELDS: ReadonlySet<EditableField> = new Set(["specialAbility", "identifier"]);

const SEARCH_MIN_CHARS = 2;
const SEARCH_MAX_RESULTS = 30;

type ImageClass = "exact" | "resize" | "crop";
type PresetKey = keyof typeof PRINTER_PRESETS;
const FRAME_WIDTH = 172;
const FRAME_HEIGHT = 247;

/* ------------------------------------------------------------------ */
/*  Small presentational bits                                          */
/* ------------------------------------------------------------------ */

function LockIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 10-8 0v4h8z"
      />
    </svg>
  );
}

function PendingKindBadge({ kind }: { kind: PendingItem["kind"] }) {
  const styles: Record<PendingItem["kind"], string> = {
    "override-new": "bg-secondary text-secondary-foreground",
    "override-changed": "bg-accent text-accent-foreground",
    "override-removed": "bg-destructive/10 text-destructive",
    "image-bump": "bg-secondary text-secondary-foreground",
    "alias-new": "bg-secondary text-secondary-foreground",
    "alias-changed": "bg-accent text-accent-foreground",
    "alias-removed": "bg-destructive/10 text-destructive",
  };
  const labels: Record<PendingItem["kind"], string> = {
    "override-new": "New",
    "override-changed": "Changed",
    "override-removed": "Removed",
    "image-bump": "Image",
    "alias-new": "Alias",
    "alias-changed": "Alias",
    "alias-removed": "Alias",
  };
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[kind]}`}
    >
      {labels[kind]}
    </span>
  );
}

/** Exact final framing for a crop decision, in a fixed card-shaped frame — the
 *  fractional-rect math mirrors promote's CropPreviewBox. */
function ImageFramePreview({ src, transform }: { src: string; transform: ReleaseImageTransform }) {
  const style =
    transform.mode === "preset"
      ? (() => {
          const rect = PRINTER_PRESETS[transform.preset];
          return {
            width: `${(1 / rect.width) * 100}%`,
            height: `${(1 / rect.height) * 100}%`,
            marginLeft: `${(-rect.x / rect.width) * 100}%`,
            marginTop: `${(-rect.y / rect.height) * 100}%`,
            maxWidth: "none",
          } as const;
        })()
      : null;
  return (
    <div
      className="relative overflow-hidden rounded-md border border-border bg-muted"
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={style ? "absolute" : "h-full w-full object-cover"}
        style={style ?? undefined}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CatalogClient({
  initial,
}: {
  initial: { overrides: OverrideRow[]; imageVersions: ImageVersionRow[]; aliases: AliasRow[] };
}) {
  const [tab, setTab] = useState<Tab>("edit");
  const [dbOverrides, setDbOverrides] = useState<OverrideRow[]>(initial.overrides);
  const [dbImageVersions, setDbImageVersions] = useState<ImageVersionRow[]>(initial.imageVersions);
  const [dbAliases, setDbAliases] = useState<AliasRow[]>(initial.aliases);

  // Search (edit tab)
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);

  // Editor state — override state is EXPLICIT per field (spec F9): a key's
  // presence in this object is what makes it "overridden", never a value
  // comparison against the live card. An override equal to the live value
  // must be storable.
  const [overrides, setOverrides] = useState<Partial<Record<EditableField, string>>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image panel (Task 11, spec §6/§7 F2).
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileDims, setFileDims] = useState<{ width: number; height: number } | null>(null);
  const [imageClass, setImageClass] = useState<ImageClass | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transform, setTransform] = useState<ReleaseImageTransform | null>(null);
  const [imgNote, setImgNote] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgSuccess, setImgSuccess] = useState<string | null>(null);
  // imgFile -> Date.now() of a successful replace this session, so the preview
  // busts past the browser's own cache even before a redeploy regenerates
  // imgVersions.json. Keyed on imgFile (not the selected card) so a co-owner's
  // preview stays busted too if the admin selects it later in the session.
  const [replacedAt, setReplacedAt] = useState<Record<string, number>>({});
  // Staleness guard: createImageBitmap decode time scales with file size, so a
  // slow decode of an earlier pick can resolve after a later, faster pick and
  // silently overwrite it with the wrong file. Bumped on every new selection
  // and whenever selection state is reset out from under an in-flight decode
  // (card switch, successful replace); a decode only commits state if its
  // captured generation still matches.
  const fileSelectGen = useRef(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < SEARCH_MIN_CHARS) return [];
    const found: CardData[] = [];
    for (const c of CARDS) {
      if (!c.name) continue;
      if (c.name.toLowerCase().includes(q)) {
        found.push(c);
        if (found.length >= SEARCH_MAX_RESULTS) break;
      }
    }
    return found;
  }, [query]);

  const existingRow = useMemo(() => {
    if (!selectedCard) return null;
    return (
      dbOverrides.find(
        (o) => o.card_name === selectedCard.name && o.set_code === selectedCard.set
      ) ?? null
    );
  }, [dbOverrides, selectedCard]);

  // Co-owners (F2) — other catalog cards sharing this image file. Replacing it
  // changes their art too.
  const coOwners = useMemo(() => {
    if (!selectedCard) return [];
    return CARDS.filter(
      (c) => c.imgFile === selectedCard.imgFile && !(c.name === selectedCard.name && c.set === selectedCard.set)
    );
  }, [selectedCard]);

  const currentVersion = useMemo(() => {
    if (!selectedCard) return 0;
    return dbImageVersions.find((r) => r.img_file === selectedCard.imgFile)?.version ?? 0;
  }, [selectedCard, dbImageVersions]);

  const currentSrc = useMemo(() => {
    if (!selectedCard) return "";
    const base = getCardImageUrl(selectedCard.imgFile);
    const ts = replacedAt[selectedCard.imgFile];
    if (!ts) return base;
    return `${base}${base.includes("?") ? "&" : "?"}ts=${ts}`;
  }, [selectedCard, replacedAt]);

  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "";

  const pending = useMemo(
    () =>
      diffPending(
        {
          overrides: dbOverrides.map((o) => ({
            card_name: o.card_name,
            set_code: o.set_code,
            fields: o.fields,
          })),
          imageVersions: Object.fromEntries(dbImageVersions.map((r) => [r.img_file, r.version])),
          aliases: dbAliases.map((a) => ({ alias: a.alias, card_name: a.card_name, set_code: a.set_code })),
        },
        bundledOverlay as BundledOverlay
      ),
    [dbOverrides, dbImageVersions, dbAliases]
  );

  // Which aliases the running deploy does not serve yet, so a chip can say so
  // without the curator having to remember the Pending tab exists.
  const pendingAliasKeys = useMemo(
    () => new Set(pending.filter((i) => i.kind.startsWith("alias-")).map((i) => cardNameKey(i.key))),
    [pending]
  );

  function selectCard(card: CardData) {
    setSelectedCard(card);
    setError(null);
    const row = dbOverrides.find((o) => o.card_name === card.name && o.set_code === card.set);
    setOverrides(row ? { ...(row.fields as Partial<Record<EditableField, string>>) } : {});
    setNote(row?.note ?? "");
    // Reset the image panel's in-progress upload for the newly selected card.
    // Bump the gen first so a decode still in flight from the previous card
    // can't resurrect stale preview state after this reset.
    fileSelectGen.current++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setFileDims(null);
    setImageClass(null);
    setPreviewUrl(null);
    setTransform(null);
    setImgNote("");
    setImgError(null);
    setImgSuccess(null);
  }

  function applyOverride(field: EditableField) {
    if (!selectedCard) return;
    setOverrides((prev) => ({ ...prev, [field]: selectedCard[field] }));
  }

  function revertOverride(field: EditableField) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const hasOverrides = Object.keys(overrides).length > 0;

  async function handleSave() {
    if (!selectedCard) return;
    if (hasOverrides && !note.trim()) {
      setError("A note is required — future-you wants the why.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveOverride(selectedCard.name, selectedCard.set, overrides, note);
    if (res.ok === false) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const key = `${selectedCard.name}|${selectedCard.set}`;
    setDbOverrides((prev) => {
      const filtered = prev.filter((o) => `${o.card_name}|${o.set_code}` !== key);
      if (res.deleted) return filtered;
      return [
        ...filtered,
        {
          card_name: selectedCard.name,
          set_code: selectedCard.set,
          fields: overrides as Record<string, string>,
          note: note.trim(),
          updated_at: new Date().toISOString(),
        },
      ];
    });
    if (res.deleted) setNote("");
    setSaving(false);
  }

  async function handleDeleteOverride() {
    if (!selectedCard) return;
    if (!window.confirm(`Delete the saved override for ${selectedCard.name} (${selectedCard.set})?`)) return;
    setSaving(true);
    setError(null);
    const res = await deleteOverride(selectedCard.name, selectedCard.set);
    if (res.ok === false) {
      setError(res.error);
      setSaving(false);
      return;
    }
    const key = `${selectedCard.name}|${selectedCard.set}`;
    setDbOverrides((prev) => prev.filter((o) => `${o.card_name}|${o.set_code}` !== key));
    setOverrides({});
    setNote("");
    setSaving(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a replace or a mistake
    if (!f) return;
    const gen = ++fileSelectGen.current;
    setImgError(null);
    setImgSuccess(null);
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(f);
    } catch {
      if (gen !== fileSelectGen.current) return; // superseded by a newer selection — don't clobber its state
      setImgError("Could not read this image file.");
      return;
    }
    if (gen !== fileSelectGen.current) {
      bmp.close?.();
      return; // a newer selection (or a card switch) already resolved/reset — discard this stale decode
    }
    const aspect = bmp.width / bmp.height;
    const cls: ImageClass =
      bmp.width === CARD_IMAGE_WIDTH && bmp.height === CARD_IMAGE_HEIGHT && f.type === "image/jpeg"
        ? "exact"
        : Math.abs(aspect - CARD_IMAGE_ASPECT) / CARD_IMAGE_ASPECT <= AUTO_RESIZE_TOLERANCE
          ? "resize"
          : "crop";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(f);
    setFileDims({ width: bmp.width, height: bmp.height });
    setImageClass(cls);
    setPreviewUrl(URL.createObjectURL(f));
    setTransform(cls === "crop" ? { mode: "cover" } : null);
  }

  async function handleReplace() {
    if (!selectedCard || !selectedFile) return;
    setReplacing(true);
    setImgError(null);
    setImgSuccess(null);
    let res: Response;
    try {
      const form = new FormData();
      form.set("name", selectedCard.name);
      form.set("set", selectedCard.set);
      if (transform) form.set("transform", JSON.stringify(transform));
      if (imgNote) form.set("note", imgNote);
      form.set("file", selectedFile);
      res = await fetch("/admin/catalog/api/image", { method: "POST", body: form });
    } catch {
      setImgError("Network error — retry.");
      setReplacing(false);
      return;
    }
    let body: { ok?: boolean; version?: number; method?: string; upscaled?: boolean; error?: string };
    try {
      body = await res.json();
    } catch {
      setImgError(`Replace failed (${res.status}).`);
      setReplacing(false);
      return;
    }
    if (res.ok && body.ok && typeof body.version === "number") {
      const imgFile = selectedCard.imgFile;
      const version = body.version;
      setDbImageVersions((prev) => [
        ...prev.filter((r) => r.img_file !== imgFile),
        { img_file: imgFile, version, note: imgNote.trim() || null, updated_at: new Date().toISOString() },
      ]);
      setReplacedAt((prev) => ({ ...prev, [imgFile]: Date.now() }));
      setImgSuccess(
        `Replaced (v${version}, ${body.method}${body.upscaled ? ", upscaled — low-res source" : ""})`
      );
      // Bump the gen so a decode still in flight from a pick made during the
      // POST can't resurrect stale preview state after this reset.
      fileSelectGen.current++;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setSelectedFile(null);
      setFileDims(null);
      setImageClass(null);
      setPreviewUrl(null);
      setTransform(null);
      setImgNote("");
    } else {
      setImgError(body.error ?? `Replace failed (${res.status}).`);
    }
    setReplacing(false);
  }

  return (
    <>
      <TopNav />
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Catalog</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Override card metadata and track what has not yet been deployed.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6">
          {(
            [
              { key: "edit" as const, label: "Edit" },
              { key: "pending" as const, label: `Pending${pending.length > 0 ? ` (${pending.length})` : ""}` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
                tab === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Edit tab */}
        {tab === "edit" && (
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
            {/* Search + results */}
            <div className="space-y-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cards..."
                className="w-full"
              />
              <div className="space-y-1 max-h-[70vh] overflow-y-auto">
                {results.map((c) => {
                  const selected =
                    selectedCard?.name === c.name && selectedCard?.set === c.set;
                  return (
                    <button
                      key={`${c.name}|${c.set}|${c.imgFile}`}
                      onClick={() => selectCard(c)}
                      className={`w-full text-left px-2.5 py-2 flex items-center gap-2.5 rounded-md transition-colors ${
                        selected ? "bg-muted border border-border" : "hover:bg-muted/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getCardImageUrl(c.imgFile)}
                        alt=""
                        className="w-8 h-11 object-cover rounded-sm flex-shrink-0 bg-muted"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground truncate">
                          {c.name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate">
                          {c.set} &middot; {c.type}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2.5 py-2">No cards match.</p>
                )}
              </div>
            </div>

            {/* Editor */}
            <div>
              {!selectedCard ? (
                <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    Search and select a card to edit its catalog metadata.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-6">
                  {/* Field grid — Task 11 slots an image panel in as a sibling here. */}
                  <div className="space-y-4 min-w-0">
                    {/* Identity strip */}
                    <div
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2"
                      title="Identity fields are immutable — decks reference cards by name|set"
                    >
                      <LockIcon />
                      <span className="text-sm font-medium text-foreground">
                        {selectedCard.name}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {selectedCard.set}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono truncate">
                        {selectedCard.imgFile}
                      </span>
                    </div>

                    {/* Field rows */}
                    <div className="rounded-lg border border-border divide-y divide-border/60">
                      {EDITABLE_FIELDS.map((field) => {
                        const overridden = field in overrides;
                        const liveValue = selectedCard[field];
                        return (
                          <div
                            key={field}
                            className={`grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] items-start gap-2 sm:gap-3 px-3 py-2.5 ${
                              overridden ? "border-l-2 border-foreground/40" : ""
                            }`}
                          >
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
                              {FIELD_LABELS[field]}
                            </label>
                            <div className="min-w-0">
                              {overridden ? (
                                MULTILINE_FIELDS.has(field) ? (
                                  <textarea
                                    rows={2}
                                    value={overrides[field] ?? ""}
                                    onChange={(e) =>
                                      setOverrides((prev) => ({ ...prev, [field]: e.target.value }))
                                    }
                                    className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground resize-y border-2 border-input placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40"
                                  />
                                ) : (
                                  <Input
                                    value={overrides[field] ?? ""}
                                    onChange={(e) =>
                                      setOverrides((prev) => ({ ...prev, [field]: e.target.value }))
                                    }
                                  />
                                )
                              ) : (
                                <p className="text-sm text-muted-foreground pt-2 truncate">
                                  {liveValue || "—"}
                                </p>
                              )}
                            </div>
                            <div className="pt-1">
                              {overridden ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => revertOverride(field)}
                                >
                                  Revert
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => applyOverride(field)}
                                >
                                  Override
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {/* Note + Save */}
                    <div className="space-y-2">
                      <Input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          hasOverrides
                            ? "Why this override? (required)"
                            : "Note (only needed with an override)"
                        }
                      />
                      <div className="flex items-center gap-3">
                        <Button onClick={handleSave} disabled={saving}>
                          {saving ? "Saving..." : "Save"}
                        </Button>
                        {existingRow && (
                          <button
                            onClick={handleDeleteOverride}
                            disabled={saving}
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            Delete override
                          </button>
                        )}
                      </div>
                    </div>

                    <AliasEditor
                      // Remount per card: a half-typed draft and its error must
                      // not read as a claim about the next card selected.
                      key={`${selectedCard.name}|${selectedCard.set}`}
                      card={selectedCard}
                      aliases={dbAliases}
                      pending={pendingAliasKeys}
                      onChange={setDbAliases}
                    />
                  </div>

                  {/* Image panel (Task 11, spec §6/§7 F2) */}
                  <div className="w-full space-y-4 xl:w-72">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Current image
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={currentSrc}
                        alt=""
                        className="w-full max-w-[172px] rounded-md border border-border bg-muted object-cover"
                        style={{ aspectRatio: `${CARD_IMAGE_WIDTH} / ${CARD_IMAGE_HEIGHT}` }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {currentVersion === 0 ? (
                          "Never replaced."
                        ) : (
                          <>
                            Version {currentVersion} &middot;{" "}
                            <a
                              href={`${blobBase}/card-images-archive/${selectedCard.imgFile}.v${currentVersion - 1}.jpg`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline hover:text-foreground"
                            >
                              previous version
                            </a>
                          </>
                        )}
                      </p>
                    </div>

                    {coOwners.length > 0 && (
                      <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
                        <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                          This image also serves:{" "}
                          {coOwners.map((c, i) => (
                            <span key={`${c.name}|${c.set}`} className="font-medium">
                              {i > 0 ? ", " : ""}
                              {c.name} ({c.set})
                            </span>
                          ))}
                          {" "}&mdash; replacing it changes those cards too.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Replace image
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        disabled={replacing}
                        className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/80 disabled:opacity-50"
                      />

                      {selectedFile && fileDims && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {fileDims.width}&times;{fileDims.height} &mdash; {imageClass}
                          </p>
                          {previewUrl && imageClass !== "crop" && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={previewUrl}
                              alt=""
                              className="w-full max-w-[172px] rounded-md border border-border"
                            />
                          )}
                          {previewUrl && imageClass === "crop" && transform && (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                {(["cover", "printer1", "printer2"] as const).map((key) => {
                                  const t: ReleaseImageTransform =
                                    key === "cover" ? { mode: "cover" } : { mode: "preset", preset: key as PresetKey };
                                  const active =
                                    key === "cover" ? transform.mode === "cover" : transform.mode === "preset" && transform.preset === key;
                                  return (
                                    <Button
                                      key={key}
                                      type="button"
                                      size="sm"
                                      variant={active ? "default" : "outline"}
                                      onClick={() => setTransform(t)}
                                    >
                                      {key === "cover" ? "Cover" : key === "printer1" ? "Printer 1" : "Printer 2"}
                                    </Button>
                                  );
                                })}
                              </div>
                              <ImageFramePreview src={previewUrl} transform={transform} />
                            </div>
                          )}
                        </div>
                      )}

                      <Input
                        value={imgNote}
                        onChange={(e) => setImgNote(e.target.value)}
                        placeholder="Note (optional)"
                      />

                      {imgError && <p className="text-sm text-destructive">{imgError}</p>}
                      {imgSuccess && <p className="text-sm text-foreground">{imgSuccess}</p>}

                      <Button onClick={handleReplace} disabled={!selectedFile || replacing}>
                        {replacing ? "Replacing..." : "Replace"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending tab */}
        {tab === "pending" && (
          <div className="space-y-4">
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                Everything here is deployed.
              </p>
            ) : (
              <>
                <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Run <code className="font-mono text-xs">make pull-card-overrides</code>, commit
                  the overlay + regenerated files, PR, deploy.
                </div>
                <ul className="space-y-1.5">
                  {pending.map((item) => (
                    <li
                      key={`${item.kind}-${item.key}`}
                      className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
                    >
                      <PendingKindBadge kind={item.kind} />
                      <span className="text-sm text-foreground">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
