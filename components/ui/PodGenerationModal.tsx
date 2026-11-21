"use client";

import { useState } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface PodGenerationModalProps {
  show: boolean;
  participants: any[];
  onClose: () => void;
}

export default function PodGenerationModal({ show, participants, onClose }: PodGenerationModalProps) {
  // Pods change only when the host presses Generate. They used to be cleared
  // whenever the dialog opened or the player count moved, so closing it, or a
  // player joining by QR while it was open (the roster refreshes in the
  // background), threw away pods the room had already been told.
  const [podSize, setPodSize] = useState(4);
  const [pods, setPods] = useState<any[][]>([]);
  // The chosen size, capped by the roster, so a short roster doesn't
  // overwrite the host's choice.
  const size = Math.min(podSize, participants.length, 8);

  const handleGenerate = () => {
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const total = shuffled.length;
    const S = size;
    const fullPods = Math.floor(total / S);
    const remainder = total - fullPods * S;
    const podsArr: any[][] = [];
    let index = 0;
    for (let i = 0; i < fullPods; i++) {
      podsArr.push(shuffled.slice(index, index + S));
      index += S;
    }
    if (remainder > 0) {
      const leftovers = shuffled.slice(index);
      if (fullPods > 1) {
        leftovers.forEach((player, idx) => {
          podsArr[idx % podsArr.length].push(player);
        });
      } else {
        podsArr.push(leftovers);
      }
    }
    setPods(podsArr);
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Generate Booster Draft Pods</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="text-sm text-muted-foreground">Participants: {participants.length}</div>
          <div>
            <label htmlFor="pod-size" className="text-sm font-medium text-foreground block mb-1">Pod Size</label>
            <select
              id="pod-size"
              value={size.toString()}
              onChange={(e) => setPodSize(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring focus:outline-none"
            >
              {Array.from({ length: Math.min(participants.length, 8) }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
          {pods.length > 0 && (
            <div className="space-y-2">
              {pods.map((group, i) => (
                <div key={i} className="border border-border p-2 rounded">
                  <h5 className="font-semibold text-foreground">Pod {i + 1}</h5>
                  <ul className="list-disc list-inside text-foreground">
                    {group.map((p) => (
                      <li key={p.id || p.name}>{p.name}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="success" onClick={handleGenerate}>
            Generate Pods
          </Button>
          <Button type="button" variant="cancel" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
