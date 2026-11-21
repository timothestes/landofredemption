import React, { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface ParticipantFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Saves one name. Resolves false when the save failed. */
  onSubmit: (name: string) => Promise<boolean>;
  existingNames?: string[];
}

const ParticipantFormModal: React.FC<ParticipantFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  existingNames = [],
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  // What this sitting of the dialog has done so far. A roster is typed one
  // name after another with the dialog left open, so the result of each save
  // is shown here rather than in a toast the host has already typed past.
  const [added, setAdded] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    // Cleared on open, not on close: a save still in flight when Done was
    // pressed lands after the close.
    if (isOpen) {
      setAdded([]);
      setFailed([]);
    }
    if (!isOpen) {
      setDuplicateName(null);
    }
  }, [isOpen]);

  // The field is cleared and focused again at once, so the next name can be
  // typed while this one saves.
  const add = async (name: string) => {
    formRef.current?.reset();
    setTimeout(() => inputRef.current?.focus(), 0);
    const ok = await onSubmit(name);
    if (ok) {
      setAdded((prev) => [...prev, name]);
      setFailed((prev) => prev.filter((n) => n !== name));
    } else {
      setFailed((prev) => (prev.includes(name) ? prev : [...prev, name]));
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name")?.toString().trim();
    if (!name) return;

    const normalized = name.toLowerCase();
    const collision = [...existingNames, ...added].find(
      (existing) => existing.trim().toLowerCase() === normalized,
    );
    if (collision) {
      setDuplicateName(name);
      return;
    }
    add(name);
  };

  const confirmDuplicate = () => {
    if (duplicateName) {
      setDuplicateName(null);
      add(duplicateName);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {duplicateName ? "Duplicate name" : "Add Participant"}
          </DialogTitle>
        </DialogHeader>
        {duplicateName ? (
          <>
            <DialogBody>
              <p className="text-sm text-foreground">
                There&apos;s already a participant named{" "}
                <span className="font-semibold">{duplicateName}</span> in this tournament.
                Add another anyway?
              </p>
            </DialogBody>
            <DialogFooter className="justify-end">
              <Button type="button" variant="success" onClick={confirmDuplicate}>
                Add anyway
              </Button>
              <Button
                type="button"
                variant="cancel"
                onClick={() => {
                  setDuplicateName(null);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit}>
            <DialogBody className="space-y-1">
              <label htmlFor="name" className="text-sm font-medium text-foreground">Participant Name</label>
              <input
                id="name"
                name="name"
                type="text"
                required
                ref={inputRef}
                maxLength={35}
                placeholder="Max 35 characters"
                className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
              />
              {failed.length > 0 && (
                <p role="alert" className="pt-1 text-sm text-destructive">
                  Couldn&apos;t add {failed.join(", ")}. Type {failed.length === 1 ? "the name" : "them"} again.
                </p>
              )}
              {added.length > 0 && (
                <p aria-live="polite" className="pt-1 text-sm text-muted-foreground">
                  Added {added[added.length - 1]}
                  {added.length > 1 && ` · ${added.length} added`}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="justify-end">
              <Button type="submit" variant="success">
                Add
              </Button>
              <Button type="button" variant="cancel" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ParticipantFormModal;
