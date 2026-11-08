import { describe, it, expect } from "vitest";
import {
  createCardSaver, diffSnapshot, incomingAction, isEmptyPatch, type SnapshotPatch,
} from "../cardSave";
import { sameSnapshot } from "../cardDiff";
import type { DesignCard } from "../designCard";

// What forge_save_card_fields does to the row: removed keys go, then changed keys land.
function merge(row: DesignCard, patch: SnapshotPatch): DesignCard {
  const out = { ...row } as Record<string, unknown>;
  for (const k of patch.remove) delete out[k];
  return { ...out, ...patch.set } as DesignCard;
}

// A send() the test settles by hand, so it can act while a save is in flight.
function deferredSend() {
  const calls: { patch: SnapshotPatch; resolve: (r: { ok: boolean }) => void; reject: (e: Error) => void }[] = [];
  const send = (patch: SnapshotPatch) =>
    new Promise<{ ok: boolean }>((resolve, reject) => { calls.push({ patch, resolve, reject }); });
  return { calls, send };
}

// One editing session against a shared server row, wired the way StudioEditor wires it.
function session(server: { row: DesignCard }) {
  const latest = { current: server.row };
  const lastSaved = { current: server.row };
  const saver = createCardSaver({
    latest,
    lastSaved,
    send: async (patch) => { server.row = merge(server.row, patch); return { ok: true }; },
  });
  return {
    latest,
    lastSaved,
    saver,
    edit(patch: DesignCard) { latest.current = { ...latest.current, ...patch }; },
    // A router.refresh() landing in the adopt effect.
    refresh() {
      const action = incomingAction({
        incoming: server.row, latest: latest.current, lastSaved: lastSaved.current, busy: saver.busy(),
      });
      if (action === "adopt") { lastSaved.current = server.row; latest.current = server.row; }
      return action;
    },
  };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("diffSnapshot", () => {
  it("sends only the fields that changed", () => {
    expect(diffSnapshot({ name: "A", rarity: "C" }, { name: "A", rarity: "R" }))
      .toEqual({ set: { rarity: "R" }, remove: [] });
  });

  it("treats a new key as set", () => {
    expect(diffSnapshot({ name: "A" }, { name: "A", reference: "Gen 1:1" }))
      .toEqual({ set: { reference: "Gen 1:1" }, remove: [] });
  });

  it("removes a key that is missing or undefined, because JSON cannot carry undefined", () => {
    expect(diffSnapshot({ name: "A", rarity: "R" }, { name: "A" })).toEqual({ set: {}, remove: ["rarity"] });
    expect(diffSnapshot({ name: "A", rarity: "R" }, { name: "A", rarity: undefined }))
      .toEqual({ set: {}, remove: ["rarity"] });
  });

  it("keeps null as a value: a cleared stat is stored as null", () => {
    expect(diffSnapshot({ strength: 5 }, { strength: null })).toEqual({ set: { strength: null }, remove: [] });
    expect(diffSnapshot({}, { strength: null })).toEqual({ set: { strength: null }, remove: [] });
  });

  it("sends a whole nested value when any part of it changes, and notices reordering", () => {
    expect(diffSnapshot({ brigades: ["Blue", "Green"] }, { brigades: ["Blue", "Teal"] }))
      .toEqual({ set: { brigades: ["Blue", "Teal"] }, remove: [] });
    expect(diffSnapshot({ brigades: ["Blue", "Green"] }, { brigades: ["Green", "Blue"] }).set)
      .toEqual({ brigades: ["Green", "Blue"] });
  });

  it("is empty for equal content, whatever the key order or undefined keys", () => {
    const cases: [DesignCard, DesignCard][] = [
      [{}, {}],
      [{ name: "A", rarity: "R" }, { rarity: "R", name: "A" }],
      [{ brigades: ["Blue"] }, { brigades: ["Blue"] }],
      [{ name: "A" }, { name: "A", rarity: undefined }],
      [{ name: "A", rarity: undefined }, { name: "A" }],
    ];
    for (const [a, b] of cases) {
      expect(sameSnapshot(a, b)).toBe(true);
      expect(isEmptyPatch(diffSnapshot(a, b))).toBe(true);
    }
  });

  it("merging the diff always reproduces the edit", () => {
    const base: DesignCard = { name: "A", rarity: "R", brigades: ["Blue"], strength: 5, reference: "Gen 1:1" };
    const edits: DesignCard[] = [
      { name: "B", rarity: "R", brigades: ["Blue"], strength: 5, reference: "Gen 1:1" },
      { name: "A", brigades: ["Blue", "Teal"], strength: null },
      {},
      { ...base, reference: undefined, scripture: "In the beginning" },
    ];
    for (const next of edits) expect(sameSnapshot(merge(base, diffSnapshot(base, next)), next)).toBe(true);
  });
});

describe("two elders on one card (U-01)", () => {
  it("keeps both edits when they touch different fields", async () => {
    const server = { row: { name: "Card", identifiers: ["Old"], scripture: "Old verse" } as DesignCard };
    const a = session(server);
    const b = session(server);

    a.edit({ identifiers: ["New"] });
    await a.saver.flush();
    b.edit({ scripture: "New verse" });
    await b.saver.flush();

    expect(server.row).toEqual({ name: "Card", identifiers: ["New"], scripture: "New verse" });
  });

  it("never puts a field another elder changed into this session's diff", async () => {
    const server = { row: { name: "Card", identifiers: ["Old"], scripture: "Old verse" } as DesignCard };
    const a = session(server);
    const b = session(server);

    a.edit({ identifiers: ["New"] });
    await a.saver.flush();

    // B has an unsaved edit when A's write reaches them, so B keeps its copy and is warned.
    b.edit({ scripture: "New verse" });
    expect(b.refresh()).toBe("stale");
    expect(b.latest.current.identifiers).toEqual(["Old"]);
    expect(diffSnapshot(b.lastSaved.current, b.latest.current))
      .toEqual({ set: { scripture: "New verse" }, remove: [] });
  });

  it("adopts the merged result once the edit is saved, which is how each sees the other's field", async () => {
    const server = { row: { name: "Card", identifiers: ["Old"], scripture: "Old verse" } as DesignCard };
    const a = session(server);
    const b = session(server);

    a.edit({ identifiers: ["New"] });
    await a.saver.flush();
    b.edit({ scripture: "New verse" });
    await b.saver.flush();

    expect(b.refresh()).toBe("adopt");
    expect(b.latest.current).toEqual(server.row);
    expect(a.refresh()).toBe("adopt");
    expect(a.latest.current).toEqual(server.row);
    // Adopting leaves nothing to send back.
    expect(isEmptyPatch(diffSnapshot(a.lastSaved.current, a.latest.current))).toBe(true);
  });

  it("is last-write-wins on the same field", async () => {
    const server = { row: { name: "Card" } as DesignCard };
    const a = session(server);
    const b = session(server);
    a.edit({ rarity: "A" });
    b.edit({ rarity: "B" });
    await a.saver.flush();
    await b.saver.flush();
    expect(server.row.rarity).toBe("B");
  });

  it("removes a field one elder cleared without touching what the other changed", async () => {
    const server = { row: { name: "Card", rarity: "R", reference: "Gen 1:1" } as DesignCard };
    const a = session(server);
    const b = session(server);
    a.edit({ rarity: undefined });
    await a.saver.flush();
    b.edit({ reference: "Gen 2:2" });
    await b.saver.flush();
    expect(server.row).toEqual({ name: "Card", reference: "Gen 2:2" });
  });
});

describe("incomingAction", () => {
  const S0: DesignCard = { name: "A" };
  const S1: DesignCard = { name: "B" };
  const merged: DesignCard = { name: "B", rarity: "R" };

  it("ignores this session's own write", () => {
    expect(incomingAction({ incoming: S1, latest: S1, lastSaved: S1, busy: false })).toBe("ignore");
  });
  it("ignores an echo that differs only by an undefined key", () => {
    expect(incomingAction({ incoming: S1, latest: { ...S1, rarity: undefined }, lastSaved: { ...S1, rarity: undefined }, busy: false }))
      .toBe("ignore");
  });
  it("adopts another elder's field when there are no local edits", () => {
    expect(incomingAction({ incoming: merged, latest: S1, lastSaved: S1, busy: false })).toBe("adopt");
  });
  it("warns instead of adopting when there is a local edit", () => {
    expect(incomingAction({ incoming: merged, latest: S0, lastSaved: S1, busy: false })).toBe("stale");
  });
  it("warns instead of adopting while a save is in flight, even if the editor looks clean", () => {
    expect(incomingAction({ incoming: merged, latest: S1, lastSaved: S1, busy: true })).toBe("stale");
  });
});

describe("createCardSaver sequencing", () => {
  function rig(row: DesignCard = { name: "S0" }) {
    const latest = { current: row };
    const lastSaved = { current: row };
    const d = deferredSend();
    return { latest, lastSaved, ...d, saver: createCardSaver({ latest, lastSaved, send: d.send }) };
  }

  it("sends nothing and stays idle when there is nothing to save", async () => {
    const { saver, calls } = rig();
    await expect(saver.flush()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
    expect(saver.busy()).toBe(false);
    // A clean flush must not wedge the next one.
    await expect(saver.flush()).resolves.toBe(true);
  });

  it("keeps one save in flight, then sends the rest against what the first one stored", async () => {
    const { saver, calls, latest, lastSaved } = rig();
    latest.current = { name: "S1" };
    const first = saver.flush();
    latest.current = { name: "S1", rarity: "R" };
    const second = saver.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].patch).toEqual({ set: { name: "S1" }, remove: [] });

    calls[0].resolve({ ok: true });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(calls[1].patch).toEqual({ set: { rarity: "R" }, remove: [] });
    expect(lastSaved.current).toEqual({ name: "S1" });

    calls[1].resolve({ ok: true });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(lastSaved.current).toEqual({ name: "S1", rarity: "R" });
    expect(saver.busy()).toBe(false);
  });

  it("never lets lastSaved claim an edit the server has not stored", async () => {
    const { saver, calls, latest, lastSaved } = rig();
    latest.current = { name: "S1" };
    void saver.flush();
    latest.current = { name: "S2" };     // typed during the flight, not yet asked to save
    calls[0].resolve({ ok: true });
    await flushMicrotasks();
    expect(lastSaved.current).toEqual({ name: "S1" });
    expect(calls).toHaveLength(1);       // left to its own debounce
  });

  it("saves an edit undone during a flight, which would otherwise look already saved", async () => {
    const { saver, calls, latest, lastSaved } = rig();
    latest.current = { name: "S1" };
    void saver.flush();

    // The autosave guard compares against target(), so the undo arms a save.
    latest.current = { name: "S0" };
    expect(sameSnapshot(latest.current, lastSaved.current)).toBe(true);
    expect(sameSnapshot(latest.current, saver.target())).toBe(false);

    const undo = saver.flush();
    calls[0].resolve({ ok: true });
    await flushMicrotasks();
    expect(calls[1].patch).toEqual({ set: { name: "S0" }, remove: [] });
    calls[1].resolve({ ok: true });
    await undo;
    expect(lastSaved.current).toEqual({ name: "S0" });
    expect(sameSnapshot(saver.target(), lastSaved.current)).toBe(true);
  });

  it("does not undo a Load their version pressed during a flight", async () => {
    const { saver, calls, latest, lastSaved } = rig();
    latest.current = { name: "S1" };
    const flight = saver.flush();
    const theirs: DesignCard = { name: "S0", rarity: "Theirs" };
    lastSaved.current = theirs;
    latest.current = theirs;
    calls[0].resolve({ ok: true });
    await flight;
    expect(lastSaved.current).toBe(theirs);
  });

  describe("failures (U-10)", () => {
    it("resolves false on a network throw, and does not advance lastSaved", async () => {
      const { saver, calls, latest, lastSaved } = rig();
      latest.current = { name: "S1" };
      const flight = saver.flush();
      calls[0].reject(new TypeError("Failed to fetch"));
      await expect(flight).resolves.toBe(false);
      expect(lastSaved.current).toEqual({ name: "S0" });
      expect(saver.busy()).toBe(false);
    });

    it("resolves false when the server refuses", async () => {
      const { saver, calls, latest, lastSaved } = rig();
      latest.current = { name: "S1" };
      const flight = saver.flush();
      calls[0].resolve({ ok: false });
      await expect(flight).resolves.toBe(false);
      expect(lastSaved.current).toEqual({ name: "S0" });
    });

    it("carries the failed fields into the next attempt", async () => {
      const { saver, calls, latest, lastSaved } = rig();
      latest.current = { name: "S1" };
      const failed = saver.flush();
      calls[0].reject(new TypeError("Failed to fetch"));
      await failed;

      latest.current = { name: "S1", rarity: "R" };
      const retry = saver.flush();
      expect(calls[1].patch).toEqual({ set: { name: "S1", rarity: "R" }, remove: [] });
      calls[1].resolve({ ok: true });
      await expect(retry).resolves.toBe(true);
      expect(lastSaved.current).toEqual({ name: "S1", rarity: "R" });
    });

    it("tries again when a save was asked for during the flight that failed", async () => {
      const { saver, calls, latest } = rig();
      latest.current = { name: "S1" };
      const first = saver.flush();
      latest.current = { name: "S2" };
      const second = saver.flush();

      calls[0].reject(new TypeError("Failed to fetch"));
      await flushMicrotasks();
      expect(calls[1].patch).toEqual({ set: { name: "S2" }, remove: [] });

      calls[1].resolve({ ok: true });
      await expect(first).resolves.toBe(true);
      await expect(second).resolves.toBe(true);
    });

    it("stops after one attempt rather than retrying on its own", async () => {
      const { saver, calls, latest } = rig();
      latest.current = { name: "S1" };
      const flight = saver.flush();
      calls[0].reject(new TypeError("Failed to fetch"));
      await flight;
      await flushMicrotasks();
      expect(calls).toHaveLength(1);
    });
  });
});
