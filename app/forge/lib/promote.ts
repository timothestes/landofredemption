"use server";

// Server actions for promoting a Forge set into the public card catalog (the
// "big red button"). Design: docs/superpowers/specs/2026-08-22-forge-public-set-release-design.md
// Superadmin-only: promoting publishes secret content irreversibly.
//
// The staged state machine (staged → images_done → live_verified →
// decks_migrated) lives in forge_public_releases.status; every action here is
// idempotently resumable. Until the image step runs, nothing leaves the private
// blob store.

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { requireForgeSuperadmin } from "@/app/forge/lib/auth";
import { requireSuperuser } from "@/app/admin/permissions/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";
import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import { foldQuotes } from "@/app/forge/lib/quotes";
import {
  catalogImgFileSlug, designCardToCatalogRow, parseImageTransform,
  type ReleaseImageTransform,
} from "@/app/forge/lib/catalogRow";
import { auditReleaseImage } from "@/app/forge/lib/releaseImage";
import {
  groupRoster, defaultSelection, isCloseEligible, type RosterEntry,
} from "@/app/forge/lib/releaseSelection";
import { CARDS, findCard } from "@/lib/cards/lookup";
import type { CardData } from "@/lib/cards/generated/cardData";

export type PromoteIssue = { code: string; message: string; cardId?: string; suggestion?: string };

export type PromotePreviewRow = CardData & { cardId: string; versionId: string };

export type PromoteReport = {
  setName: string;
  setStatus: string;
  /** Every non-archived card in the set, grouped for the selection UI. */
  roster: RosterEntry[];
  /** The selection this report was built for (default: all approved cards). */
  selectedCardIds: string[];
  /** Non-archived, non-promoted cards remaining in the set. */
  totalReleasable: number;
  /** True when this selection covers every remaining releasable card. */
  closeEligible: boolean;
  eligibleCount: number;
  excludedArchived: number;
  excludedPromoted: number;
  blockers: PromoteIssue[];
  warnings: PromoteIssue[];
  rows: PromotePreviewRow[];
};

export type ReleaseCardState = {
  cardId: string;
  versionId: string;
  name: string;
  imgFile: string;
  imageUploaded: boolean;
  transform: ReleaseImageTransform | null;
};

export type ReleaseState = {
  id: string;
  setId: string;
  setCode: string;
  officialSet: string;
  status: string; // staged | images_done | live_verified | decks_migrated
  cardCount: number;
  createdAt: string;
  cards: ReleaseCardState[];
  uploadedCount: number;
  /** Decks still holding forge refs to this release's cards (>= live_verified). */
  affectedDecks: number | null;
  /** Card names frozen without a scripture reference → need testament overrides. */
  missingReference: string[];
};

type Ctx = NonNullable<Awaited<ReturnType<typeof requireForgeSuperadmin>>>;

// ---------------------------------------------------------------------------
// Preflight: derive the frozen catalog rows and every blocker/warning (§5.1).
// Shared verbatim between the report action and the promote action so the
// button can never act on a stale report.
// ---------------------------------------------------------------------------

