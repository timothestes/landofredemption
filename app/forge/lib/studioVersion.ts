// What the studio header says about a card's versions. Pure and isomorphic. Elders only: the
// playtester's page gets a version number and nothing else, so nothing here may reach it.
import { draftMovedOn } from "@/app/forge/lib/cardDiff";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";

export type StudioVersion = {
  number: number;
  // The snapshot playtesters are reading. Null when nothing is released, so the number is
  // only the card's latest iteration, as on the set grid's pill.
  releasedData: DesignCard | null;
  imagesMoved: boolean;
};

export type VersionImages = { art_key: string | null; art_is_placeholder: boolean | null; finished_key: string | null };
export type WorkingImages = {
  working_art_key: string | null; working_art_is_placeholder: boolean | null; working_finished_key: string | null;
};

// Release and Accept copy the working images onto the version (075, 083), so a difference here
// means the draft's image changed afterwards. Compared server-side: blob keys never reach a client.
export function imagesMoved(working: WorkingImages | null, version: VersionImages | null): boolean {
  if (!working || !version) return false;
  return (
    working.working_art_key !== version.art_key ||
    working.working_finished_key !== version.finished_key ||
    !!working.working_art_is_placeholder !== !!version.art_is_placeholder
  );
}

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
  return version.imagesMoved || draftMovedOn(version.releasedData, draft)
    ? { label: `${label} · edited since`, title: `Playtesters see v${version.number}. This draft has changes they don't see yet.` }
    : { label, title: `Playtesters see v${version.number}. This draft matches it.` };
}
