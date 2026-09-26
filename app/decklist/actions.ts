"use server";

import { createClient } from "../../utils/supabase/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { checkDeck } from "@/utils/deckcheck";
import type { DeckCheckCard, DeckCheckResult } from "@/utils/deckcheck/types";
import type { DeckZone } from "./card-search/types/deck";
import { deckFormatFilterFor } from "@/lib/api/cache";
import { loadDeckTournamentContext, type DeckTournamentContext } from "./deckTournamentContext";

// Three-state deck visibility. Mirrors the `visibility` column on `decks`.
//   private  -> owner only
//   unlisted -> anyone with the link can view; hidden from community/sitemap
//   public   -> viewable by link AND listed in community search
export type DeckVisibility = "private" | "unlisted" | "public";

// Types matching the database schema
export interface DeckData {
  id?: string;
  user_id?: string;
  name: string;
  description?: string;
  format?: string;
  paragon?: string;
  folder_id?: string | null;
  is_public?: boolean;
  visibility?: DeckVisibility;
  card_count?: number;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  created_at?: string;
  updated_at?: string;
  tags?: GlobalTag[];
  total_price?: number | null;
  budget_price?: number | null;
}

export interface DeckCardData {
  id?: string;
  deck_id?: string;
  card_name: string;
  card_set?: string;
  card_img_file?: string;
  quantity: number;
  zone: DeckZone;
}

export interface SaveDeckParams {
  deckId?: string; // If provided, update existing deck; if not, create new
  name: string;
  description?: string;
  format?: string;
  paragon?: string;
  folderId?: string | null;
  cards: DeckCardData[];
  previewCard1?: string | null; // card_img_file for preview
  previewCard2?: string | null;
}

/**
 * Save a deck (create new or update existing)
 */
