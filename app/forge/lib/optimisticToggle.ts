// A setting whose tick has to move the moment it's tapped, when its save takes seconds. Pure,
// so the sequence can be tested in node. `value` null means follow the server: a tick that only
// followed the server sat still for 4 s, and a second tap in that gap sent the old value again.

export type ToggleState = { value: boolean | null; saving: boolean };

export function createOptimisticToggle({ save, onState, onSaved, onFailed }: {
  // Must not reject or hang: wrap the server action in withDeadline.
  save: (next: boolean) => Promise<{ ok: boolean; error?: string }>;
  onState: (state: ToggleState) => void;
  onSaved: () => void;
  onFailed: (error?: string) => void;
}) {
  let saving = false;
  return {
    saving: () => saving,
    async set(next: boolean): Promise<void> {
      if (saving) return;
      saving = true;
      onState({ value: next, saving: true });
      const r = await save(next);
      saving = false;
      if (r.ok) {
        onState({ value: next, saving: false });
        onSaved();
      } else {
        onState({ value: null, saving: false });
        onFailed(r.error);
      }
    },
  };
}
