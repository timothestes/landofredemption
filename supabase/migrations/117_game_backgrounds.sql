-- Per-player custom game background (goldfish, multiplayer, spectating).
-- Viewer-only: a player's image is shown to that player alone, so every policy
-- is owner-only and the row never leaves its owner. Writes go through
-- app/play/backgroundActions.ts (which also deletes the replaced Blob), but the
-- CHECK below holds even for a hand-made PostgREST write: the URL must be an
-- upload in the owner's own folder on a Vercel public Blob store, in an
-- alphabet that cannot break out of the CSS url("…") it is rendered into.

CREATE TABLE game_backgrounds (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT game_backgrounds_url_own_folder CHECK (
    url ~ '^https://[a-z0-9]+\.public\.blob\.vercel-storage\.com/game-backgrounds/[0-9a-f-]{36}/[A-Za-z0-9_-]+\.(webp|jpg)$'
    AND split_part(url, '/', 5) = user_id::text
  )
);

ALTER TABLE game_backgrounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_backgrounds_select_own" ON game_backgrounds
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "game_backgrounds_insert_own" ON game_backgrounds
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "game_backgrounds_update_own" ON game_backgrounds
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "game_backgrounds_delete_own" ON game_backgrounds
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON game_backgrounds FROM anon;

CREATE TRIGGER update_game_backgrounds_updated_at
  BEFORE UPDATE ON game_backgrounds
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
