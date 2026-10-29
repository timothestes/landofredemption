/** The id after `current` in order, wrapping; the first id when `current` is null or not in the list. */
export function nextAmber(ids: string[], current: string | null): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}

export type RowKeyAction = 'open' | 'inc' | 'dec' | 'remove' | 'next' | 'prev';

/** What a key does on a focused row; null for keys the row ignores. */
export function rowKeyAction(e: { key: string }): RowKeyAction | null {
  switch (e.key) {
    case 'Enter': return 'open';
    case '+':
    case '=': return 'inc';
    case '-': return 'dec';
    case 'Delete':
    case 'Backspace': return 'remove';
    case 'ArrowDown': return 'next';
    case 'ArrowUp': return 'prev';
    default: return null;
  }
}