async function buildReport(
  ctx: Ctx, setId: string, setCode: string, officialSet: string,
  selectedCardIds?: string[],
): Promise<PromoteReport | null> {
  const { data: set } = await ctx.supabase
    .from("forge_sets")
    .select("id, name, status")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return null;

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, status, approved_version_id")
    .eq("set_id", setId);

  const blockers: PromoteIssue[] = [];
  const warnings: PromoteIssue[] = [];

  const all = cards ?? [];
  const excludedArchived = all.filter((c: any) => c.status === "archived").length;
  const excludedPromoted = all.filter((c: any) => c.status === "promoted").length;

  const roster = groupRoster(
    all.map((c: any) => ({
      id: c.id as string,
      title: (c.title as string | null) ?? null,
      status: c.status as string,
      approvedVersionId: (c.approved_version_id as string | null) ?? null,
    })),
  );
  const selection = selectedCardIds ?? defaultSelection(roster);
  const selectedSet = new Set(selection);
  const totalReleasable = roster.filter((r) => r.group !== "promoted").length;

  // Only SELECTED cards are validated and released; an unapproved card in the
  // set is simply not part of this wave (never a blocker unless selected).
  const byId = new Map(all.map((c: any) => [c.id as string, c]));
  for (const id of selection) {
    const c: any = byId.get(id);
    if (!c || c.status === "archived" || c.status === "promoted") {
      blockers.push({
        code: "not_releasable", cardId: id,
        message: "A selected card is no longer releasable — refresh and re-select.",
      });
    } else if (c.status !== "approved" || !c.approved_version_id) {
      blockers.push({
        code: "not_approved",
        cardId: c.id,
        message: `"${c.title ?? "Untitled"}" is ${c.status} — a card must be marked final to be released.`,
      });
    }
  }

  const approved = all.filter(
    (c: any) => selectedSet.has(c.id) && c.status === "approved" && c.approved_version_id,
  );
  const versionIds = approved.map((c: any) => c.approved_version_id as string);
  const versionsById = new Map<string, { data: DesignCard; finishedKey: string | null }>();
  if (versionIds.length > 0) {
    const { data: versions } = await ctx.supabase
      .from("card_versions")
      .select("id, data, finished_key")
      .in("id", versionIds);
    for (const v of versions ?? []) {
      versionsById.set(v.id as string, {
        data: (v.data ?? {}) as DesignCard,
        finishedKey: (v.finished_key as string | null) ?? null,
      });
    }
  }

  // --- Set identity checks (live-computed from CARDS + prior manifests) ---
  const code = setCode.trim();
  const official = officialSet.trim();
  if (!code) blockers.push({ code: "set_code_missing", message: "A set code is required." });
  if (code.length > 16) blockers.push({ code: "set_code_long", message: "Set code is too long (max 16)." });
  if (/\(AB\)/.test(code)) {
    blockers.push({ code: "set_code_ab", message: "Set codes must not match the alternate-art (AB) pattern." });
  }
  if (!official) blockers.push({ code: "official_set_missing", message: "An official set name is required." });

  const { data: priorReleases } = await ctx.supabase
    .from("forge_public_releases")
    .select("id, set_id, set_code, official_set, status");
  const prior = priorReleases ?? [];
  const foreignCode = prior.find((r: any) => r.set_code === code && r.set_id !== setId);
  if (code && foreignCode) {
    blockers.push({ code: "set_code_released", message: `Set code "${code}" already belongs to another released set.` });
  }
  const inFlight = prior.find((r: any) => r.set_id === setId && r.status !== "decks_migrated");
  if (inFlight) {
    blockers.push({ code: "release_in_flight", message: "A release for this set is already in progress — finish or abort it first." });
  }
  // Waves must keep the identity of the set's earlier releases (§3.3).
  const priorForSet = prior.find((r: any) => r.set_id === setId);
  if (priorForSet && (priorForSet.set_code !== code || priorForSet.official_set !== official)) {
    blockers.push({
      code: "wave_identity_mismatch",
      message: `This set already released as "${priorForSet.official_set}" (${priorForSet.set_code}) — follow-up waves must keep that identity.`,
    });
  }

  const upstreamCodes = new Set<string>();
  const upstreamOfficial = new Set<string>();
  const upstreamNamesLower = new Map<string, string>(); // lower → canonical
  const upstreamImgFiles = new Set<string>();
  for (const c of CARDS) {
    upstreamCodes.add(c.set);
    upstreamOfficial.add(c.officialSet.toLowerCase());
    const key = foldQuotes(c.name).toLowerCase();
    if (!upstreamNamesLower.has(key)) upstreamNamesLower.set(key, c.name);
    upstreamImgFiles.add(c.imgFile.toLowerCase());
  }
  const sameSetPrior = prior.some((r: any) => r.set_id === setId && r.set_code === code);
  if (code && upstreamCodes.has(code) && !sameSetPrior) {
    blockers.push({ code: "set_code_collision", message: `Set code "${code}" already exists in the public catalog.` });
  }
  if (official && upstreamOfficial.has(official.toLowerCase()) && !sameSetPrior) {
    blockers.push({ code: "official_set_collision", message: `Official set name "${official}" already exists in the public catalog.` });
  }

  // Names already released under this code (waves), and all prior manifest imgFiles.
  const priorIds = prior.map((r: any) => r.id as string);
  const priorNamesForCode = new Set<string>();
  const priorImgFiles = new Set<string>();
  if (priorIds.length > 0) {
    const { data: priorCards } = await ctx.supabase
      .from("forge_public_release_cards")
      .select("name, set_code, img_file")
      .in("release_id", priorIds);
    for (const pc of priorCards ?? []) {
      if (pc.set_code === code) priorNamesForCode.add((pc.name as string).toLowerCase());
      priorImgFiles.add((pc.img_file as string).toLowerCase());
    }
  }

  // --- Per-card rows + identity checks ---
  const rows: PromotePreviewRow[] = [];
  const seenNames = new Map<string, string>(); // lower name → cardId
  const seenImgs = new Map<string, string>();
  for (const c of approved) {
    const version = versionsById.get(c.approved_version_id as string);
    if (!version) {
      blockers.push({ code: "version_missing", cardId: c.id, message: `"${c.title}" — approved version could not be read.` });
      continue;
    }
    const data = version.data;
    // Forge names carry the curly quotes print uses; the public catalog's names are typed by
    // players and looked up exactly (findCard), so a released name gets straight ones.
    const name = foldQuotes((data.name ?? c.title ?? "").trim());
    if (!name) {
      blockers.push({ code: "name_missing", cardId: c.id, message: "A card has no name." });
      continue;
    }
    if (!version.finishedKey) {
      blockers.push({ code: "no_finished_image", cardId: c.id, message: `"${name}" has no finished card image on its approved version.` });
    }

    const imgFile = catalogImgFileSlug(name, code || "SET");
    const row = designCardToCatalogRow(data, {
      name, set: code, officialSet: official, imageFile: imgFile,
    });
    rows.push({ ...row, cardId: c.id as string, versionId: c.approved_version_id as string });

    const lower = name.toLowerCase();
    const dupOf = seenNames.get(lower);
    if (dupOf) {
      blockers.push({ code: "dup_name", cardId: c.id, message: `Two cards in this set are named "${name}".` });
    } else {
      seenNames.set(lower, c.id);
    }
    const imgLower = imgFile.toLowerCase();
    if (seenImgs.has(imgLower) && !dupOf) {
      blockers.push({ code: "dup_img", cardId: c.id, message: `"${name}" — image file "${imgFile}" collides within the set.` });
    } else {
      seenImgs.set(imgLower, c.id);
    }

    // Case-insensitive collision with the public catalog (findCard's last
    // fallback is lowercased, so "Red dragon" vs "Red Dragon" is real).
    const publicHit = upstreamNamesLower.get(lower);
    if (publicHit !== undefined) {
      blockers.push({
        code: "public_name_collision",
        cardId: c.id,
        message: `"${name}" collides with the public card "${publicHit}" — reprints resolve with a set-code suffix.`,
        suggestion: `${name} (${code || "SET"})`,
      });
    }
    if (code && priorNamesForCode.has(lower)) {
      blockers.push({ code: "released_name_collision", cardId: c.id, message: `"${name}" was already released under set code ${code}.` });
    }
    if (upstreamImgFiles.has(imgLower) || (priorImgFiles.has(imgLower) && !sameSetPrior)) {
      blockers.push({ code: "public_img_collision", cardId: c.id, message: `"${name}" — image file "${imgFile}" already exists in the public image store.` });
    }

    if (!row.type) blockers.push({ code: "type_missing", cardId: c.id, message: `"${name}" has no card type.` });
    if (!row.alignment) blockers.push({ code: "alignment_missing", cardId: c.id, message: `"${name}" has no alignment.` });

    if (!row.reference) {
      warnings.push({ code: "no_reference", cardId: c.id, message: `"${name}" has no scripture reference — it will need a testament override (TESTAMENT_OVERRIDES) in a follow-up code PR.` });
    }
    if (!row.rarity) warnings.push({ code: "no_rarity", cardId: c.id, message: `"${name}" has no rarity.` });
    if (!data.legality) {
      warnings.push({ code: "legality_defaulted", cardId: c.id, message: `"${name}" has no explicit legality — it freezes as Rotation (tournament-legal).` });
    }
    if (!cardRawText(data) && (data.cardType ?? []).some((t) => t === "GE" || t === "EE" || t === "Artifact" || t === "Dominant")) {
      warnings.push({ code: "no_ability", cardId: c.id, message: `"${name}" has no special ability text.` });
    }
  }

  if (rows.length === 0) {
    blockers.push({ code: "no_cards", message: "No releasable cards in this set." });
  }

  return {
    setName: set.name,
    setStatus: set.status,
    roster,
    selectedCardIds: selection,
    totalReleasable,
    closeEligible: blockers.length === 0 && isCloseEligible(roster, selection),
    eligibleCount: rows.length,
    excludedArchived,
    excludedPromoted,
    blockers,
    warnings,
    rows,
  };
}

