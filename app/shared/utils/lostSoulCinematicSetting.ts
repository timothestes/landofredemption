/**
 * Pure read/write helpers for the "Lost Soul cinematic" game setting. The
 * React hook (`useLostSoulCinematicSetting`) owns localStorage; this stays
 * DOM-free so the default-on and parsing rules are unit-testable.
 */

export const LOST_SOUL_CINEMATIC_STORAGE_KEY = 'redemption-lost-soul-cinematic';

/** Default ON: a missing or unrecognised value means the cinematic plays. */
export function parseLostSoulCinematicSetting(raw: string | null): boolean {
  return raw !== '0';
}

export function serializeLostSoulCinematicSetting(enabled: boolean): string {
  return enabled ? '1' : '0';
}
