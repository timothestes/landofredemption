// What the studio header says about a card's versions. Pure and isomorphic. Elders only: the
// playtester's page gets a version number and nothing else, so nothing here may reach it.
import { sameCardContent } from "@/app/forge/lib/cardDiff";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";

export type StudioVersion = {
  number: number;
  // The snapshot playtesters are reading. Null when nothing is released, so the number is
  // only the card's latest iteration, as on the set grid's pill.
  releasedData: DesignCard | null;
  // Worked out on the server (artChangedSince), so blob keys never reach a client.
  imagesMoved: boolean;
};

// `versions` newest first, as listVersions returns them. Approved wins over published, the same
// order the playtester's reader uses.
export function pickStudioVersion(
  card: { publishedVersionId: string | null; approvedVersionId: string | null },
  versions: { id: string; versionNumber: number; data: DesignCard }[],
  moved: boolean,
): StudioVersion | null {
  const releasedId = card.approvedVersionId ?? card.publishedVersionId;
  const released = versions.find((v) => v.id === releasedId);
  if (released) return { number: released.versionNumber, releasedData: released.data, imagesMoved: moved };
  return versions[0] ? { number: versions[0].versionNumber, releasedData: null, imagesMoved: false } : null;
}

export function versionPill(
  status: string,
  version: StudioVersion | null,
  draft: DesignCard,
): { label: string; title?: string } {
  const statusLabel = STATUS_LABEL[status] ?? status;
  if (!version) return { label: statusLabel };
  const label = `${statusLabel} · v${version.number}`;
  if (!version.releasedData) return { label };
  // Same test Release uses, so the pill and the Release dialog can't disagree about a change.
  return version.imagesMoved || !sameCardContent(version.releasedData, draft)
    ? { label: `${label} · edited since`, title: `Playtesters see v${version.number}. This draft has changes they don't see yet.` }
    : { label, title: `Playtesters see v${version.number}. This draft matches it.` };
}
