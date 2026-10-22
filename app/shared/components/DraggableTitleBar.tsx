'use client';

import { GripVertical, X } from 'lucide-react';
import type { CSSProperties, ReactNode, PointerEvent } from 'react';

interface DraggableTitleBarProps {
  dragHandleProps: {
    onPointerDown: (e: PointerEvent) => void;
    style: CSSProperties;
  };
  title: string;
  /** Pixel padding of the parent modal container — used to extend the bar edge-to-edge. Defaults to 20. */
  parentPadding?: number;
  /** Spacing between the title bar and content below. Defaults to 16. */
  bottomGap?: number;
  onClose?: () => void;
  /** Extra items rendered next to the title (e.g. selection count badge). */
  children?: ReactNode;
}

/**
 * Windows-style title bar that doubles as a drag handle. Visually distinct strip
 * across the top of a modal — subtle gradient, grip icon, close button. Uses
 * negative margins to span flush to the modal edges inside a padded container.
 */
export function DraggableTitleBar({
  dragHandleProps,
  title,
  parentPadding = 20,
  bottomGap = 16,
  onClose,
  children,
}: DraggableTitleBarProps) {
  return (
    <div
      {...dragHandleProps}
      data-modal-title-bar
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        // Pull edge-to-edge past the parent's padding. Explicit width is
        // required in flex-column parents, where negative horizontal margins
        // alone don't widen the item.
        width: `calc(100% + ${parentPadding * 2}px)`,
        boxSizing: 'border-box',
        margin: `-${parentPadding}px -${parentPadding}px ${bottomGap}px -${parentPadding}px`,
        padding: '8px 10px 8px 8px',
        background: 'rgba(var(--gf-bg-dark-rgb), 0.55)',
        borderBottom: '1px solid var(--gf-border)',
        borderTopLeftRadius: 7,
        borderTopRightRadius: 7,
        userSelect: 'none',
        flexShrink: 0,
        touchAction: 'none',
        ...dragHandleProps.style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        <div
          aria-hidden
          style={{
            display: 'flex',
            alignItems: 'center',
            color: 'var(--gf-text-dim)',
            opacity: 0.7,
            marginLeft: 2,
            flexShrink: 0,
          }}
        >
          <GripVertical size={14} />
          <GripVertical size={14} style={{ marginLeft: -10 }} />
        </div>
        <h2
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 14,
            color: 'var(--gf-text-bright)',
            letterSpacing: '0.03em',
            margin: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {title}
        </h2>
        {children}
      </div>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--gf-text-dim)',
            width: 28,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            flexShrink: 0,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.15)';
            e.currentTarget.style.color = 'var(--gf-text-bright)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--gf-text-dim)';
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