export async function saveDeckAction(params: SaveDeckParams) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to save a deck",
      };
    }

    const { deckId, name, description, format, paragon, folderId, cards, previewCard1, previewCard2 } = params;

    // Calculate card count (main deck only — reserve and maybeboard excluded)
    const cardCount = cards
      .filter(card => card.zone === 'main')
      .reduce((sum, card) => sum + card.quantity, 0);

    if (deckId) {
      // Update existing deck
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .update({
          name,
          description: description || null,
          format: format || null,
          paragon: paragon || null,
          folder_id: folderId || null,
          card_count: cardCount,
          preview_card_1: previewCard1 ?? null,
          preview_card_2: previewCard2 ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deckId)
        .eq("user_id", user.id) // Ensure user owns the deck
        .select()
        .single();

      if (deckError) {
        console.error("Error updating deck:", deckError);
        return {
          success: false,
          error: "Failed to update deck",
        };
      }

      // Atomically replace deck cards — if insert fails, delete rolls back too
      const cardsForRpc = cards.map((card) => ({
        card_name: card.card_name,
        card_set: card.card_set || null,
        card_img_file: card.card_img_file || null,
        quantity: card.quantity,
        zone: card.zone ?? 'main',
      }));

      const { error: replaceError } = await supabase.rpc("replace_deck_cards", {
        p_deck_id: deckId,
        p_cards: cardsForRpc,
      });

      if (replaceError) {
        console.error("Error replacing deck cards:", replaceError);
        return {
          success: false,
          error: "Failed to save deck cards",
        };
      }

      // Run comprehensive deck legality check (maybeboard excluded — scratchpad)
      let deckCheckResult: DeckCheckResult | null = null;
      try {
        const mainCards: DeckCheckCard[] = cards
          .filter(c => c.zone === 'main')
          .map(c => ({ name: c.card_name, set: c.card_set || "", quantity: c.quantity }));
        const reserveCards: DeckCheckCard[] = cards
          .filter(c => c.zone === 'reserve')
          .map(c => ({ name: c.card_name, set: c.card_set || "", quantity: c.quantity }));

        deckCheckResult = await checkDeck(mainCards, reserveCards, params.format);

        await supabase
          .from("decks")
          .update({
            is_legal: deckCheckResult.valid,
            deckcheck_issues: deckCheckResult.issues,
          })
          .eq("id", deckId);
      } catch (e) {
        // Deckcheck failure should not block save
        console.error("Deckcheck failed:", e);
      }

      revalidatePath("/decklist/my-decks");
      revalidatePath(`/decklist/card-search`);
      revalidateTag("public-decks-list");
      revalidateTag(`public-deck:${deckId}`);

      return {
        success: true,
        deckId: deck.id,
        message: "Deck updated successfully",
        deckCheckResult,
      };
    } else {
      // Create new deck
      const { data: deck, error: deckError } = await supabase
        .from("decks")
        .insert({
          user_id: user.id,
          name,
          description: description || null,
          format: format || null,
          paragon: paragon || null,
          folder_id: folderId || null,
          card_count: cardCount,
          preview_card_1: previewCard1 ?? null,
          preview_card_2: previewCard2 ?? null,
        })
        .select()
        .single();

      if (deckError) {
        console.error("Error creating deck:", deckError);
        return {
          success: false,
          error: "Failed to create deck",
        };
      }

      // Insert cards in batches to avoid payload size limits
      if (cards.length > 0) {
        const cardsToInsert = cards.map((card) => ({
          deck_id: deck.id,
          card_name: card.card_name,
          card_set: card.card_set || null,
          card_img_file: card.card_img_file || null,
          quantity: card.quantity,
          zone: card.zone,
        }));

        const BATCH_SIZE = 500;
        for (let i = 0; i < cardsToInsert.length; i += BATCH_SIZE) {
          const batch = cardsToInsert.slice(i, i + BATCH_SIZE);
          const { error: insertError } = await supabase
            .from("deck_cards")
            .insert(batch);

          if (insertError) {
            console.error(`Error inserting deck cards batch ${Math.floor(i / BATCH_SIZE) + 1}:`, insertError);
            // Rollback: delete the deck we just created
            await supabase.from("decks").delete().eq("id", deck.id);
            return {
              success: false,
              error: "Failed to save deck cards",
            };
          }
        }
      }

      // Run comprehensive deck legality check (maybeboard excluded — scratchpad)
      let deckCheckResult: DeckCheckResult | null = null;
      try {
        const mainCards: DeckCheckCard[] = cards
          .filter(c => c.zone === 'main')
          .map(c => ({ name: c.card_name, set: c.card_set || "", quantity: c.quantity }));
        const reserveCards: DeckCheckCard[] = cards
          .filter(c => c.zone === 'reserve')
          .map(c => ({ name: c.card_name, set: c.card_set || "", quantity: c.quantity }));

        deckCheckResult = await checkDeck(mainCards, reserveCards, params.format);

        await supabase
          .from("decks")
          .update({
            is_legal: deckCheckResult.valid,
            deckcheck_issues: deckCheckResult.issues,
          })
          .eq("id", deck.id);
      } catch (e) {
        // Deckcheck failure should not block save
        console.error("Deckcheck failed:", e);
      }

      revalidatePath("/decklist/my-decks");

      return {
        success: true,
        deckId: deck.id,
        message: "Deck created successfully",
        deckCheckResult,
      };
    }
  } catch (error) {
    console.error("Error in saveDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Load all decks for the current user
 */
export async function loadUserDecksAction() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view your decks",
        decks: [],
      };
    }

    const { data: decks, error } = await supabase
      .from("decks")
      .select(`
        *,
        deck_cards (
          quantity,
          zone
        )
      `)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error loading decks:", error);
      return {
        success: false,
        error: "Failed to load decks",
        decks: [],
      };
    }

    // Calculate main deck count for each deck from the actual cards
    const deckIds = (decks || []).map((d: any) => d.id).filter(Boolean);
    let tagsMap = new Map<string, GlobalTag[]>();
    if (deckIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("deck_tags")
        .select("deck_id, global_tags(id, name, color)")
        .in("deck_id", deckIds);
      for (const row of tagRows || []) {
        if (!row.global_tags) continue;
        const existing = tagsMap.get(row.deck_id) || [];
        existing.push(row.global_tags as unknown as GlobalTag);
        tagsMap.set(row.deck_id, existing);
      }
    }

    // Batch-fetch total prices and budget prices for all returned decks
    let priceMap = new Map<string, number>();
    let budgetPriceMap = new Map<string, number>();
    if (deckIds.length > 0) {
      const [priceResult, budgetResult] = await Promise.all([
        supabase.rpc("get_deck_total_prices", { deck_ids: deckIds }),
        supabase.rpc("get_deck_budget_prices", { deck_ids: deckIds }),
      ]);

      if (priceResult.error) {
        console.error("Error fetching deck prices:", priceResult.error);
      }
      for (const row of (priceResult.data || []) as any[]) {
        if (row.total_price > 0) {
          priceMap.set(row.deck_id, parseFloat(row.total_price));
        }
      }

      if (budgetResult.error) {
        console.error("Error fetching budget prices:", budgetResult.error);
      }
      for (const row of (budgetResult.data || []) as any[]) {
        if (row.budget_price > 0) {
          budgetPriceMap.set(row.deck_id, parseFloat(row.budget_price));
        }
      }
    }

    const decksWithCounts = (decks || []).map((deck: any) => {
      const mainDeckCount = (deck.deck_cards || [])
        .filter((card: any) => card.zone === 'main')
        .reduce((sum: number, card: any) => sum + card.quantity, 0);

      return {
        ...deck,
        card_count: mainDeckCount,
        deck_cards: undefined,
        tags: tagsMap.get(deck.id) || [],
        total_price: priceMap.get(deck.id) || null,
        budget_price: budgetPriceMap.get(deck.id) || null,
      };
    });

    return {
      success: true,
      decks: decksWithCounts,
    };
  } catch (error) {
    console.error("Error in loadUserDecksAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      decks: [],
    };
  }
}

/**
 * Load a specific deck by ID with all its cards
 */
