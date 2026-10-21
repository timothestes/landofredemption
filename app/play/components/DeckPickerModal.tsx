"use client";

import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { MobileDrawer } from "@/components/ui/mobile-drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { DeckPickerContent, type PickerTab } from "./DeckPickerContent";
import type { DeckOption } from "./DeckPickerCard";

// ─── Props ──────────────────────────────────────────────────────────

export type { PickerTab };

interface DeckPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (deck: DeckOption) => void;
  selectedDeckId?: string | null;
  /** Tab to open on. "starter" falls back to "my" when no starter decks are configured. */
  initialTab?: PickerTab;
}


// ─── Main modal component ───────────────────────────────────────────

export function DeckPickerModal({
  open,
  onOpenChange,
  onSelect,
  selectedDeckId,
  initialTab,
}: DeckPickerModalProps) {
  // Height-aware: a landscape phone (852x393) satisfies min-width alone and
  // got the desktop Dialog — which has no close button, leaving backdrop-tap
  // as the only undiscoverable exit. Short viewports get the drawer instead.
  const isDesktop = useMediaQuery("(min-width: 768px) and (min-height: 600px)");

  const handleSelect = useCallback(
    (deck: DeckOption) => {
      onSelect(deck);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const content = (
    <DeckPickerContent
      selectedDeckId={selectedDeckId}
      onSelect={handleSelect}
      initialTab={initialTab}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select a Deck</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex-1 overflow-hidden flex flex-col gap-3 p-4">
            {content}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <MobileDrawer
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Select a Deck"
    >
      <div className="flex flex-col gap-3 px-4 pb-4 h-full overflow-hidden">
        {content}
      </div>
    </MobileDrawer>
  );
}
