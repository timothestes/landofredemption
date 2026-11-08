import { describe, it, expect, vi } from "vitest";
import { createOptimisticToggle, type ToggleState } from "../optimisticToggle";

type Answer = { ok: boolean; error?: string };

function rig() {
  const states: ToggleState[] = [];
  let answer: (r: Answer) => void = () => {};
  const save = vi.fn((_next: boolean) => new Promise<Answer>((res) => { answer = res; }));
  const onSaved = vi.fn();
  const onFailed = vi.fn();
  const toggle = createOptimisticToggle({ save, onState: (s) => states.push(s), onSaved, onFailed });
  return { toggle, states, save, onSaved, onFailed, answer: (r: Answer) => answer(r) };
}

describe("createOptimisticToggle", () => {
  it("shows the new value before the save has answered", () => {
    const r = rig();
    void r.toggle.set(true);
    expect(r.states).toEqual([{ value: true, saving: true }]);
    expect(r.save).toHaveBeenCalledWith(true);
    expect(r.onSaved).not.toHaveBeenCalled();
  });

  it("ignores a second tap while the first is saving", () => {
    const r = rig();
    void r.toggle.set(true);
    void r.toggle.set(false);
    expect(r.save).toHaveBeenCalledTimes(1);
    expect(r.states).toHaveLength(1);
  });

  it("keeps showing the value once saved, and asks for a refresh", async () => {
    const r = rig();
    const done = r.toggle.set(true);
    r.answer({ ok: true });
    await done;
    expect(r.states.at(-1)).toEqual({ value: true, saving: false });
    expect(r.onSaved).toHaveBeenCalledOnce();
    expect(r.onFailed).not.toHaveBeenCalled();
  });

  it("goes back to the server's value when the save fails, and says so", async () => {
    const r = rig();
    const done = r.toggle.set(true);
    r.answer({ ok: false, error: "Could not update placeholder" });
    await done;
    expect(r.states.at(-1)).toEqual({ value: null, saving: false });
    expect(r.onFailed).toHaveBeenCalledWith("Could not update placeholder");
    expect(r.onSaved).not.toHaveBeenCalled();
  });

  it("takes the next tap once the save has answered", async () => {
    const r = rig();
    const first = r.toggle.set(true);
    r.answer({ ok: true });
    await first;
    void r.toggle.set(false);
    expect(r.save).toHaveBeenCalledTimes(2);
    expect(r.save).toHaveBeenLastCalledWith(false);
  });

  it("reports whether a save is in flight", async () => {
    const r = rig();
    expect(r.toggle.saving()).toBe(false);
    const done = r.toggle.set(true);
    expect(r.toggle.saving()).toBe(true);
    r.answer({ ok: true });
    await done;
    expect(r.toggle.saving()).toBe(false);
  });
});
