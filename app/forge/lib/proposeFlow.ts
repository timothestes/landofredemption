// The submit sequence, extracted so its ORDER is testable. The editor autosaves
// 700ms after a keystroke and createProposal freezes the server's copy of the
// working draft, so a submit inside that window would propose the pre-keystroke
// snapshot. Flush must complete — and must have succeeded — before create runs.
// See StudioSyncContext for why the flush is reachable at all.
import { PROPOSE_FLUSH_FAILED } from "./proposeCopy";

export type SubmitResult = { ok: true; id: string } | { ok: false; error: string };

export async function runProposeSubmit(deps: {
  flush: () => Promise<{ ok: boolean }>;
  create: () => Promise<SubmitResult>;
}): Promise<SubmitResult> {
  const flushed = await deps.flush();
  // `=== false` on purpose: tsconfig has strict:false, where `if (x.ok)` narrowing
  // on a union silently fails to narrow the else branch.
  if (flushed.ok === false) return { ok: false, error: PROPOSE_FLUSH_FAILED };
  return deps.create();
}

// The same order for anything else that acts on the server's copy of the draft (Release,
// Deny and restore): if the flush fails, `failed` comes back and `act` never runs.
export async function flushThen<T>(
  flush: () => Promise<{ ok: boolean }>,
  act: () => Promise<T>,
  failed: T,
): Promise<T> {
  const flushed = await flush();
  if (flushed.ok === false) return failed;
  return act();
}
