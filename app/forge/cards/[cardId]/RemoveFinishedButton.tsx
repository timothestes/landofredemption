"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { removeFinished } from "@/app/forge/lib/cards";
import { removeFinishedCopy } from "@/app/forge/lib/artStatus";
import { withDeadline } from "@/app/forge/lib/withDeadline";

const REMOVE_FAILED = "Couldn’t remove it. Check your connection and try again.";

// Always asks: the image can't be put back from here, even when a released version still has it.
export default function RemoveFinishedButton({ cardId, status, disabled, onBusy }: {
  cardId: string;
  status: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setErr(null);
    setBusy(true);
    onBusy(true);
    const r = await withDeadline(removeFinished(cardId), { ok: false, error: REMOVE_FAILED });
    if (r.ok === false) {
      setErr(r.error ?? REMOVE_FAILED);
      setBusy(false);
      onBusy(false);
      router.refresh();   // past the deadline, it may have landed
      return;
    }
    // In one commit with the refreshed page, so it lasts until the card is drawn from its fields.
    startTransition(() => {
      setBusy(false);
      onBusy(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => setConfirming(true)}>
        {busy
          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          : <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        {busy ? "Removing…" : "Remove finished image"}
      </Button>
      {err && <p role="status" className="basis-full text-sm text-destructive">{err}</p>}
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void remove()}
        variant="destructive"
        {...removeFinishedCopy(status)}
      />
    </>
  );
}
