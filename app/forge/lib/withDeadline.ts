// Next's router can drop a server action outright, and then its promise never settles (see
// cardSave.ts). Anything that waits on one, with a control held disabled meanwhile, has to give
// up eventually. Resolves with `fallback` past the deadline or if the action rejects. Never rejects.

import { SEND_DEADLINE_MS } from "./cardSave";

export function withDeadline<T>(action: Promise<T>, fallback: T, ms: number = SEND_DEADLINE_MS): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    action.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}
