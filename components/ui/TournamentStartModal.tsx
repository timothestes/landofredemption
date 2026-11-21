"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface TournamentStartModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Resolves once the tournament is started and round 1 is paired (or that
  // failed). The Start button stays disabled until then.
  onConfirm: (numberOfRounds: number, roundLength: number, maxScore: number, byePoints: number, byeDifferential: number, startingTableNumber: number, soundNotifications: boolean) => void | Promise<void>;
  participantCount: number;
  suggestedRounds: number;
  // Persisted tournament settings to seed the form with (e.g. values prefilled
  // from the chosen category, or anything the host set beforehand). Each falls
  // back to the standard default when null/undefined.
  defaultRoundLength?: number | null;
  defaultMaxScore?: number | null;
  defaultByePoints?: number | null;
  defaultByeDifferential?: number | null;
  defaultStartingTableNumber?: number | null;
  defaultSoundNotifications?: boolean | null;
  // "N of M participants have decklists" — same figure shown pre-start under
  // the Participants toolbar; null/omitted hides the line (tournament doesn't
  // require decklists).
  decklistSummary?: { submitted: number; total: number } | null;
}

export default function TournamentStartModal({
  isOpen,
  onClose,
  onConfirm,
  participantCount,
  suggestedRounds,
  defaultRoundLength,
  defaultMaxScore,
  defaultByePoints,
  defaultByeDifferential,
  defaultStartingTableNumber,
  defaultSoundNotifications,
  decklistSummary,
}: TournamentStartModalProps) {
  const initialRoundLength = defaultRoundLength ?? 45;
  const initialMaxScore = defaultMaxScore ?? 5;
  const initialByePoints = defaultByePoints ?? 3;
  const initialByeDifferential = defaultByeDifferential ?? 0;
  const initialStartingTableNumber = defaultStartingTableNumber ?? 1;
  const initialSoundNotifications = defaultSoundNotifications ?? false;

  const [numberOfRounds, setNumberOfRounds] = useState(suggestedRounds);
  const [roundLength, setRoundLength] = useState(initialRoundLength);
  const [maxScore, setMaxScore] = useState(initialMaxScore);
  const [byePoints, setByePoints] = useState(initialByePoints);
  const [byeDifferential, setByeDifferential] = useState(initialByeDifferential);
  const [startingTableNumber, setStartingTableNumber] = useState(initialStartingTableNumber);
  const [soundNotifications, setSoundNotifications] = useState(initialSoundNotifications);

  // Open Advanced Settings up front when any value there was seeded away from the
  // standard default, so a prefilled souls score (etc.) isn't hidden.
  const hasNonDefaultAdvanced =
    initialMaxScore !== 5 ||
    initialByePoints !== 3 ||
    initialByeDifferential !== 0 ||
    initialStartingTableNumber !== 1 ||
    initialSoundNotifications !== false;
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(hasNonDefaultAdvanced);

  // Seed the form when the dialog OPENS, and only then. Keying this on the
  // prop values too would discard whatever the host has typed the moment one
  // of them moves — and `suggestedRounds` moves on its own now that the roster
  // refreshes in the background: a player scanning the QR while this dialog is
  // open crosses a 2/4/8/16 boundary, and the host's round count, round length
  // and starting table all silently snap back to defaults.
  useEffect(() => {
    if (!isOpen) return;
    setNumberOfRounds(suggestedRounds);
    setRoundLength(initialRoundLength);
    setMaxScore(initialMaxScore);
    setByePoints(initialByePoints);
    setByeDifferential(initialByeDifferential);
    setStartingTableNumber(initialStartingTableNumber);
    setSoundNotifications(initialSoundNotifications);
    setIsAdvancedOpen(hasNonDefaultAdvanced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // A second tap while the first is still saving would pair round 1 twice.
  // The ref closes the gap before the disabled state reaches the button.
  const [isStarting, setIsStarting] = useState(false);
  const startingRef = useRef(false);
  const handleConfirm = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      await onConfirm(numberOfRounds, roundLength, maxScore, byePoints, byeDifferential, startingTableNumber, soundNotifications);
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  };

  const handleIncrement = () => {
    setNumberOfRounds(prev => prev + 1);
  };

  const handleDecrement = () => {
    setNumberOfRounds(prev => Math.max(1, prev - 1));
  };

  const ROUND_LENGTH_STEP = 5;

  const handleRoundLengthIncrement = () => {
    setRoundLength(prev => Math.min(120, Math.floor(prev / ROUND_LENGTH_STEP) * ROUND_LENGTH_STEP + ROUND_LENGTH_STEP));
  };

  const handleRoundLengthDecrement = () => {
    setRoundLength(prev => Math.max(0, Math.ceil(prev / ROUND_LENGTH_STEP) * ROUND_LENGTH_STEP - ROUND_LENGTH_STEP));
  };

  const inputClasses = "w-full bg-background border border-border text-foreground rounded-lg p-2.5 focus:outline-none focus:border-primary/60 transition-colors";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isStarting) onClose(); }}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Start Tournament</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-6">
          {/* The roster locks at Start (Add Participant and QR join both
              close). Say so while the host can still act on it. */}
          <p className="text-sm text-center text-balance text-muted-foreground">
            After you start, participants can&apos;t be added.{" "}
            <span className="font-medium text-foreground">{participantCount}</span>{" "}
            {participantCount === 1 ? "is" : "are"} in.
          </p>
          {decklistSummary && (
            <p className="text-sm text-center text-muted-foreground">
              <span className="font-medium text-foreground">
                {decklistSummary.submitted} of {decklistSummary.total}
              </span>{" "}
              participants have decklists
            </p>
          )}
          {/* Number of Rounds */}
          <div className="flex flex-col items-center jayden-gradient-bg rounded-lg border border-border p-5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Number of Rounds
            </label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 mb-4">
              <span>{participantCount} participants</span>
              <span aria-hidden>&bull;</span>
              <span>Suggested: <span className="text-foreground font-medium">{suggestedRounds}</span></span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleDecrement}
                disabled={numberOfRounds <= 1}
                className="w-11 h-11 rounded-full border border-border bg-background text-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-background disabled:hover:text-foreground transition-colors flex items-center justify-center"
                aria-label="Decrease rounds"
              >
                <span className="text-xl leading-none">&minus;</span>
              </button>
              <span className="text-4xl font-bold text-foreground tabular-nums min-w-[2ch] text-center">
                {numberOfRounds}
              </span>
              <button
                onClick={handleIncrement}
                className="w-11 h-11 rounded-full border border-border bg-background text-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/10 transition-colors flex items-center justify-center"
                aria-label="Increase rounds"
              >
                <span className="text-xl leading-none">+</span>
              </button>
            </div>
          </div>

          {/* Round Length */}
          <div className="flex flex-col items-center jayden-gradient-bg rounded-lg border border-border p-5">
            <label htmlFor="round-length" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Round Length (minutes)
            </label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 mb-4">
              <span>Steps by {ROUND_LENGTH_STEP}</span>
              <span aria-hidden>&bull;</span>
              <span>max 120</span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={handleRoundLengthDecrement}
                disabled={roundLength <= 0}
                className="w-11 h-11 rounded-full border border-border bg-background text-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-background disabled:hover:text-foreground transition-colors flex items-center justify-center"
                aria-label="Decrease round length"
              >
                <span className="text-xl leading-none">&minus;</span>
              </button>
              <input
                id="round-length"
                type="number"
                inputMode="numeric"
                value={roundLength}
                onChange={(e) => {
                  const value = Math.min(120, Math.max(0, parseInt(e.target.value) || 0));
                  setRoundLength(value);
                }}
                min="0"
                max="120"
                aria-label="Round length in minutes"
                className="w-[3ch] bg-transparent border-0 text-4xl font-bold text-foreground tabular-nums text-center p-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={handleRoundLengthIncrement}
                disabled={roundLength >= 120}
                className="w-11 h-11 rounded-full border border-border bg-background text-foreground hover:border-primary/60 hover:text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-background disabled:hover:text-foreground transition-colors flex items-center justify-center"
                aria-label="Increase round length"
              >
                <span className="text-xl leading-none">+</span>
              </button>
            </div>
          </div>

          {/* Advanced Settings Section */}
          <div>
            <button
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              className="w-full flex items-center justify-between gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              <span className="font-medium uppercase tracking-wide text-xs">Advanced Settings</span>
              <svg
                className={`w-4 h-4 transition-transform ${isAdvancedOpen ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            <div className={`space-y-4 mt-3 ${isAdvancedOpen ? '' : 'hidden'}`}>
              {/* Maximum Score */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Maximum Lost Souls Score
                </label>
                <select
                  value={maxScore}
                  onChange={(e) => setMaxScore(Number(e.target.value))}
                  className={inputClasses}
                >
                  <option value="5">5 Lost Souls</option>
                  <option value="7">7 Lost Souls</option>
                </select>
              </div>

              {/* Bye Points */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Match Points for Bye
                </label>
                <select
                  value={byePoints}
                  onChange={(e) => setByePoints(Number(e.target.value))}
                  className={inputClasses}
                >
                  <option value="1">1 Point</option>
                  <option value="1.5">1.5 Points</option>
                  <option value="2">2 Points</option>
                  <option value="3">3 Points</option>
                </select>
              </div>

              {/* Bye Differential */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Differential for Bye
                </label>
                <select
                  value={byeDifferential}
                  onChange={(e) => setByeDifferential(Number(e.target.value))}
                  className={inputClasses}
                >
                  <option value="0">0 (No Differential)</option>
                  <option value="1">+1</option>
                  <option value="2">+2</option>
                  <option value="3">+3</option>
                  <option value="4">+4</option>
                  <option value="5">+5</option>
                </select>
              </div>

              {/* Starting Table Number */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">
                  Starting Table Number
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="number"
                    value={startingTableNumber}
                    onChange={(e) => {
                      const value = Math.max(1, parseInt(e.target.value) || 1);
                      setStartingTableNumber(value);
                    }}
                    min="1"
                    className="w-24 bg-background border border-border text-foreground rounded-lg p-2.5 focus:outline-none focus:border-primary/60 transition-colors text-center tabular-nums"
                    placeholder="1"
                  />
                  <span className="text-xs text-muted-foreground flex-1 min-w-0">
                    Tables will be numbered starting from this value
                  </span>
                </div>
              </div>

              {/* Sound Notifications */}
              <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-background p-3 hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={soundNotifications}
                  onChange={(e) => setSoundNotifications(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-2 border-border text-primary bg-card focus:outline-none focus:ring-0 flex-shrink-0"
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    Play sound when timer expires
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sounds when each round timer reaches zero
                  </p>
                </div>
              </label>
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="justify-end">
          <Button
            onClick={handleConfirm}
            variant="success"
            disabled={isStarting}
          >
            {isStarting ? "Starting…" : "Start Tournament"}
          </Button>
          <Button variant="cancel" onClick={onClose} disabled={isStarting}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
