import { describe, it, expect } from "vitest";
import { runProposeSubmit, flushThen, runAcceptProposal } from "../proposeFlow";
import { PROPOSE_FLUSH_FAILED } from "../proposeCopy";
import { ACCEPT_FLUSH_FAILED } from "../lifecycleCopy";

// A shared call log is the whole point: the bug this guards against is an ordering
// bug, and ordering is invisible to a render-only assertion.
const logged = (log: string[]) => ({
  flush: async () => { log.push("flush"); return { ok: true }; },
  create: async () => { log.push("create"); return { ok: true as const, id: "p1" }; },
});

describe("runProposeSubmit", () => {
  it("flushes the editor's pending save before freezing the snapshot", async () => {
    const log: string[] = [];
    await runProposeSubmit(logged(log));
    expect(log).toEqual(["flush", "create"]);
  });

  it("awaits the flush rather than firing both at once", async () => {
    const log: string[] = [];
    const r = await runProposeSubmit({
      flush: async () => {
        await new Promise((res) => setTimeout(res, 10));
        log.push("flush");
        return { ok: true };
      },
      create: async () => { log.push("create"); return { ok: true as const, id: "p1" }; },
    });
    expect(log).toEqual(["flush", "create"]);
    expect(r).toEqual({ ok: true, id: "p1" });
  });

  // Without this, a failed save leaves the proposal frozen on the PREVIOUS snapshot
  // and the only signal is a "Save failed" pill far up the page.
  it("does not propose at all when the flush fails", async () => {
    const log: string[] = [];
    const r = await runProposeSubmit({
      flush: async () => { log.push("flush"); return { ok: false }; },
      create: async () => { log.push("create"); return { ok: true as const, id: "p1" }; },
    });
    expect(log).toEqual(["flush"]);
    expect(r).toEqual({ ok: false, error: PROPOSE_FLUSH_FAILED });
  });

  it("passes the server's own error through untouched", async () => {
    const r = await runProposeSubmit({
      flush: async () => ({ ok: true }),
      create: async () => ({ ok: false as const, error: "No changes to review since the last accepted version." }),
    });
    expect(r).toEqual({ ok: false, error: "No changes to review since the last accepted version." });
  });
});

describe("flushThen", () => {
  it("awaits the flush before acting on the server's copy", async () => {
    const log: string[] = [];
    const r = await flushThen(
      async () => {
        await new Promise((res) => setTimeout(res, 10));
        log.push("flush");
        return { ok: true };
      },
      async () => { log.push("act"); return "acted"; },
      "not acted",
    );
    expect(log).toEqual(["flush", "act"]);
    expect(r).toBe("acted");
  });

  it("does not act when the flush fails, and returns the given failure", async () => {
    const log: string[] = [];
    const r = await flushThen(
      async () => { log.push("flush"); return { ok: false }; },
      async () => { log.push("act"); return "acted"; },
      "not acted",
    );
    expect(log).toEqual(["flush"]);
    expect(r).toBe("not acted");
  });
});

describe("runAcceptProposal", () => {
  const acceptFlow = (log: string[], over: Partial<Parameters<typeof runAcceptProposal>[0]> = {}) =>
    runAcceptProposal({
      flush: async () => { log.push("flush"); return { ok: true }; },
      accept: async () => { log.push("accept"); return { ok: true }; },
      note: "",
      addNote: async () => { log.push("note"); },
      ...over,
    });

  // forge_accept_proposal writes the proposal over the server's draft. An autosave still
  // waiting on its debounce lands on top of that and undoes the accept in the working draft.
  it("saves pending edits, then accepts, then adds the note", async () => {
    const log: string[] = [];
    const r = await acceptFlow(log, { note: "Looks right" });
    expect(log).toEqual(["flush", "accept", "note"]);
    expect(r).toEqual({ ok: true });
  });

  it("waits for the save to finish before accepting", async () => {
    const log: string[] = [];
    await acceptFlow(log, {
      flush: async () => {
        await new Promise((res) => setTimeout(res, 10));
        log.push("flush");
        return { ok: true };
      },
    });
    expect(log).toEqual(["flush", "accept"]);
  });

  it("accepts nothing on stale text when the save fails, and says so", async () => {
    const log: string[] = [];
    const r = await acceptFlow(log, {
      flush: async () => { log.push("flush"); return { ok: false }; },
      note: "Looks right",
    });
    expect(log).toEqual(["flush"]);
    expect(r).toEqual({ ok: false, error: ACCEPT_FLUSH_FAILED });
  });

  it("passes the server's refusal through and adds no note", async () => {
    const log: string[] = [];
    const r = await acceptFlow(log, {
      accept: async () => { log.push("accept"); return { ok: false, error: "A newer version was released." }; },
      note: "Looks right",
    });
    expect(log).toEqual(["flush", "accept"]);
    expect(r).toEqual({ ok: false, error: "A newer version was released." });
  });

  it("adds no note when the box is blank", async () => {
    const log: string[] = [];
    await acceptFlow(log, { note: "   " });
    expect(log).toEqual(["flush", "accept"]);
  });
});