export async function loadDeckByIdAction(deckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view this deck",
        deck: null,
      };
    }

    // Load deck
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("*")
      .eq("id", deckId)
      .single();

    if (deckError) {
      console.error("Error loading deck:", deckError);
      return {
        success: false,
        error: "Deck not found",
        deck: null,
      };
    }

    // Check permissions (user owns deck or deck is public)
    if (deck.user_id !== user.id && !deck.is_public) {
      return {
        success: false,
        error: "You don't have permission to view this deck",
        deck: null,
      };
    }

    // Load deck cards — paginate past Supabase's default 1000-row limit
    let cards: any[] = [];
    {
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from("deck_cards")
          .select("*")
          .eq("deck_id", deckId)
          .order("card_name")
          .range(offset, offset + PAGE_SIZE - 1);

        if (batchError) {
          console.error("Error loading deck cards:", batchError);
          return {
            success: false,
            error: "Failed to load deck cards",
            deck: null,
          };
        }

        cards = cards.concat(batch || []);
        hasMore = (batch?.length || 0) === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
    }

    return {
      success: true,
      deck: {
        ...deck,
        cards: cards || [],
      },
      isOwner: deck.user_id === user.id,
    };
  } catch (error) {
    console.error("Error in loadDeckByIdAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      deck: null,
    };
  }
}

/**
 * Delete a deck
 */
export async function deleteDeckAction(deckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to delete a deck",
      };
    }

    // Delete deck (cards will be cascade deleted)
    const { error } = await supabase
      .from("decks")
      .delete()
      .eq("id", deckId)
      .eq("user_id", user.id); // Ensure user owns the deck

    if (error) {
      console.error("Error deleting deck:", error);
      return {
        success: false,
        error: "Failed to delete deck",
      };
    }

    revalidatePath("/decklist/my-decks");
    revalidateTag("public-decks-list");
    revalidateTag(`public-deck:${deckId}`);

    return {
      success: true,
      message: "Deck deleted successfully",
    };
  } catch (error) {
    console.error("Error in deleteDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Duplicate a deck
 */
export async function duplicateDeckAction(deckId: string, newName?: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to duplicate a deck",
      };
    }

    // Load the original deck
    const loadResult = await loadDeckByIdAction(deckId);
    if (!loadResult.success || !loadResult.deck) {
      return {
        success: false,
        error: loadResult.error || "Failed to load deck",
      };
    }

    const originalDeck = loadResult.deck;

    // Create new deck with copied data
    const saveResult = await saveDeckAction({
      name: newName || `${originalDeck.name} (Copy)`,
      format: originalDeck.format,
      folderId: originalDeck.folder_id,
      cards: originalDeck.cards,
    });

    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error || "Failed to duplicate deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      deckId: saveResult.deckId,
      message: "Deck duplicated successfully",
    };
  } catch (error) {
    console.error("Error in duplicateDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Folder Management Actions
 */

export interface FolderData {
  id?: string;
  user_id?: string;
  parent_folder_id?: string | null;
  name: string;
  created_at?: string;
}

/**
 * Load all folders for the current user
 */
export async function loadUserFoldersAction() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to view folders",
        folders: [],
      };
    }

    const { data: folders, error } = await supabase
      .from("deck_folders")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    if (error) {
      console.error("Error loading folders:", error);
      return {
        success: false,
        error: "Failed to load folders",
        folders: [],
      };
    }

    return {
      success: true,
      folders: folders || [],
    };
  } catch (error) {
    console.error("Error in loadUserFoldersAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      folders: [],
    };
  }
}

/**
 * Create a new folder
 */
