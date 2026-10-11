import { excerptFromMarkdown } from "@/app/articles/lib/markdown";

const WORDS_PER_MINUTE = 230;

/**
 * Word count and reading time for the editor's hint line. Goes through
 * excerptFromMarkdown so code fences, images, URLs, `[[mentions]]` and
 * list/heading markers are not counted as words.
 */
export function wordStats(md: string): { words: number; minutes: number } {
  const words = excerptFromMarkdown(md, Infinity).split(/\s+/).filter(Boolean).length;
  return { words, minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) };
}
