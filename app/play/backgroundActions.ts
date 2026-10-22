'use server';

import { del } from '@vercel/blob';
import { createClient } from '@/utils/supabase/server';
import { isAllowedBackgroundUrl } from '@/app/shared/utils/gameBackground';

export interface GameBackgroundRow {
  url: string;
  enabled: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Best-effort: a failed delete is swept by the token route on the next upload. */
async function deleteBlob(url: string | null | undefined) {
  if (!isAllowedBackgroundUrl(url)) return;
  try {
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (e) {
    console.warn('[game-background] blob delete failed', e);
  }
}

/** The caller's id (null when signed out) and saved background (null when they have none). */
export async function getGameBackground(): Promise<{ userId: string | null; row: GameBackgroundRow | null }> {
  const { supabase, user } = await currentUser();
  if (!user) return { userId: null, row: null };
  const { data } = await supabase
    .from('game_backgrounds')
    .select('url, enabled')
    .eq('user_id', user.id)
    .maybeSingle();
  const row = data && isAllowedBackgroundUrl(data.url, user.id) ? { url: data.url, enabled: data.enabled } : null;
  return { userId: user.id, row };
}

/** Save a freshly uploaded image as the caller's background (turns it on). */
export async function saveGameBackground(url: string): Promise<Result<GameBackgroundRow>> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to set a background' };
  if (!isAllowedBackgroundUrl(url, user.id)) return { ok: false, error: 'That upload is not yours' };

  const { data: previous } = await supabase
    .from('game_backgrounds')
    .select('url')
    .eq('user_id', user.id)
    .maybeSingle();
  const { error } = await supabase
    .from('game_backgrounds')
    .upsert({ user_id: user.id, url, enabled: true }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: 'Could not save the background' };
  if (previous?.url && previous.url !== url) await deleteBlob(previous.url);
  return { ok: true, value: { url, enabled: true } };
}

/** Switch between the saved image and the default art without deleting it. */
export async function setGameBackgroundEnabled(enabled: boolean): Promise<Result<null>> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to set a background' };
  const { data, error } = await supabase
    .from('game_backgrounds')
    .update({ enabled })
    .eq('user_id', user.id)
    .select('user_id');
  if (error) return { ok: false, error: 'Could not update the background' };
  if (!data?.length) return { ok: false, error: 'No background saved' };
  return { ok: true, value: null };
}

/** Delete the caller's background row and its image. */
export async function removeGameBackground(): Promise<Result<null>> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'Sign in to set a background' };
  const { data: previous } = await supabase
    .from('game_backgrounds')
    .select('url')
    .eq('user_id', user.id)
    .maybeSingle();
  const { error } = await supabase.from('game_backgrounds').delete().eq('user_id', user.id);
  if (error) return { ok: false, error: 'Could not remove the background' };
  await deleteBlob(previous?.url);
  return { ok: true, value: null };
}
