-- Pin up to 3 decks to the top of My Decks (Discord request, Nov 2026).
--
-- is_pinned is the owner's own shortcut, not an edit of the deck, so it joins
-- the metadata-only fields update_updated_at_column ignores: pinning must not
-- move "Updated 2d ago" or reorder the Last Modified sort. The function is
-- shared by other tables; none of them has an is_pinned column, so for them
-- the extra key is a no-op. Body otherwise copied from 042_visibility_not_an_edit.
--
-- The 3-deck cap lives in setDeckPinnedAction (app/decklist/actions.ts), not
-- here: going over it only crowds the owner's own list.

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF to_jsonb(NEW)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at'
       - 'folder_id'
       - 'visibility' - 'is_public'
       - 'preview_card_1' - 'preview_card_2'
       - 'is_pinned'
   = to_jsonb(OLD)
       - 'last_played_at' - 'view_count'
       - 'is_legal' - 'deckcheck_issues'
       - 'last_active_at'
       - 'updated_at'
       - 'folder_id'
       - 'visibility' - 'is_public'
       - 'preview_card_1' - 'preview_card_2'
       - 'is_pinned' THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;
