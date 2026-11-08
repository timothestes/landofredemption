import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesignCard } from "@/app/forge/lib/designCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/forge/lib/proposals", () => ({ createProposal: vi.fn(), acceptProposal: vi.fn(), denyProposal: vi.fn() }));
vi.mock("@/app/forge/lib/comments", () => ({ addComment: vi.fn() }));

import { ProposePreview } from "@/app/forge/cards/[cardId]/ReviewPanel";
import { StudioDraftProvider } from "@/app/forge/cards/[cardId]/StudioSyncContext";

const V3 = { versionNumber: 3, data: { name: "Invented", rawText: "Draw 2." } as DesignCard };

const render = (draft: DesignCard | null, saved: DesignCard, latest: typeof V3 | null = V3) =>
  renderToStaticMarkup(
    React.createElement(
      StudioDraftProvider,
      { value: draft },
      React.createElement(ProposePreview, { latestVersion: latest, savedDraft: saved }),
    ),
  );

describe("ProposePreview", () => {
  // The bug: the panel read the card prop, which trails the editor by a save and a
  // router refresh, so it said "No field changes" right after a saved edit.
  it("lists an edit the server prop hasn't caught up with", () => {
    const html = render({ name: "Invented", rawText: "Draw 3." }, V3.data);
    expect(html).not.toContain("No field changes");
    expect(html).toContain("The current draft differs from v3");
    expect(html).toContain("Draw 3.");
  });

  it("says no changes when an edit is undone, even if the server prop still has it", () => {
    const html = render(V3.data, { name: "Invented", rawText: "Draw 3." });
    expect(html).toContain("No field changes since v3");
  });

  it("falls back to the saved draft outside the studio", () => {
    expect(render(null, { name: "Invented", rawText: "Draw 9." })).toContain("Draw 9.");
  });

  it("gives a first proposal no field list", () => {
    const html = render({ name: "Invented" }, {}, null);
    expect(html).toContain("New card");
    expect(html).not.toContain("differs from");
  });
});