export async function createFolderAction(name: string, parentFolderId?: string | null) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to create a folder",
      };
    }

    if (!name || name.trim().length === 0) {
      return {
        success: false,
        error: "Folder name cannot be empty",
      };
    }

    if (name.length > 100) {
      return {
        success: false,
        error: "Folder name must be 100 characters or less",
      };
    }

    const { data: folder, error } = await supabase
      .from("deck_folders")
      .insert({
        user_id: user.id,
        name: name.trim(),
        parent_folder_id: parentFolderId || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating folder:", error);
      return {
        success: false,
        error: "Failed to create folder",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      folder,
      message: "Folder created successfully",
    };
  } catch (error) {
    console.error("Error in createFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Rename a folder
 */
export async function renameFolderAction(folderId: string, newName: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to rename a folder",
      };
    }

    if (!newName || newName.trim().length === 0) {
      return {
        success: false,
        error: "Folder name cannot be empty",
      };
    }

    if (newName.length > 100) {
      return {
        success: false,
        error: "Folder name must be 100 characters or less",
      };
    }

    const { error } = await supabase
      .from("deck_folders")
      .update({ name: newName.trim() })
      .eq("id", folderId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error renaming folder:", error);
      return {
        success: false,
        error: "Failed to rename folder",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: "Folder renamed successfully",
    };
  } catch (error) {
    console.error("Error in renameFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Delete a folder
 */
export async function deleteFolderAction(folderId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to delete a folder",
      };
    }

    // Collect the decks in this folder so we can cascade-delete them and
    // invalidate their public caches (card rows cascade-delete via FK).
    const { data: decksInFolder, error: checkError } = await supabase
      .from("decks")
      .select("id")
      .eq("folder_id", folderId)
      .eq("user_id", user.id);

    if (checkError) {
      console.error("Error checking folder contents:", checkError);
      return {
        success: false,
        error: "Failed to delete folder",
      };
    }

    // Delete every deck inside the folder (their cards cascade-delete via FK).
    if (decksInFolder && decksInFolder.length > 0) {
      const { error: decksError } = await supabase
        .from("decks")
        .delete()
        .eq("folder_id", folderId)
        .eq("user_id", user.id);

      if (decksError) {
        console.error("Error deleting decks in folder:", decksError);
        return {
          success: false,
          error: "Failed to delete folder",
        };
      }
    }

    // Delete the folder itself
    const { error } = await supabase
      .from("deck_folders")
      .delete()
      .eq("id", folderId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error deleting folder:", error);
      return {
        success: false,
        error: "Failed to delete folder",
      };
    }

    revalidatePath("/decklist/my-decks");
    revalidateTag("public-decks-list");
    for (const deck of decksInFolder ?? []) {
      revalidateTag(`public-deck:${deck.id}`);
    }

    return {
      success: true,
      message: "Folder and its decks deleted successfully",
    };
  } catch (error) {
    console.error("Error in deleteFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Move a deck to a folder (or remove from folder)
 */
/**
 * Toggle a deck's public/private status
 */
export async function setDeckVisibilityAction(
  deckId: string,
  visibility: DeckVisibility,
) {
  try {
    if (!["private", "unlisted", "public"].includes(visibility)) {
      return { success: false, error: "Invalid visibility" };
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to change deck visibility",
      };
    }

    const isShared = visibility === "unlisted" || visibility === "public";

    // Listing a deck publicly requires a username (shown as attribution in the
    // community gallery). Unlisted/private don't require one.
    if (visibility === "public") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      if (!profile?.username) {
        return { success: false, needsUsername: true };
      }
    }

    // Writing `visibility` fires the trigger that mirrors `is_public`.
    const updatePayload: Record<string, unknown> = { visibility };

    // When the deck becomes viewable (unlisted or public), auto-set default
    // preview cards if none are set — they power the share-link OG image.
    if (isShared) {
      const { data: existingDeck } = await supabase
        .from("decks")
        .select("preview_card_1, preview_card_2")
        .eq("id", deckId)
        .eq("user_id", user.id)
        .single();

      if (!existingDeck?.preview_card_1 && !existingDeck?.preview_card_2) {
        const { data: deckCards } = await supabase
          .from("deck_cards")
          .select("card_img_file")
          .eq("deck_id", deckId)
          .eq("zone", "main")
          .not("card_img_file", "is", null)
          .limit(2);

        if (deckCards && deckCards.length > 0) {
          updatePayload.preview_card_1 = deckCards[0].card_img_file ?? null;
          updatePayload.preview_card_2 = deckCards[1]?.card_img_file ?? null;
        }
      }
    }

    const { error } = await supabase
      .from("decks")
      .update(updatePayload)
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error setting deck visibility:", error);
      return {
        success: false,
        error: "Failed to update deck visibility",
      };
    }

    revalidatePath("/decklist/my-decks");
    revalidatePath(`/decklist/${deckId}`);
    revalidateTag("public-decks-list");
    revalidateTag(`public-deck:${deckId}`);

    const message =
      visibility === "public"
        ? "Deck is now public"
        : visibility === "unlisted"
          ? "Deck is now unlisted — anyone with the link can view it"
          : "Deck is now private";

    return { success: true, visibility, message };
  } catch (error) {
    console.error("Error in setDeckVisibilityAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Backward-compatible binary toggle. Maps the old public/private boolean onto
 * the three-state visibility model. New UI should call setDeckVisibilityAction.
 */
export async function toggleDeckPublicAction(deckId: string, isPublic: boolean) {
  return setDeckVisibilityAction(deckId, isPublic ? "public" : "private");
}

/**
 * Load a public deck by ID (no auth required for public decks)
 */
export async function loadPublicDeckAction(deckId: string) {
  try {
    const supabase = await createClient();

    // Check if current user is authenticated (optional)
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Load deck
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .select("*")
      .eq("id", deckId)
      .single();

    if (deckError || !deck) {
      return {
        success: false,
        error: "Deck not found",
        deck: null,
      };
    }

    const isOwner = user?.id === deck.user_id;

    // If not public and not owner, deny access
    if (!deck.is_public && !isOwner) {
      return {
        success: false,
        error: "This deck is private",
        deck: null,
      };
    }

    // Load deck cards — Supabase defaults to 1000 rows max, so we must
    // paginate to ensure large decks (e.g. cubes with 1700+ entries) are fully loaded.
    let cards: any[] = [];
    {
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from("deck_cards")
          .select("*")
          .eq("deck_id", deckId)
          .order("card_name")
          .range(offset, offset + PAGE_SIZE - 1);

        if (batchError) {
          console.error("Error loading deck cards:", batchError);
          return {
            success: false,
            error: "Failed to load deck cards",
            deck: null,
          };
        }

        cards = cards.concat(batch || []);
        hasMore = (batch?.length || 0) === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
    }

    // Fetch username for the deck creator
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", deck.user_id)
      .single();

    // Fetch tags for this deck
    const { data: deckTagRows } = await supabase
      .from("deck_tags")
      .select("tag_id, global_tags(id, name, color)")
      .eq("deck_id", deckId);

    const tags = (deckTagRows || [])
      .map((row: any) => row.global_tags)
      .filter(Boolean);

    // Stamp last_played_at for owner's decks (fire-and-forget)
    if (isOwner) {
      supabase
        .from("decks")
        .update({ last_played_at: new Date().toISOString() })
        .eq("id", deckId)
        .then(() => {});
    }

    // Fetch total and budget prices, plus any tournament this deck is the
    // published copy of (null for every ordinary community deck).
    let totalPrice: number | null = null;
    let budgetPrice: number | null = null;
    let tournament: DeckTournamentContext | null = null;
    {
      const [priceResult, budgetResult, tournamentResult] = await Promise.all([
        supabase.rpc("get_deck_total_prices", { deck_ids: [deckId] }),
        supabase.rpc("get_deck_budget_prices", { deck_ids: [deckId] }),
        loadDeckTournamentContext(deckId),
      ]);
      if (priceResult.data?.[0]?.total_price > 0) {
        totalPrice = parseFloat(priceResult.data[0].total_price);
      }
      if (budgetResult.data?.[0]?.budget_price > 0) {
        budgetPrice = parseFloat(budgetResult.data[0].budget_price);
      }
      tournament = tournamentResult;
    }

    return {
      success: true,
      deck: {
        ...deck,
        username: profile?.username || null,
        cards: cards || [],
        tags,
        total_price: totalPrice,
        budget_price: budgetPrice,
        tournament,
      },
      isOwner,
    };
  } catch (error) {
    console.error("Error in loadPublicDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
      deck: null,
    };
  }
}

/**
 * Record one view of a shared deck. Kept out of loadPublicDeckAction so the
 * read path has no side effects: generateMetadata loads the deck for every
 * link unfurl, and a bot's fetch is not a view. The deck page fires this once
 * per tab session. The write goes through a definer RPC (migration 108) because
 * the viewer's own RLS client has no UPDATE right on someone else's deck.
 */
export async function recordDeckViewAction(deckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Owners don't count as viewers of their own deck.
    if (user) {
      const { data: deck } = await supabase
        .from("decks")
        .select("user_id")
        .eq("id", deckId)
        .single();
      if (deck?.user_id === user.id) return;
    }

    await supabase.rpc("increment_deck_view_count", { p_deck_id: deckId });
  } catch (error) {
    console.error("Error in recordDeckViewAction:", error);
  }
}

/**
 * Copy a public deck to the current user's library
 */
export async function copyPublicDeckAction(sourceDeckId: string) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to copy a deck",
      };
    }

    // Load the source deck
    const { data: sourceDeck, error: deckError } = await supabase
      .from("decks")
      .select("*")
      .eq("id", sourceDeckId)
      .single();

    if (deckError || !sourceDeck) {
      return {
        success: false,
        error: "Source deck not found",
      };
    }

    // Must be public or owned by caller
    if (!sourceDeck.is_public && sourceDeck.user_id !== user.id) {
      return {
        success: false,
        error: "You don't have permission to copy this deck",
      };
    }

    // Load source deck cards — paginate past Supabase's default 1000-row limit
    let sourceCards: any[] = [];
    {
      const PAGE_SIZE = 1000;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const { data: batch, error: batchError } = await supabase
          .from("deck_cards")
          .select("*")
          .eq("deck_id", sourceDeckId)
          .range(offset, offset + PAGE_SIZE - 1);

        if (batchError) {
          return {
            success: false,
            error: "Failed to load source deck cards",
          };
        }

        sourceCards = sourceCards.concat(batch || []);
        hasMore = (batch?.length || 0) === PAGE_SIZE;
        offset += PAGE_SIZE;
      }
    }

    // Create the copy
    const saveResult = await saveDeckAction({
      name: `${sourceDeck.name} (Copy)`,
      format: sourceDeck.format,
      paragon: sourceDeck.paragon,
      previewCard1: sourceDeck.preview_card_1 ?? null,
      previewCard2: sourceDeck.preview_card_2 ?? null,
      cards: (sourceCards || []).map((card: any) => ({
        card_name: card.card_name,
        card_set: card.card_set,
        card_img_file: card.card_img_file,
        quantity: card.quantity,
        zone: card.zone,
      })),
    });

    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error || "Failed to copy deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      deckId: saveResult.deckId,
      message: "Deck copied to your library",
    };
  } catch (error) {
    console.error("Error in copyPublicDeckAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

export async function moveDeckToFolderAction(deckId: string, folderId: string | null) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "You must be logged in to move a deck",
      };
    }

    const { error } = await supabase
      .from("decks")
      .update({ folder_id: folderId })
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error moving deck:", error);
      return {
        success: false,
        error: "Failed to move deck",
      };
    }

    revalidatePath("/decklist/my-decks");

    return {
      success: true,
      message: folderId ? "Deck moved to folder" : "Deck removed from folder",
    };
  } catch (error) {
    console.error("Error in moveDeckToFolderAction:", error);
    return {
      success: false,
      error: "An unexpected error occurred",
    };
  }
}

