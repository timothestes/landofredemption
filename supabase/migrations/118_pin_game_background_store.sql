-- Pin game_backgrounds.url to this project's public Blob store (adversarial
-- review of #516): 117 accepted any *.public.blob.vercel-storage.com host.
-- Mirrors URL_RE in app/shared/utils/gameBackground.ts.

ALTER TABLE game_backgrounds DROP CONSTRAINT game_backgrounds_url_own_folder;
ALTER TABLE game_backgrounds ADD CONSTRAINT game_backgrounds_url_own_folder CHECK (
  url ~ '^https://qrpnuz0u6exnvyt8\.public\.blob\.vercel-storage\.com/game-backgrounds/[0-9a-f-]{36}/[A-Za-z0-9_-]+\.(webp|jpg)$'
  AND split_part(url, '/', 5) = user_id::text
);