export async function getPromoteReport(
  setId: string, setCode: string, officialSet: string, selectedCardIds?: string[],
): Promise<PromoteReport | null> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return null;
  return buildReport(ctx, setId, setCode, officialSet, selectedCardIds);
}

// ---------------------------------------------------------------------------
// Promote (§5.2): freeze the manifest. Preflight re-runs server-side so the
// button can never act on a stale report.
// ---------------------------------------------------------------------------

export async function promoteSet(
  setId: string, setCode: string, officialSet: string,
  selectedCardIds: string[] | undefined, closeSet: boolean,
): Promise<{ ok: true; releaseId: string } | { ok: false; error: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const report = await buildReport(ctx, setId, setCode, officialSet, selectedCardIds);
  if (!report) return { ok: false, error: "Set not found" };
  if (report.blockers.length > 0) {
    return { ok: false, error: `Preflight has ${report.blockers.length} blocker(s) — refresh the report.` };
  }
  if (closeSet && !report.closeEligible) {
    return { ok: false, error: "Cannot close the set — this release does not cover every remaining card." };
  }

  const rows = report.rows.map((r) => ({
    card_id: r.cardId,
    version_id: r.versionId,
    name: r.name,
    img_file: r.imgFile,
    type: r.type,
    brigade: r.brigade,
    strength: r.strength,
    toughness: r.toughness,
    class: r.class,
    identifier: r.identifier,
    special_ability: r.specialAbility,
    rarity: r.rarity,
    reference: r.reference,
    alignment: r.alignment,
    legality: r.legality,
  }));

  const { data, error } = await ctx.supabase.rpc("forge_promote_set", {
    p_set_id: setId,
    p_set_code: setCode.trim(),
    p_official_set: officialSet.trim(),
    p_rows: rows,
    p_close_set: closeSet,
  });
  if (error || typeof data !== "string") {
    return { ok: false, error: error?.message ?? "Promote failed" };
  }
  revalidatePath("/forge", "layout");
  return { ok: true, releaseId: data };
}

