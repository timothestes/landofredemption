// lib/tournament/saveRetry.ts
//
// Re-send a failed live-round score save a couple of times before telling the
// host it did not save. A dropped request on venue wifi is the likeliest
// failure mid-round, and it usually goes through a second later.
//
// Pure (no React, no Supabase) so the retry rule is unit-testable.

export type SaveAttempt = { ok: true } | { ok: false; error: string };

/** Waits before the second and third attempts — about two seconds in all. */
export const SAVE_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

/**
 * Run `attempt`, re-running it after each delay while it keeps failing.
 * Returns the first success, or the last failure.
 *
 * `shouldRetry` is asked both before and after each wait: before, so a failure
 * a retry can't fix (an expired session) is reported at once; after, so a
 * newer save for the same row that started during the wait is never followed
 * by a re-send of the older value.
 */
export async function saveWithRetry(
  attempt: () => Promise<SaveAttempt>,
  {
    delaysMs = SAVE_RETRY_DELAYS_MS,
    shouldRetry = () => true,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    delaysMs?: readonly number[];
    shouldRetry?: (error: string) => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SaveAttempt> {
  let result = await attempt();
  for (const delay of delaysMs) {
    if (result.ok === true || !shouldRetry(result.error)) break;
    await sleep(delay);
    if (!shouldRetry(result.error)) break;
    result = await attempt();
  }
  return result;
}
