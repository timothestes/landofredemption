const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Six characters, no 0/O/1/I, for a multiplayer game code. */
export function generateGameCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return code;
}