// One-click preflight fix for a public-name collision: rename through the
// normal edit → publish → approve path so the fix is versioned. OVERWRITES the
// working draft with the approved snapshot + new name (stated in the UI copy).
export async function applyRenameFix(
  cardId: string, newName: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const name = newName.trim();
  if (!name) return { ok: false, error: "A name is required" };

  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("id, status, approved_version_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.status !== "approved" || !card.approved_version_id) {
    return { ok: false, error: "Only an approved card can take a promote-time rename" };
  }
  const { data: version } = await ctx.supabase
    .from("card_versions")
    .select("data")
    .eq("id", card.approved_version_id)
    .maybeSingle();
  if (!version) return { ok: false, error: "Approved version could not be read" };

  const snapshot = { ...((version.data ?? {}) as DesignCard), name };
  // Approved cards can't republish directly — reopen, save, publish, re-approve.
  const un = await ctx.supabase.rpc("forge_unapprove_card", { p_card_id: cardId });
  if (un.error) return { ok: false, error: un.error.message };
  const save = await ctx.supabase.rpc("forge_save_card", { p_card_id: cardId, p_snapshot: snapshot });
  if (save.error) return { ok: false, error: save.error.message };
  const pub = await ctx.supabase.rpc("forge_publish_card", {
    p_card_id: cardId, p_note: "Promote preflight rename",
  });
  if (pub.error) return { ok: false, error: pub.error.message };
  const app = await ctx.supabase.rpc("forge_approve_card", { p_card_id: cardId });
  if (app.error) return { ok: false, error: app.error.message };
  revalidatePath("/forge", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Release state + image audit (staged step)
// ---------------------------------------------------------------------------

export async function getReleaseState(setId: string): Promise<ReleaseState | null> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return null;
  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("id, set_id, set_code, official_set, status, card_count, created_at")
    .eq("set_id", setId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!release) return null;

  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("card_id, version_id, name, img_file, image_uploaded, image_transform, reference")
    .eq("release_id", release.id)
    .order("name", { ascending: true });

  const cardStates: ReleaseCardState[] = (cards ?? []).map((c: any) => ({
    cardId: c.card_id,
    versionId: c.version_id,
    name: c.name,
    imgFile: c.img_file,
    imageUploaded: c.image_uploaded === true,
    transform: parseImageTransform(c.image_transform),
  }));

  let affectedDecks: number | null = null;
  if (release.status === "live_verified" || release.status === "decks_migrated") {
    const { data: count } = await ctx.supabase.rpc("forge_count_release_decks", {
      p_release_id: release.id,
    });
    if (typeof count === "number") affectedDecks = count;
  }

  return {
    id: release.id,
    setId: release.set_id,
    setCode: release.set_code,
    officialSet: release.official_set,
    status: release.status,
    cardCount: release.card_count,
    createdAt: release.created_at,
    cards: cardStates,
    uploadedCount: cardStates.filter((c) => c.imageUploaded).length,
    affectedDecks,
    missingReference: (cards ?? [])
      .filter((c: any) => !(c.reference ?? "").trim())
      .map((c: any) => c.name as string),
  };
}

export type ImageAuditRow = {
  cardId: string;
  name: string;
  imgFile: string;
  width: number;
  height: number;
  aspect: number;
  imageClass: "exact" | "resize" | "crop" | "error";
  transform: ReleaseImageTransform | null;
  error?: string;
};

// Measures every un-uploaded finished image and classifies it against the §6
// rules. Class "crop" cards need a decision (default center cover-crop applies
// if none is stored). Reads each private blob — a full-set audit is a few MB of
// internal reads, run on demand from the release page.
export async function auditReleaseImages(releaseId: string): Promise<ImageAuditRow[] | null> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return null;
  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("card_id, version_id, name, img_file, image_uploaded, image_transform")
    .eq("release_id", releaseId)
    .order("name", { ascending: true });
  const pending = (cards ?? []).filter((c: any) => c.image_uploaded !== true);
  if (pending.length === 0) return [];

  const versionIds = pending.map((c: any) => c.version_id as string);
  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, finished_key")
    .in("id", versionIds);
  const keyByVersion = new Map<string, string | null>(
    (versions ?? []).map((v: any) => [v.id as string, (v.finished_key as string | null) ?? null]),
  );

  const CONCURRENCY = 8;
  const out: ImageAuditRow[] = [];
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (c: any): Promise<ImageAuditRow> => {
        const base = {
          cardId: c.card_id as string,
          name: c.name as string,
          imgFile: c.img_file as string,
          transform: parseImageTransform(c.image_transform),
        };
        try {
          const key = keyByVersion.get(c.version_id as string);
          if (!key) throw new Error("no finished image");
          const blob = await readForgeArt(key);
          if (!blob || blob.statusCode !== 200) throw new Error("image unreadable");
          const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
          const info = await auditReleaseImage(buffer);
          return { ...base, ...info };
        } catch (e) {
          return {
            ...base, width: 0, height: 0, aspect: 0, imageClass: "error",
            error: e instanceof Error ? e.message : "unreadable",
          };
        }
      }),
    );
    out.push(...results);
  }
  return out;
}

