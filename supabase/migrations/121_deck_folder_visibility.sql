-- Shareable deck folders: the same three-state visibility decks have.
--   private  -> owner only (default; every existing folder stays private)
--   unlisted -> anyone with the link can view /decklist/folders/<id>
--   public   -> viewable by link AND listed on Community Decks / sitemap
--
-- Sharing is view-only. The folder page lists the folder's unlisted + public
-- decks; private decks inside a shared folder stay hidden (deck RLS already
-- enforces that). Like unlisted decks, an unlisted folder is readable by id
-- through the anon key, so "unlisted" means unadvertised, not secret.

ALTER TABLE deck_folders
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'unlisted', 'public'));

CREATE INDEX idx_deck_folders_visibility ON deck_folders(visibility)
  WHERE visibility <> 'private';

-- The existing FOR ALL owner policy keeps covering writes. Permissive
-- policies OR together, so this only widens SELECT.
CREATE POLICY "Anyone can view shared folders" ON deck_folders
  FOR SELECT
  USING (visibility IN ('unlisted', 'public'));
