import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardTile from "../CardTile";

const tile = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(CardTile, {
      card: { card_name: "Son of God", card_img_file: "/cards/sog.jpg", quantity: 1 },
      ...props,
    }),
  );

describe("CardTile image loading", () => {
  it("lazy-loads by default", () => {
    const html = tile();
    expect(html).toContain('loading="lazy"');
    expect(html).not.toMatch(/fetchpriority="high"/i);
  });

  it("fetches an above-the-fold tile eagerly at high priority", () => {
    const html = tile({ priority: true });
    expect(html).toMatch(/fetchpriority="high"/i);
    expect(html).not.toContain('loading="lazy"');
  });
});
