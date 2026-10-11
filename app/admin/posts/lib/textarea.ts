// Pure text-manipulation for the markdown toolbar. Every function returns the
// new value plus the selection the textarea should restore. No DOM here.

export interface Selection {
  start: number;
  end: number;
}

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wrap the selection (or a placeholder) with `before`/`after`, keeping the inner text selected. */
export function wrapSelection(
  value: string,
  sel: Selection,
  before: string,
  after: string = before,
  placeholder = "text",
): EditResult {
  const inner = value.slice(sel.start, sel.end) || placeholder;
  const next = value.slice(0, sel.start) + before + inner + after + value.slice(sel.end);
  const start = sel.start + before.length;
  return { value: next, selectionStart: start, selectionEnd: start + inner.length };
}

/** Prefix every line the selection touches (heading, quote, list). Idempotent per line. */
export function prefixLines(value: string, sel: Selection, prefix: string): EditResult {
  const lineStart = value.lastIndexOf("\n", sel.start - 1) + 1;
  const nl = value.indexOf("\n", sel.end);
  const lineEnd = nl === -1 ? value.length : nl;
  const block = value.slice(lineStart, lineEnd);
  const prefixed = block
    .split("\n")
    .map((l) => (l.startsWith(prefix) ? l : prefix + l))
    .join("\n");
  const next = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
  const end = lineStart + prefixed.length;
  return { value: next, selectionStart: sel.start === sel.end ? end : lineStart, selectionEnd: end };
}

/** Insert a standalone block (YouTube URL, media placeholder) on its own paragraph. */
export function insertBlock(value: string, sel: Selection, block: string): EditResult {
  const before = value.slice(0, sel.start).replace(/\n+$/, (m) => m.slice(0, 2));
  const after = value.slice(sel.end).replace(/^\n+/, (m) => m.slice(0, 2));
  const pre = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const post = after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = pre + block + post;
  const caret = before.length + inserted.length;
  return { value: before + inserted + after, selectionStart: caret, selectionEnd: caret };
}

/**
 * Href for a typed link URL. Schemes, site-relative paths and anchors stay as
 * typed; a bare "example.com" gets https://, since a relative href would
 * resolve under /articles/<slug>.
 */
export function normalizeHref(url: string): string {
  const u = url.trim();
  return /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u) ? u : `https://${u}`;
}

/** First-occurrence string replace without regex semantics in `needle`. */
export function replaceOnce(value: string, needle: string, replacement: string): string {
  const i = value.indexOf(needle);
  return i === -1 ? value : value.slice(0, i) + replacement + value.slice(i + needle.length);
}

/**
 * The smallest single range that turns `oldValue` into `newValue`, so the
 * editor can apply a helper's output with execCommand("insertText") over just
 * that range and keep the browser's undo stack. Null when nothing changed.
 */
export function minimalEdit(oldValue: string, newValue: string): { start: number; end: number; text: string } | null {
  if (oldValue === newValue) return null;
  let start = 0;
  const maxStart = Math.min(oldValue.length, newValue.length);
  while (start < maxStart && oldValue[start] === newValue[start]) start++;
  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, end: oldEnd, text: newValue.slice(start, newEnd) };
}

const LIST_LINE = /^(\s*)([-*+]|\d+\.|>)\s(.*)$/;

/**
 * Enter inside a list or quote: continue it on the next line (numbers
 * increment); Enter on an empty item strips the marker instead so the list
 * ends. Null when the caret isn't in a list line, or the selection isn't
 * collapsed, so the textarea keeps its default Enter.
 */
export function continueList(value: string, sel: Selection): EditResult | null {
  if (sel.start !== sel.end) return null;
  const lineStart = value.lastIndexOf("\n", sel.start - 1) + 1;
  const m = LIST_LINE.exec(value.slice(lineStart, sel.start));
  if (!m) return null;
  const [, indent, marker, content] = m;
  if (content.trim() === "") {
    const atLineEnd = sel.start === value.length || value[sel.start] === "\n";
    if (!atLineEnd) return null;
    return { value: value.slice(0, lineStart) + value.slice(sel.start), selectionStart: lineStart, selectionEnd: lineStart };
  }
  const next = /^\d+\.$/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
  const inserted = `\n${indent}${next} `;
  const caret = sel.start + inserted.length;
  return { value: value.slice(0, sel.start) + inserted + value.slice(sel.start), selectionStart: caret, selectionEnd: caret };
}
