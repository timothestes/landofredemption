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

// Long enough for a cold start. Past this a save counts as failed, so a lost request can't
// hold up the saves behind it or leave the pill on "Saving…".
export const SEND_DEADLINE_MS = 20_000;
// How long leaving the card waits for a save in flight before sending past it. Enough for one
// that is really on the wire to land first, so an older value can't arrive after a newer one.
export const LEAVE_GRACE_MS = 1_000;
// How long a save that failed on the way out keeps waiting for the connection to return. Short,
// because anything later could land old text over newer work with nothing on screen to say why.
export const RECONNECT_WINDOW_MS = 10 * 60_000;

// One save at a time, each diffed against what the one before it stored. Concurrent saves
// from one session are how lastSaved ends up claiming something the server doesn't hold: a
// second diff taken while the first is in flight is against a base about to go out of date,
// and an edit undone in the meantime diffs to nothing while the first save still lands.
//
// One at a time must not mean waiting on a request forever. Next's router can drop a server
// action outright: dispatch one during a navigation when the action before that navigation was
// discarded (a save, or a refresh from a realtime ping), and it hangs off a dead queue node and
// its promise never settles. Hence the deadline, and leave() not waiting it out.
export function createCardSaver({ latest, lastSaved, send }: {
  latest: { current: DesignCard };     // the newest edit
  lastSaved: { current: DesignCard };  // this session's view of the server; the diff base
  send: (patch: SnapshotPatch) => Promise<{ ok: boolean }>;
}) {
  let active = false;
  let again = false;
  let done: Promise<boolean> = Promise.resolve(true);
  let sending: DesignCard | null = null;
  let abandon: (() => void) | null = null;
  // A failed attempt may have landed with only its response lost, so lastSaved can't vouch for
  // its fields: they go out again as they now stand, even if the diff says they're unchanged.
  // Holds for one base only: a stored save or an adopted write settles what the server has.
  let unconfirmed: { base: DesignCard; fields: string[] } | null = null;

  function nextPatch(): SnapshotPatch {
    const patch = diffSnapshot(lastSaved.current, latest.current);
    if (unconfirmed?.base !== lastSaved.current) return patch;
    const next = latest.current as Fields;
    for (const k of unconfirmed.fields) {
      if (next[k] !== undefined) (patch.set as Fields)[k] = next[k];
      else if (!patch.remove.includes(k)) patch.remove.push(k);
    }
    return patch;
  }

  function attempt(patch: SnapshotPatch): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = setTimeout(() => resolve(false), SEND_DEADLINE_MS);
      abandon = () => resolve(false);
      void (async () => {
        let ok = false;
        try {
          ok = (await send(patch)).ok;
        } catch {
          // A dropped connection rejects. The fields stay in the next attempt.
        }
        clearTimeout(deadline);
        resolve(ok);
      })();
    });
  }

  async function pump(): Promise<boolean> {
    let ok = true;
    do {
      again = false;
      const base = lastSaved.current;
      const next = latest.current;
      const patch = nextPatch();
      if (isEmptyPatch(patch)) { ok = true; continue; }
      sending = next;
      ok = await attempt(patch);
      sending = null;
      abandon = null;
      if (ok) {
        // "Load their version" during the flight moved the base on purpose. Keep it: the
        // merged result this save produces comes back through the adopt effect.
        if (lastSaved.current === base) lastSaved.current = next;
        unconfirmed = null;
      } else {
        unconfirmed = { base, fields: [...Object.keys(patch.set), ...patch.remove] };
      }
    } while (again);
    active = false;
    return ok;
  }

  /** Save the newest edit. Resolves when nothing asked for is left unsent: true if the last
   *  attempt was stored, false if it failed or passed the deadline. Never rejects. */
  function flush(): Promise<boolean> {
    if (active) { again = true; return done; }
    active = true;
    done = pump();
    return done;
  }

  return {
    flush,
    /** The editor is going away, so nothing can show a failure and nobody can press Retry. */
    leave(events: Pick<EventTarget, "addEventListener" | "removeEventListener">): void {
      const inFlight = abandon;
      void flush()
        .then((ok) => ok || flush())   // one dropped by the router goes through once it's calm
        .then((ok) => {
          if (ok) return;
          const retry = () => { clearTimeout(expiry); void flush(); };
          const expiry = setTimeout(() => events.removeEventListener("online", retry), RECONNECT_WINDOW_MS);
          events.addEventListener("online", retry, { once: true });
        });
      if (inFlight) setTimeout(inFlight, LEAVE_GRACE_MS);
    },
    busy: () => active,
    /** Nothing in flight and nothing left to send. */
    clean: () => !active && isEmptyPatch(nextPatch()),
    /** What the server will hold once any save in flight lands. */
    target: () => sending ?? lastSaved.current,
  };
}
