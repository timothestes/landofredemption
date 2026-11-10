"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import DeckPhotoReader from "../scan/components/DeckPhotoReader";
import HandoffBar from "../scan/components/HandoffBar";
import { DECK_COPY } from "../scan/copy";
import type { DeckTrayState } from "../scan/types";

const RETURN_TO = encodeURIComponent("/decklist/generate?source=photo");

interface Props {
  /** The signed-in user's id, or null when signed out. */
  userId: string | null;
  /** False while another source is showing: the reader stays mounted so a read in flight is not lost. */
  active: boolean;
  onChange: (state: DeckTrayState) => void;
}

/**
 * The generate page's photo source: the deck photo reader in place of the textarea, with Open in deck builder
 * under the tray (the page's own Generate button is the primary hand-off). Signed out, a sign-in prompt:
 * every read is a paid call behind per-user limits.
 */
export default function PhotoSource({ userId, active, onChange }: Props) {
  if (userId === null) {
    return (
      <div className="rounded-md bg-card p-6 text-center">
        <Camera className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium">{DECK_COPY.signedOutTitle}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={`/sign-in?redirectTo=${RETURN_TO}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none"
          >
            Sign in
          </Link>
          <Link
            href={`/sign-up?redirectTo=${RETURN_TO}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-muted focus:outline-none"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }
  return (
    <DeckPhotoReader
      userId={userId}
      active={active}
      onChange={onChange}
      signInHref={`/sign-in?redirectTo=${RETURN_TO}`}
      trayClassName="-mx-5 sm:mx-0"
      footer={ctx => <HandoffBar {...ctx} variant="builderOnly" />}
    />
  );
}
