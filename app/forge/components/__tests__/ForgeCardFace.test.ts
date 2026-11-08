import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCardFace from "@/app/forge/components/ForgeCardFace";

const render = (props: Partial<Parameters<typeof ForgeCardFace>[0]>) =>
  renderToStaticMarkup(React.createElement(ForgeCardFace, { name: "Invented Card", rawText: "", finishedUrl: null, artUrl: null, ...props }));

describe("ForgeCardFace placeholder", () => {
  it("holds the card's shape with a visible placeholder until the finished image loads", () => {
    const html = render({ finishedUrl: "/forge/api/art/c1?kind=finished" });
    expect(html).toMatch(/aspect-ratio:750 \/ 1050/);
    const wrapper = html.match(/^<div class="([^"]*)"/)![1];
    expect(wrapper).toContain("bg-muted");
  });

  it("keeps the caller's class on the wrapper", () => {
    const html = render({ finishedUrl: "/x", className: "opacity-60" });
    expect(html.match(/^<div class="([^"]*)"/)![1]).toContain("opacity-60");
  });

  it("leaves the text tile as it was", () => {
    const html = render({ rawText: "Some text" });
    expect(html).toContain("Some text");
    expect(html).toContain("bg-muted/30");
  });
});
