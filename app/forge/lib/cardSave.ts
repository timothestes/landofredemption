// Field-level saves of a card's working draft. Pure: no DB, no React, so the sequencing can
// be tested in node. StudioEditor drives the saver.
//
// forge_save_card writes a whole snapshot, so a save from a session that loaded the card a
// minute ago reverted whatever another elder had saved since, in any field. A save now
// carries only the fields this session changed, and forge_save_card_fields merges them into
// the row as it stands. Two people on the same field still get last-write-wins.

import type { DesignCard } from "./designCard";
import { sameSnapshot } from "./cardDiff";

// `remove` is separate because JSON can't carry undefined: clearing Reference sets the key
// to undefined in the editor, which would simply vanish from a `set` on its way to the server.
export type SnapshotPatch = { set: Partial<DesignCard>; remove: string[] };

type Fields = Record<string, unknown>;

// sameSnapshot defines equality, so a field and a snapshot can never disagree about it.
export function sameValue(a: unknown, b: unknown): boolean {
  return sameSnapshot({ v: a } as unknown as DesignCard, { v: b } as unknown as DesignCard);
}

export function diffSnapshot(base: DesignCard, next: DesignCard): SnapshotPatch {
  const before = base as Fields;
  const after = next as Fields;
  const set: Fields = {};
  for (const k of Object.keys(after)) {
    if (after[k] !== undefined && !sameValue(before[k], after[k])) set[k] = after[k];
  }
  const remove = Object.keys(before).filter((k) => before[k] !== undefined && after[k] === undefined);
  return { set: set as Partial<DesignCard>, remove };
}

export function isEmptyPatch(patch: SnapshotPatch): boolean {
  return patch.remove.length === 0 && Object.keys(patch.set).length === 0;
}

// What the adopt effect does with a snapshot the server just sent. Another elder's field
// arrives here: lastSaved stays this session's own view of the card, so with no local edits
// the merged result is adopted, and with local edits the field stays out of this session's
// diff until the edit is saved and the merged result comes back. A save in flight counts as
// a local edit, because what the server is about to hold isn't in `incoming` yet.
export function incomingAction({ incoming, latest, lastSaved, busy }: {
  incoming: DesignCard;
  latest: DesignCard;
  lastSaved: DesignCard;
  busy: boolean;
}): "ignore" | "stale" | "adopt" {
  if (sameSnapshot(incoming, lastSaved)) return "ignore";
  if (busy || !sameSnapshot(latest, lastSaved)) return "stale";
  return "adopt";
}

// One save at a time, each diffed against what the one before it stored. Concurrent saves
// from one session are how lastSaved ends up claiming something the server doesn't hold: a
// second diff taken while the first is in flight is against a base about to go out of date,
// and an edit undone in the meantime diffs to nothing while the first save still lands.
export function createCardSaver({ latest, lastSaved, send }: {
  latest: { current: DesignCard };     // the newest edit
  lastSaved: { current: DesignCard };  // this session's view of the server; the diff base
  send: (patch: SnapshotPatch) => Promise<{ ok: boolean }>;
}) {
  let active = false;
  let again = false;
  let done: Promise<boolean> = Promise.resolve(true);
  let sending: DesignCard | null = null;

  async function pump(): Promise<boolean> {
    let ok = true;
    do {
      again = false;
      const base = lastSaved.current;
      const next = latest.current;
      const patch = diffSnapshot(base, next);
      if (isEmptyPatch(patch)) { ok = true; continue; }
      sending = next;
      try {
        ok = (await send(patch)).ok;
      } catch {
        ok = false;   // a dropped connection rejects; the fields stay in the next diff
      }
      sending = null;
      // "Load their version" during the flight moved the base on purpose. Keep it: the
      // merged result this save produces comes back through the adopt effect.
      if (ok && lastSaved.current === base) lastSaved.current = next;
    } while (again);
    active = false;
    return ok;
  }

  return {
    /** Save the newest edit. Resolves when nothing asked for is left unsent: true if the
     *  last attempt was stored, false if it failed. Never rejects. */
    flush(): Promise<boolean> {
      if (active) { again = true; return done; }
      active = true;
      done = pump();
      return done;
    },
    busy: () => active,
    /** What the server will hold once any save in flight lands. */
    target: () => sending ?? lastSaved.current,
  };
}
