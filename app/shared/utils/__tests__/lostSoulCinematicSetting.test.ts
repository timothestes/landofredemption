import { describe, it, expect } from 'vitest';
import {
  LOST_SOUL_CINEMATIC_STORAGE_KEY,
  parseLostSoulCinematicSetting,
  serializeLostSoulCinematicSetting,
} from '../lostSoulCinematicSetting';

describe('parseLostSoulCinematicSetting', () => {
  it('defaults to ON when nothing has been stored', () => {
    expect(parseLostSoulCinematicSetting(null)).toBe(true);
  });

  it('reads a stored OFF', () => {
    expect(parseLostSoulCinematicSetting('0')).toBe(false);
  });

  it('reads a stored ON', () => {
    expect(parseLostSoulCinematicSetting('1')).toBe(true);
  });

  it('falls back to ON for an unrecognised value', () => {
    expect(parseLostSoulCinematicSetting('maybe')).toBe(true);
    expect(parseLostSoulCinematicSetting('')).toBe(true);
  });

  it('round-trips through serialize', () => {
    expect(parseLostSoulCinematicSetting(serializeLostSoulCinematicSetting(false))).toBe(false);
    expect(parseLostSoulCinematicSetting(serializeLostSoulCinematicSetting(true))).toBe(true);
  });

  it('uses a namespaced storage key like the other game settings', () => {
    expect(LOST_SOUL_CINEMATIC_STORAGE_KEY).toMatch(/^redemption-/);
  });
});
