import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface EditTournamentNameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  tournamentName: string;
  setTournamentName: (name: string) => void;
}

export default function EditTournamentNameModal({
  isOpen,
  onClose,
  onSave,
  tournamentName,
  setTournamentName,
}: EditTournamentNameModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit Tournament Name</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <input
            value={tournamentName}
            onChange={(e) => setTournamentName(e.target.value)}
            placeholder="Tournament Name (max 35 characters)"
            required
            maxLength={35}
            className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
          />
        </DialogBody>
        <DialogFooter className="justify-end">
          {/* A blank name would leave the page with an empty heading. */}
          <Button variant="success" onClick={onSave} disabled={!tournamentName.trim()}>
            Save
          </Button>
          <Button variant="cancel" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
