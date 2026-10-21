// The play client's view of the bracket launch params. Re-exported from the
// brackets feature so the dependency direction (play ← brackets) stays visible.
export type { BracketGameParams } from '@/app/brackets/lib/gameParams';
export { writeSoloGameParams, stdbFormatFor } from '@/app/brackets/lib/gameParams';
