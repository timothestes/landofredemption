import { revalidatePath } from "next/cache";
import { requireElder, notFoundResponse } from "@/app/forge/lib/auth";
import { uploadForgeFinished, validateArtFile } from "@/app/forge/lib/art";
import { pgrestInList } from "@/lib/pricing/helpers";
import { isEmptyPatch } from "@/app/forge/lib/cardSave";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { overwritePatch, type RowPreview } from "@/app/forge/import/overwrite";

export const dynamic = "force-dynamic";

// Batched Lackey import endpoint. A route handler (not a Server Action) because Next
// serializes Server Action calls from one client — batches posted here genuinely run in
// parallel. Elder-gated; every write still goes through the existing SECURITY DEFINER
// RPCs, which re-check authorization — same trust model as the rest of the Forge.

const MAX_CARDS_PER_BATCH = 12;
const MAX_PAYLOAD_CHARS = 512_000;
const MAX_NAME_LENGTH = 200;
const MAX_SNAPSHOT_BYTES = 32_000; // forge_save_card enforces 64KB; fail earlier & clearer

// `derived`: snapshot keys the parser filled in with no cell behind them, which only the
// route's caller can know. See overwritePatch.
interface BatchCard { name?: string; snapshot?: DesignCard; fileField?: string; derived?: string[] }
interface CardResult {
  name: string; ok: boolean; cardId?: string; skipped?: boolean; updated?: boolean; unchanged?: boolean;
  preview?: RowPreview; error?: string;
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireElder();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Invalid form data");
  }
  const raw = form.get("payload");
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_CHARS) return badRequest("Invalid payload");
  let payload: { setId?: unknown; cards?: unknown; overwrite?: unknown; preview?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return badRequest("Invalid payload");
  }
  const setId = typeof payload.setId === "string" ? payload.setId : "";
  const cards = Array.isArray(payload.cards) ? (payload.cards as BatchCard[]) : [];
  const overwrite = payload.overwrite === true;
  // The overwrite confirm step: says what each row would do, and writes nothing.
  const preview = payload.preview === true;
  if (!setId || cards.length === 0 || cards.length > MAX_CARDS_PER_BATCH) {
    return badRequest("Invalid batch");
  }

  // One RLS-scoped round trip covers the whole batch's duplicate check.
  const names = cards.map((c) => (c?.name ?? "").trim()).filter(Boolean);
  const { data: existing, error: existErr } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, working_snapshot")
    .eq("set_id", setId)
    .filter("title", "in", pgrestInList(names)); // .in() can't take a quoted Lost Soul name
  if (existErr) return badRequest(existErr.message);
  const existingByTitle = new Map(
    (existing ?? []).map((r: { id: string; title: string; working_snapshot: DesignCard }) => [r.title, r]),
  );

  const results: CardResult[] = await Promise.all(
    cards.map(async (card, i): Promise<CardResult> => {
      const name = (card?.name ?? "").trim();
      if (!name || name.length > MAX_NAME_LENGTH) {
        return { name: name || `card ${i + 1}`, ok: false, error: "Invalid card name" };
      }
      try {
        if (new TextEncoder().encode(JSON.stringify(card.snapshot ?? {})).length > MAX_SNAPSHOT_BYTES) {
          return { name, ok: false, error: "Card data too large" };
        }
      } catch {
        return { name, ok: false, error: "Invalid card data" };
      }

      const fileEntry = typeof card.fileField === "string" ? form.get(card.fileField) : null;
      if (fileEntry !== null && !(fileEntry instanceof File)) return { name, ok: false, error: "Invalid image" };
      // Explicit re-narrow: with strict:false, TS won't narrow FormDataEntryValue via the guard above.
      const file = fileEntry instanceof File ? fileEntry : null;
      if (file) {
        const invalid = validateArtFile(file);
        if (invalid) return { name, ok: false, error: invalid };
      }

      // Idempotency: a card with this title already in the target set → skip (safe re-runs),
      // unless overwrite is on — then merge what the row carries into its working draft, and
      // replace its finished image if the row has one. A row that changes nothing writes nothing.
      const dup = existingByTitle.get(name);
      const dupId = dup?.id;
      const patch = dup && overwritePatch(
        dup.working_snapshot ?? {},
        card.snapshot ?? {},
        Array.isArray(card.derived) ? card.derived : [],
      );

      if (preview) {
        return { name, ok: true, cardId: dupId, preview: !patch ? "new" : isEmptyPatch(patch) ? "unchanged" : "changed" };
      }

      if (dupId && !overwrite) return { name, ok: true, cardId: dupId, skipped: true };

      if (dupId && overwrite) {
        const changed = !isEmptyPatch(patch);
        if (changed) {
          const { error: saveErr } = await ctx.supabase.rpc("forge_save_card_fields", {
            p_card_id: dupId, p_set: patch.set, p_remove: patch.remove,
          });
          if (saveErr) return { name, ok: false, error: saveErr.message };
        }

        if (file) {
          let key: string;
          try {
            key = await uploadForgeFinished(Buffer.from(await file.arrayBuffer()));
          } catch {
            return { name, ok: false, error: "Image upload failed" };
          }
          const { error: artErr } = await ctx.supabase
            .rpc("forge_set_working_finished", { p_card_id: dupId, p_key: key });
          if (artErr) return { name, ok: false, error: artErr.message };
        }

        return changed || file
          ? { name, ok: true, cardId: dupId, updated: true }
          : { name, ok: true, cardId: dupId, unchanged: true };
      }

      const { data: cardId, error: createErr } = await ctx.supabase
        .rpc("forge_create_card", { p_title: name });
      if (createErr || !cardId) {
        return { name, ok: false, error: createErr?.message ?? "Failed to create card" };
      }

      const { error: saveErr } = await ctx.supabase
        .rpc("forge_save_card", { p_card_id: cardId, p_snapshot: card.snapshot ?? {} });
      if (saveErr) return { name, ok: false, error: saveErr.message };

      if (file) {
        let key: string;
        try {
          key = await uploadForgeFinished(Buffer.from(await file.arrayBuffer()));
        } catch {
          return { name, ok: false, error: "Image upload failed" };
        }
        const { error: artErr } = await ctx.supabase
          .rpc("forge_set_working_finished", { p_card_id: cardId, p_key: key });
        if (artErr) return { name, ok: false, error: artErr.message };
      }

      const { error: shareErr } = await ctx.supabase
        .rpc("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId });
      if (shareErr) return { name, ok: false, error: shareErr.message };

      return { name, ok: true, cardId: cardId as string, skipped: false };
    }),
  );

  if (!preview) revalidatePath(`/forge/sets/${setId}/cards`);
  return Response.json({ results });
}
