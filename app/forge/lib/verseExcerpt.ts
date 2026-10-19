import { textFit } from "@/app/forge/lib/textFit";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type Verse = { n: number; text: string };
/** `verse` is Verse.n; `word` indexes words(verse.text). Start is inclusive, end exclusive (end may sit one past the last word). */
export type Handle = { verse: number; word: number };
export type Handles = { start: Handle; end: Handle };

const OPEN_QUOTE = /^[“‘"]/;
const SENTENCE_END = /[.!?][”’"]?$/;
const MIN_WORDS = 3;

export function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Verses flattened to one word axis: each verse's offset on it. */
function layout(verses: Verse[]) {
  let total = 0;
  const rows = verses.map((v) => {
    const w = words(v.text);
    const row = { n: v.n, w, offset: total };
    total += w.length;
    return row;
  });
  return { rows, total };
}

function toLinear(rows: ReturnType<typeof layout>["rows"], total: number, h: Handle): number {
  const row = rows.find((r) => r.n === h.verse);
  if (!row) return h.verse < (rows[0]?.n ?? 0) ? 0 : total;
  return row.offset + Math.min(Math.max(h.word, 0), row.w.length);
}

/** Start handles name the word they include; end handles name the word they stop after. */
function fromLinear(rows: ReturnType<typeof layout>["rows"], i: number, which: "start" | "end"): Handle {
  const row =
    which === "start"
      ? rows.find((r) => r.w.length && i >= r.offset && i < r.offset + r.w.length)
      : rows.find((r) => r.w.length && i > r.offset && i <= r.offset + r.w.length);
  if (!row) return { verse: rows[rows.length - 1]?.n ?? 0, word: 0 };
  return { verse: row.n, word: i - row.offset };
}

function resolve(verses: Verse[], s: number, e: number): Handles {
  const { rows, total } = layout(verses);
  if (total === 0) return { start: { verse: rows[0]?.n ?? 0, word: 0 }, end: { verse: rows[0]?.n ?? 0, word: 0 } };
  e = Math.min(Math.max(e, 1), total);
  s = Math.min(Math.max(s, 0), e - 1);
  return { start: fromLinear(rows, s, "start"), end: fromLinear(rows, e, "end") };
}

export function clampHandles(verses: Verse[], h: Handles): Handles {
  const { rows, total } = layout(verses);
  const s = toLinear(rows, total, h.start);
  const e = Math.max(toLinear(rows, total, h.end), s + 1);
  return resolve(verses, Math.min(s, total - 1), e);
}

export function wholeRange(verses: Verse[], from: number, to: number): Handles {
  const { rows } = layout(verses);
  const last = rows.find((r) => r.n === to);
  return clampHandles(verses, { start: { verse: from, word: 0 }, end: { verse: to, word: last?.w.length ?? 0 } });
}

export function moveHandle(verses: Verse[], h: Handles, which: "start" | "end", delta: -1 | 1): Handles {
  const { rows, total } = layout(verses);
  const s = toLinear(rows, total, h.start);
  const e = toLinear(rows, total, h.end);
  return which === "start" ? resolve(verses, Math.min(s + delta, e - 1), e) : resolve(verses, s, Math.max(e + delta, s + 1));
}

export function snapHandle(verses: Verse[], h: Handles, which: "start" | "end", edge: "home" | "end"): Handles {
  const { rows, total } = layout(verses);
  const s = toLinear(rows, total, h.start);
  const e = toLinear(rows, total, h.end);
  const row = rows.find((r) => r.n === h[which].verse);
  if (!row || !row.w.length) return h;
  if (which === "start") {
    const i = edge === "home" ? row.offset : row.offset + row.w.length - 1;
    return resolve(verses, Math.min(i, e - 1), e);
  }
  const i = edge === "home" ? row.offset + 1 : row.offset + row.w.length;
  return resolve(verses, s, Math.max(i, s + 1));
}

export function excerpt(verses: Verse[], h: Handles): { text: string; from: number; to: number } {
  const { rows, total } = layout(verses);
  const c = clampHandles(verses, h);
  const s = toLinear(rows, total, c.start);
  const e = toLinear(rows, total, c.end);
  const kept = rows.flatMap((r) => r.w.map((w, k) => ({ w, n: r.n, at: r.offset + k }))).filter((x) => x.at >= s && x.at < e);
  if (!kept.length) return { text: "", from: c.start.verse, to: c.end.verse };

  const parts = kept.map((x) => x.w);
  const first = parts[0];
  const last = parts[parts.length - 1];
  const bare = first.replace(OPEN_QUOTE, "");
  const rowOf = (n: number) => rows.find((r) => r.n === n)!;
  const leading = kept[0].at > rowOf(kept[0].n).offset || /^\p{Ll}/u.test(bare);
  const lastKept = kept[kept.length - 1];
  const cutEnd = lastKept.at + 1 < rowOf(lastKept.n).offset + rowOf(lastKept.n).w.length;
  const trailing = (cutEnd || /[,;:][”’"]?$/.test(last)) && !SENTENCE_END.test(last);

  if (leading) parts[0] = bare;
  // The ellipsis replaces trailing punctuation and sits before a closing quote: `war,”` -> `war…”`.
  let closing = "";
  if (trailing) {
    const tail = parts[parts.length - 1].replace(/[,;:](?=[”’"]?$)/, "");
    const q = tail.match(/[”’"]$/);
    closing = q ? q[0] : "";
    parts[parts.length - 1] = closing ? tail.slice(0, -1) : tail;
  }
  return {
    text: (leading ? "…" : "") + parts.join(" ") + (trailing ? "…" + closing : ""),
    from: kept[0].n,
    to: kept[kept.length - 1].n,
  };
}

export function trimToFit(verses: Verse[], h: Handles, card: DesignCard): Handles | null {
  const fits = (x: Handles) => textFit({ ...card, scripture: excerpt(verses, x).text }).over === 0;
  const { rows, total } = layout(verses);
  let cur = h;
  while (!fits(cur)) {
    cur = moveHandle(verses, cur, "end", -1);
    if (toLinear(rows, total, cur.end) - toLinear(rows, total, cur.start) < MIN_WORDS) return null;
  }
  return cur;
}
