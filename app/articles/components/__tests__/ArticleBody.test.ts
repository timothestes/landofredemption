import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ArticleBody from "../ArticleBody";

const render = (markdown: string) => renderToStaticMarkup(createElement(ArticleBody, { markdown }));

describe("ArticleBody", () => {
  it("turns a YouTube-only paragraph into a nocookie iframe, not inside a <p>", () => {
    const html = render("Intro.\n\nhttps://youtu.be/dQw4w9WgXcQ\n\nOutro.");
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).not.toMatch(/<p[^>]*>\s*<div/);
    expect(html).toContain("<p>Intro.</p>");
  });

  it("leaves a YouTube link inside a sentence as a link", () => {
    const html = render("Watch https://youtu.be/dQw4w9WgXcQ now");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"');
  });

  it("renders an audio link as a player plus the link", () => {
    const html = render("[Episode 12](https://x.public.blob.vercel-storage.com/posts/1/ep12.mp3)");
    expect(html).toContain('<audio controls="" preload="none" src="https://x.public.blob.vercel-storage.com/posts/1/ep12.mp3"');
    expect(html).toContain(">Episode 12</a>");
  });

  it("lazy-loads images", () => {
    const html = render("![Alt text](https://x.public.blob.vercel-storage.com/posts/1/pic.webp)");
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
    expect(html).toContain('alt="Alt text"');
  });

  it('starts an image titled "reveal" face down behind the card back', () => {
    const html = render('![The Accuser](https://x.public.blob.vercel-storage.com/posts/1/accuser.jpg "reveal")');
    expect(html).toContain('aria-label="Reveal image"');
    expect(html).toContain('src="/gameplay/cardback.webp"');
    expect(html).toContain('src="https://x.public.blob.vercel-storage.com/posts/1/accuser.jpg"');
    expect(html).toContain('alt="The Accuser"');
    expect(html).not.toContain('title="reveal"');
    // Markdown wraps an image in a <p>, where a <div> is invalid.
    expect(html).not.toMatch(/<p[^>]*>.*<div/s);
  });

  it("leaves an image with any other title as a plain image", () => {
    const html = render('![Alt text](https://x.public.blob.vercel-storage.com/posts/1/pic.webp "A caption")');
    expect(html).not.toContain("cardback");
    expect(html).toContain('title="A caption"');
  });

  it("opens external links in a new tab and internal ones in place", () => {
    const html = render("[ext](https://example.com) [int](/articles)");
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toMatch(/<a href="\/articles">int<\/a>/);
  });

  describe("measured images", () => {
    const URL = "https://x.public.blob.vercel-storage.com/posts/1/pic.png";
    const refs = { cards: {}, decks: {}, terms: {}, images: { [URL]: { w: 360, h: 240 } } };
    const renderWith = (md: string) => renderToStaticMarkup(createElement(ArticleBody, { markdown: md, refs }));

    it("serves a measured image through the optimizer, with its size and a sizes capped at its own width", () => {
      const html = renderWith(`![Alt](${URL})`);
      expect(html).toContain("/_next/image?url=");
      expect(html).toContain('width="360"');
      expect(html).toContain('height="240"');
      expect(html).toContain('sizes="(min-width: 704px) 360px, min(calc(100vw - 2rem), 360px)"');
      expect(html).toContain("h-auto");
    });

    it("leaves an unmeasured image exactly as before", () => {
      const html = render(`![Alt](${URL})`);
      expect(html).not.toContain("/_next/image");
      expect(html).not.toContain("srcSet");
      expect(html).toContain(`src="${URL}"`);
    });

    it("does not re-encode an animated GIF", () => {
      const gif = "https://x.public.blob.vercel-storage.com/posts/1/anim.gif";
      const html = renderToStaticMarkup(
        createElement(ArticleBody, { markdown: `![a](${gif})`, refs: { ...refs, images: { [gif]: { w: 300, h: 200 } } } }),
      );
      expect(html).not.toContain("/_next/image");
      expect(html).toContain('width="300"');
    });
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = render("<script>alert(1)</script>\n\nSafe");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("supports GFM tables and strikethrough", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
  });
});