export async function setReleaseImageTransform(
  releaseId: string, cardId: string, transform: ReleaseImageTransform | null,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_set_release_image_transform", {
    p_release_id: releaseId,
    p_card_id: cardId,
    p_transform: transform,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Abort (§4): the amendment path before anything merged or verified. Deletes
// the already-public blobs first (recorded by image_uploaded), then reverts.
// ---------------------------------------------------------------------------

/**
 * Card names in this release that carry catalog-editor overrides. Aborting the
 * release after its overlay has been pulled turns these into codegen-blocking
 * orphans (catalog-editor spec F7) — the abort confirm must say so.
 *
 * Gated on requireSuperuser(), not requireForgeSuperadmin(): card_overrides RLS
 * (migration 092) admits only public.is_superuser() — the single hardcoded app
 * superuser — by design (spec §4). A forge superadmin who isn't that UID gets a
 * silently empty read here and won't see this warning; for them the codegen
 * orphan error (parse-carddata, spec §5.2) is the backstop that names the
 * recovery path.
 */
/** Cards in this release carrying a catalog edit — an override or an alias. */
export async function listReleaseOverrides(releaseId: string): Promise<string[]> {
  const ctx = await requireSuperuser();
  if (!ctx) return [];
  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("set_code")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return [];
  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("name")
    .eq("release_id", releaseId);
  const names = new Set((cards ?? []).map((c) => c.name as string));
  if (names.size === 0) return [];
  // No .in() with card names — quoted names corrupt PostgREST in-lists (#290).
  //
  // Aliases count too: applyCardAliases errors on an orphan exactly the way
  // applyCardOverrides does, so an alias on a card this release is about to
  // withdraw blocks the catalog codegen just as hard.
  const [{ data: overrides }, { data: aliases }] = await Promise.all([
    ctx.supabase.from("card_overrides").select("card_name").eq("set_code", release.set_code),
    ctx.supabase.from("card_aliases").select("card_name").eq("set_code", release.set_code),
  ]);
  const edited = [
    ...(overrides ?? []).map((o) => o.card_name as string),
    ...(aliases ?? []).map((a) => a.card_name as string),
  ];
  return [...new Set(edited.filter((n) => names.has(n)))];
}

export async function abortRelease(
  releaseId: string,
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const { data: release } = await ctx.supabase
    .from("forge_public_releases")
    .select("id, status")
    .eq("id", releaseId)
    .maybeSingle();
  if (!release) return { ok: false, error: "Release not found" };
  if (release.status !== "staged" && release.status !== "images_done") {
    return { ok: false, error: "This release can no longer be aborted" };
  }

  const { data: uploaded } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("img_file")
    .eq("release_id", releaseId)
    .eq("image_uploaded", true);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if ((uploaded ?? []).length > 0 && token) {
    for (const row of uploaded ?? []) {
      try {
        await del(`card-images/${row.img_file}.jpg`, { token });
      } catch {
        // Best-effort: an orphaned public blob for an aborted release is inert
        // (nothing references the imgFile) and a re-promote overwrites it.
      }
    }
  }

  const { error } = await ctx.supabase.rpc("forge_abort_release", { p_release_id: releaseId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/forge", "layout");

  // §5.5: a build whose overlay fetch landed during the images_done window
  // shipped rows whose images we just deleted above. Fire the deploy hook so
  // a rebuild reverts to the catalog without this aborted release's cards.
  if (release.status === "images_done") {
    const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
    let hookOk = false;
    if (hookUrl) {
      try {
        const res = await fetch(hookUrl, { method: "POST" });
        hookOk = res.ok;
      } catch {
        hookOk = false;
      }
    }
    if (!hookOk) {
      return {
        ok: true,
        warning:
          "Aborted, but the catalog redeploy could not be triggered — press Deploy catalog or merge to main to purge the aborted cards.",
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Verify-live (§5.5): this deployment's own CARDS must resolve every manifest
// row EXACTLY — findCard alone is not enough (its name-only and lowercased
// fallbacks could false-positively "verify" against a different card).
// ---------------------------------------------------------------------------

export async function verifyReleaseLive(
  releaseId: string,
): Promise<{ ok: boolean; verified: number; failures: string[]; error?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, verified: 0, failures: [], error: "Not authorized" };

  const { data: cards } = await ctx.supabase
    .from("forge_public_release_cards")
    .select("name, set_code, img_file")
    .eq("release_id", releaseId);
  if (!cards || cards.length === 0) {
    return { ok: false, verified: 0, failures: [], error: "Release has no cards" };
  }

  const failures: string[] = [];
  for (const row of cards) {
    const found = findCard(row.name, row.set_code);
    const exact =
      found !== undefined &&
      found.name === row.name &&
      found.set === row.set_code &&
      found.imgFile === row.img_file;
    if (!exact) failures.push(`${row.name} (${row.set_code})`);
  }
  if (failures.length > 0) {
    return { ok: false, verified: cards.length - failures.length, failures };
  }

  const { error } = await ctx.supabase.rpc("forge_mark_release_live", { p_release_id: releaseId });
  if (error) return { ok: false, verified: cards.length, failures: [], error: error.message };
  revalidatePath("/forge", "layout");
  return { ok: true, verified: cards.length, failures: [] };
}

// ---------------------------------------------------------------------------
// Deploy catalog: fires the Vercel deploy hook so an ordinary main deploy
// (Task 14's build-time overlay fetch) picks up this release. Replaces the
// two-PR merge card.
// ---------------------------------------------------------------------------

export async function deployCatalog(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, error: "Not authorized" };

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) return { ok: false, error: "VERCEL_DEPLOY_HOOK_URL is not configured" };

  try {
    const res = await fetch(hookUrl, { method: "POST" });
    if (!res.ok) return { ok: false, error: `deploy hook returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "deploy hook request failed" };
  }
}

// ---------------------------------------------------------------------------
// Deck migration (§5.6): forge refs → public entries, verify-gated.
// ---------------------------------------------------------------------------

export async function migrateReleaseDecks(
  releaseId: string,
): Promise<{ ok: boolean; migrated: number; error?: string }> {
  const ctx = await requireForgeSuperadmin();
  if (!ctx) return { ok: false, migrated: 0, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_migrate_release_decks", {
    p_release_id: releaseId,
  });
  if (error) return { ok: false, migrated: 0, error: error.message };
  revalidatePath("/forge", "layout");
  return { ok: true, migrated: typeof data === "number" ? data : 0 };
}