/**
 * Load public decks for the community browse page
 */
export interface LoadPublicDecksParams {
  page?: number;
  pageSize?: number;
  sort?: "newest" | "most_viewed" | "name";
  format?: string;
  search?: string;
  username?: string;
  tagIds?: string[];
  cardNames?: string[];
  tournamentOnly?: boolean;
}

export async function loadPublicDecksAction(params: LoadPublicDecksParams = {}) {
  try {
    const supabase = await createClient();
    const {
      page = 1,
      pageSize = 24,
      sort = "newest",
      format,
      search,
      username,
      tagIds,
      cardNames,
      tournamentOnly,
    } = params;

    const offset = (page - 1) * pageSize;

    // If tournament-only filter, resolve published deck IDs first
    let tournamentDeckIds: string[] | null = null;
    if (tournamentOnly) {
      const { data: tdRows } = await supabase
        .from("tournament_decklists")
        .select("published_deck_id, tournaments!inner(decklists_published)")
        .eq("tournaments.decklists_published", true)
        .not("published_deck_id", "is", null);
      tournamentDeckIds = [...new Set((tdRows || []).map((r: any) => r.published_deck_id).filter(Boolean))];
      if (tournamentDeckIds.length === 0) {
        return { success: true, decks: [], totalCount: 0 };
      }
    }

    // If tag filtering is requested, resolve the matching deck IDs first
    let tagFilteredDeckIds: string[] | null = null;
    if (tagIds && tagIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("deck_tags")
        .select("deck_id")
        .in("tag_id", tagIds);
      // OR logic: any deck that has at least one of the selected tags
      tagFilteredDeckIds = [...new Set((tagRows || []).map((r: any) => r.deck_id))];
      if (tagFilteredDeckIds.length === 0) {
        return { success: true, decks: [], totalCount: 0 };
      }
    }

    // If card filtering is requested, resolve the matching deck IDs first.
    // AND logic: a deck must contain every selected card (names come from
    // autocomplete, so exact match). One query per card keeps each result
    // set small and well under row limits.
    let cardFilteredDeckIds: string[] | null = null;
    if (cardNames && cardNames.length > 0) {
      const perCardResults = await Promise.all(
        cardNames.map((name) =>
          supabase.from("deck_cards").select("deck_id").eq("card_name", name)
        )
      );
      let intersected: Set<string> | null = null;
      for (const { data: rows } of perCardResults) {
        const ids = new Set((rows || []).map((r: any) => r.deck_id as string));
        intersected = intersected
          ? new Set([...intersected].filter((id) => ids.has(id)))
          : ids;
      }
      cardFilteredDeckIds = [...(intersected || [])];
      if (cardFilteredDeckIds.length === 0) {
        return { success: true, decks: [], totalCount: 0 };
      }
    }

    let query = supabase
      .from("decks")
      .select("id, name, description, format, paragon, card_count, view_count, preview_card_1, preview_card_2, user_id, created_at, updated_at, is_legal", { count: "exact" })
      .eq("visibility", "public");

    if (tagFilteredDeckIds) {
      query = query.in("id", tagFilteredDeckIds);
    }

    if (cardFilteredDeckIds) {
      query = query.in("id", cardFilteredDeckIds);
    }

    if (tournamentDeckIds) {
      query = query.in("id", tournamentDeckIds);
    }

    if (format) {
      // Shared with lib/api/cache.ts's v1 API so both sites apply the exact
      // same PostgREST filter shape — see that file's __tests__/cache.test.ts
      // for the byte-for-byte proof of the raw or() clause's encoding.
      const filter = deckFormatFilterFor(format);
      if (filter.kind === "or") query = query.or(filter.clause);
      else if (filter.kind === "in") query = query.in("format", filter.values);
      else query = query.eq("format", filter.value);
    }

    // Filter by exact username (e.g. clicking a username link)
    if (username && username.trim()) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username.trim())
        .single();
      if (profile) {
        query = query.eq("user_id", profile.id);
      } else {
        // No user with that username — return empty
        return { success: true, decks: [], totalCount: 0 };
      }
    }

    // Search by deck name, username, or tournament name
    if (search && search.trim()) {
      const term = search.trim();
      // Find user IDs matching the search term
      const { data: matchingProfiles } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", `%${term}%`);
      const matchingUserIds = (matchingProfiles || []).map((p: any) => p.id);

      // Find published deck IDs from tournaments matching the search term
      const { data: tournamentDeckRows } = await supabase
        .from("tournament_decklists")
        .select("published_deck_id, tournaments!inner(name, decklists_published)")
        .eq("tournaments.decklists_published", true)
        .not("published_deck_id", "is", null)
        .ilike("tournaments.name", `%${term}%`);
      const tournamentDeckIds = [...new Set((tournamentDeckRows || []).map((r: any) => r.published_deck_id).filter(Boolean))];

      const orClauses: string[] = [`name.ilike.%${term}%`];
      if (matchingUserIds.length > 0) {
        orClauses.push(`user_id.in.(${matchingUserIds.join(",")})`);
      }
      if (tournamentDeckIds.length > 0) {
        orClauses.push(`id.in.(${tournamentDeckIds.join(",")})`);
      }
      query = query.or(orClauses.join(","));
    }

    switch (sort) {
      case "most_viewed":
        query = query.order("view_count", { ascending: false, nullsFirst: false });
        break;
      case "name":
        query = query.order("name", { ascending: true });
        break;
      case "newest":
      default:
        query = query.order("updated_at", { ascending: false });
        break;
    }

    query = query.range(offset, offset + pageSize - 1);

    const { data: decks, error, count } = await query;

    if (error) {
      console.error("Error loading public decks:", error);
      return { success: false, error: "Failed to load community decks", decks: [], totalCount: 0 };
    }

    // Fetch usernames for all deck creators
    const userIds = [...new Set((decks || []).map((d: any) => d.user_id).filter(Boolean))];
    let usernameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", userIds);
      usernameMap = new Map((profiles || []).map((p: any) => [p.id, p.username]));
    }
    // Batch-fetch tags for all returned decks
    const deckIds = (decks || []).map((d: any) => d.id).filter(Boolean);
    let tagsMap = new Map<string, GlobalTag[]>();
    if (deckIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("deck_tags")
        .select("deck_id, global_tags(id, name, color)")
        .in("deck_id", deckIds);
      for (const row of (tagRows || []) as any[]) {
        if (!row.global_tags) continue;
        const existing = tagsMap.get(row.deck_id) || [];
        existing.push(row.global_tags as unknown as GlobalTag);
        tagsMap.set(row.deck_id, existing);
      }
    }

    // Batch-fetch total prices and budget prices for all returned decks
    let priceMap = new Map<string, number>();
    let budgetPriceMap = new Map<string, number>();
    if (deckIds.length > 0) {
      const [priceResult, budgetResult] = await Promise.all([
        supabase.rpc("get_deck_total_prices", { deck_ids: deckIds }),
        supabase.rpc("get_deck_budget_prices", { deck_ids: deckIds }),
      ]);

      if (priceResult.error) {
        console.error("Error fetching deck prices:", priceResult.error);
      }
      for (const row of (priceResult.data || []) as any[]) {
        if (row.total_price > 0) {
          priceMap.set(row.deck_id, parseFloat(row.total_price));
        }
      }

      if (budgetResult.error) {
        console.error("Error fetching budget prices:", budgetResult.error);
      }
      for (const row of (budgetResult.data || []) as any[]) {
        if (row.budget_price > 0) {
          budgetPriceMap.set(row.deck_id, parseFloat(row.budget_price));
        }
      }
    }

    // Batch-fetch tournament placement data for returned decks
    let tournamentMap = new Map<string, { tournament_name: string; placement: number | null; deck_format: string | null; participant_count: number }>();
    if (deckIds.length > 0) {
      const { data: tdRows } = await supabase
        .from("tournament_decklists")
        .select(`
          deck_id,
          published_deck_id,
          participant_id,
          tournaments!inner (
            id,
            name,
            decklists_published,
            deck_format
          ),
          participants!inner (
            place,
            tournament_id
          )
        `)
        .in("published_deck_id", deckIds);

      if (tdRows && tdRows.length > 0) {
        // Get unique tournament IDs that are published
        const publishedRows = (tdRows as any[]).filter((r: any) => r.tournaments?.decklists_published);
        const tournamentIds = [...new Set(publishedRows.map((r: any) => r.tournaments?.id).filter(Boolean))];

        // Fetch participant counts in parallel (one query per tournament, all concurrent)
        const countMap = new Map<string, number>();
        if (tournamentIds.length > 0) {
          const countResults = await Promise.all(
            tournamentIds.map((tid) =>
              supabase
                .from("participants")
                .select("id", { count: "exact", head: true })
                .eq("tournament_id", tid)
                .then(({ count }) => ({ tid, count: count || 0 }))
            )
          );
          for (const { tid, count } of countResults) {
            countMap.set(tid, count);
          }
        }

        for (const row of publishedRows) {
          const tid = row.tournaments?.id;
          // Map by published_deck_id since that's the public deck visible on community page
          tournamentMap.set(row.published_deck_id, {
            tournament_name: row.tournaments?.name || "Tournament",
            placement: row.participants?.place ?? null,
            deck_format: row.tournaments?.deck_format || null,
            participant_count: countMap.get(tid) || 0,
          });
        }
      }
    }

    const decksWithUsername = (decks || []).map((d: any) => {
      const tournament = tournamentMap.get(d.id);
      return {
        ...d,
        username: usernameMap.get(d.user_id) || null,
        tags: tagsMap.get(d.id) || [],
        total_price: priceMap.get(d.id) || null,
        budget_price: budgetPriceMap.get(d.id) || null,
        tournament: tournament || null,
      };
    });

    return { success: true, decks: decksWithUsername, totalCount: count || 0 };
  } catch (error) {
    console.error("Error in loadPublicDecksAction:", error);
    return { success: false, error: "An unexpected error occurred", decks: [], totalCount: 0 };
  }
}

