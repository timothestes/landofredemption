'use client';

import { createContext, useContext, useState } from 'react';

export const SubmenuLockContext = createContext<{
  lock: () => void;
  unlock: () => void;
} | null>(null);

export const ActiveSubmenuContext = createContext<{
  active: string | null;
  setActive: (label: string | null) => void;
  closeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
} | null>(null);

export const ITEM_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 14px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--gf-text)',
  fontSize: 13,
  textAlign: 'left',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
};

export const SEPARATOR_STYLE: React.CSSProperties = {
  height: 1,
  background: 'var(--gf-border)',
  margin: '4px 8px',
  opacity: 0.5,
};

export const STEPPER_BTN_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--gf-hover)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text-bright)',
  fontSize: 14,
  fontWeight: 'bold',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
};

export const GO_BTN_STYLE: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--gf-hover-strong)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text-bright)',
  fontSize: 10,
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
  marginLeft: 2,
};

export const QUICK_COUNT_STYLE: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(var(--gf-accent-rgb), 0.12)',
  border: '1px solid var(--gf-border)',
  borderRadius: 4,
  color: 'var(--gf-text)',
  fontSize: 11,
  fontWeight: 'bold',
  fontFamily: 'var(--font-cinzel), Georgia, serif',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export function hoverEnter(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'var(--gf-hover)';
  e.currentTarget.style.color = 'var(--gf-text-bright)';
}

export function hoverLeave(e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = 'var(--gf-text)';
}

export function SubMenuActionRow({
  icon,
  label,
  max,
  onAction,
}: {
  icon: React.ReactNode;
  label: string;
  max: number;
  onAction: (count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(Math.min(3, max));
  const lockCtx = useContext(SubmenuLockContext);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      lockCtx?.lock();
    } else {
      lockCtx?.unlock();
    }
  };

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', margin: '0 4px', borderRadius: 6 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <button
          style={{ ...ITEM_STYLE, flex: 1, background: 'transparent', paddingLeft: 8 }}
          onClick={() => onAction(1)}
        >
          {icon}
          {label}
        </button>
        <button
          style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
          onClick={() => onAction(1)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.35)';
            e.currentTarget.style.borderColor = 'var(--gf-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.12)';
            e.currentTarget.style.borderColor = 'var(--gf-border)';
          }}
          title={`${label} 1`}
        >
          1
        </button>
        {max >= 6 && (
          <button
            style={{ ...QUICK_COUNT_STYLE, marginLeft: 2 }}
            onClick={() => onAction(6)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.35)';
              e.currentTarget.style.borderColor = 'var(--gf-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.12)';
              e.currentTarget.style.borderColor = 'var(--gf-border)';
            }}
            title={`${label} 6`}
          >
            6
          </button>
        )}
        <button
          onClick={toggleExpanded}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.35)';
            e.currentTarget.style.borderColor = 'var(--gf-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = expanded ? 'var(--gf-hover-strong)' : 'rgba(var(--gf-accent-rgb), 0.12)';
            e.currentTarget.style.borderColor = 'var(--gf-border)';
          }}
          style={{
            ...QUICK_COUNT_STYLE,
            marginLeft: 2,
            marginRight: 10,
            background: expanded ? 'var(--gf-hover-strong)' : 'rgba(var(--gf-accent-rgb), 0.12)',
            letterSpacing: '0.05em',
          }}
          title={`${label} custom amount...`}
        >
          X
        </button>
      </div>
      {expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 14px 6px', justifyContent: 'center' }}>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: count <= 1 ? 0.3 : 1 }}
            onClick={() => setCount(Math.max(1, count - 1))}
          >
            &minus;
          </button>
          <span style={{
            width: 24,
            textAlign: 'center',
            color: 'var(--gf-text-bright)',
            fontSize: 13,
            fontWeight: 'bold',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
          }}>
            {count}
          </span>
          <button
            style={{ ...STEPPER_BTN_STYLE, opacity: count >= max ? 0.3 : 1 }}
            onClick={() => setCount(Math.min(max, count + 1))}
          >
            +
          </button>
          <button style={GO_BTN_STYLE} onClick={() => onAction(count)}>
            Go
          </button>
        </div>
      )}
    </>
  );
}
