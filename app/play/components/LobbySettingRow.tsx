'use client';

import type { ReactNode } from 'react';

/**
 * One row of the waiting card's settings list: label + hint on the left, the
 * control on the right, so every setting lines up the same way.
 */
export function LobbySettingRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-3 py-2 text-left">
      <div className="min-w-0">
        <p className="truncate text-xs text-amber-200/80">{label}</p>
        {hint && <div className="mt-0.5 truncate text-[11px] text-amber-200/45">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function LobbySwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative ml-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-amber-200/20'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export const lobbyTextButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded border border-amber-200/20 px-2.5 text-[11px] text-amber-200/70 hover:bg-amber-200/5 hover:text-amber-200/90 transition-colors disabled:opacity-50';