/**
 * Autocomplete card names for the community card filter.
 * Searches deck_cards of public decks (enforced by RLS).
 */
export async function loadCardSuggestionsAction(search: string) {
  try {
    const term = (search || "").trim().replace(/[%_]/g, "");
    if (term.length < 2) {
      return { success: true, suggestions: [] as string[] };
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("deck_cards")
      .select("card_name")
      .ilike("card_name", `%${term}%`)
      .limit(500);
    if (error) {
      console.error("Error loading card suggestions:", error);
      return { success: false, suggestions: [] as string[] };
    }
    const unique = [...new Set((data || []).map((r: any) => r.card_name as string))].sort();
    return { success: true, suggestions: unique.slice(0, 15) };
  } catch (error) {
    console.error("Error in loadCardSuggestionsAction:", error);
    return { success: false, suggestions: [] as string[] };
  }
}

export async function renameDeckAction(deckId: string, name: string) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: "Not authenticated" };

    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "Name cannot be empty" };

    const { error } = await supabase
      .from("decks")
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) return { success: false, error: "Failed to rename deck" };

    revalidatePath(`/decklist/${deckId}`);
    revalidatePath("/decklist/community");
    revalidatePath("/decklist/my-decks");
    revalidateTag("public-decks-list");
    revalidateTag(`public-deck:${deckId}`);
    return { success: true };
  } catch (error) {
    console.error("Error in renameDeckAction:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function updateDeckPreviewCardsAction(
  deckId: string,
  previewCard1: string | null,
  previewCard2: string | null
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: "Not authenticated" };

    const { error } = await supabase
      .from("decks")
      .update({ preview_card_1: previewCard1, preview_card_2: previewCard2 })
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) return { success: false, error: "Failed to update cover cards" };

    revalidatePath(`/decklist/${deckId}`);
    revalidatePath("/decklist/community");
    return { success: true };
  } catch (error) {
    console.error("Error in updateDeckPreviewCardsAction:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Set username for the current user
 */
export async function setUsernameAction(username: string) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const trimmed = username.trim();

    if (trimmed.length < 3 || trimmed.length > 24) {
      return { success: false, error: "Username must be between 3 and 24 characters" };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return { success: false, error: "Username can only contain letters, numbers, underscores, and hyphens" };
    }

    // Check uniqueness for a friendlier error message
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", trimmed)
      .neq("id", user.id)
      .single();

    if (existing) {
      return { success: false, error: "This username is already taken" };
    }

    // Upsert the profile (handles case where profile row might not exist)
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, username: trimmed, updated_at: new Date().toISOString() });

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "This username is already taken" };
      }
      console.error("Error setting username:", error);
      return { success: false, error: "Failed to set username" };
    }

    return { success: true };
  } catch (error) {
    console.error("Error in setUsernameAction:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}

// ─── Tag types ────────────────────────────────────────────────────────────────

export interface GlobalTag {
  id: string;
  name: string;
  color: string;
}

/**
 * Load the full predefined tag list (public, no auth required)
 */
export async function loadGlobalTagsAction(): Promise<{ success: boolean; tags: GlobalTag[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("global_tags")
      .select("id, name, color")
      .order("name");
    if (error) return { success: false, tags: [], error: "Failed to load tags" };
    return { success: true, tags: data || [] };
  } catch {
    return { success: false, tags: [], error: "An unexpected error occurred" };
  }
}

/**
 * Replace all tags on a deck (owner only)
 */
export async function updateDeckTagsAction(deckId: string, tagIds: string[]) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: "Not authenticated" };

    // Verify ownership
    const { data: deck } = await supabase
      .from("decks")
      .select("user_id")
      .eq("id", deckId)
      .single();
    if (!deck || deck.user_id !== user.id) return { success: false, error: "Not authorized" };

    // Delete existing tags then insert new set
    const { error: delError } = await supabase
      .from("deck_tags")
      .delete()
      .eq("deck_id", deckId);
    if (delError) return { success: false, error: "Failed to update tags" };

    if (tagIds.length > 0) {
      const { error: insError } = await supabase
        .from("deck_tags")
        .insert(tagIds.map((tag_id) => ({ deck_id: deckId, tag_id })));
      if (insError) return { success: false, error: "Failed to save tags" };
    }

    revalidatePath(`/decklist/${deckId}`);
    revalidatePath("/decklist/community");
    return { success: true };
  } catch {
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Check if a username is available
 */
export async function checkUsernameAvailableAction(username: string) {
  try {
    const supabase = await createClient();
    const trimmed = username.trim();

    if (trimmed.length < 3) {
      return { available: false };
    }

    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", trimmed)
      .single();

    return { available: !data };
  } catch {
    return { available: false };
  }
}

/**
 * Update a deck's description
 */
export async function updateDeckDescriptionAction(deckId: string, description: string) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const { error } = await supabase
      .from("decks")
      .update({ description: description || null })
      .eq("id", deckId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error updating description:", error);
      return { success: false, error: "Failed to update description" };
    }

    revalidatePath(`/decklist/${deckId}`);
    revalidateTag("public-decks-list");
    revalidateTag(`public-deck:${deckId}`);
    return { success: true };
  } catch (error) {
    console.error("Error in updateDeckDescriptionAction:", error);
    return { success: false, error: "An unexpected error occurred" };
  }
}
