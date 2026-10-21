'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { recordManualResultAction } from '../actions';
import { DeckThumb } from '../components/DeckThumb';
import type { MatchView } from '../lib/view';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';

/** '' stays unset; anything else is clamped to 0–7. */
const parseSouls = (v: string): number | undefined =>
  v.trim() === '' ? undefined : Math.min(7, Math.max(0, Math.round(Number(v)) || 0));

export function RecordResultDialog({ view, onClose, onSaved }: {
  /** The match to record; null keeps the dialog closed. */
  view: MatchView | null;
  onClose: () => void;
  onSaved: (matchId: string) => void;
}) {
  const [winner, setWinner] = useState<string | null>(null);
  const [souls, setSouls] = useState({ a: '', b: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchId = view?.match.id ?? null;
  useEffect(() => {
    setWinner(null);
    setSouls({ a: '', b: '' });
    setError(null);
  }, [matchId]);

  if (!view) return null;
  const { a, b, series } = view;
  const live = series.inProgress;
  const gameNumber = live?.gameNumber ?? series.nextGameNumber;

  const save = async () => {
    if (!winner || saving) return;
    setSaving(true);
    setError(null);
    // A game in progress gets its result recorded on it rather than on a new row.
    const res = await recordManualResultAction({
      matchId: view.match.id,
      gameId: live?.id,
      winnerEntryId: winner,
      soulsA: parseSouls(souls.a),
      soulsB: parseSouls(souls.b),
    });
    setSaving(false);
    if (res.ok === false) { setError(res.error); return; }
    onSaved(view.match.id);
  };

  const side = (key: 'a' | 'b') => {
    const entry = key === 'a' ? a : b;
    if (!entry) return null;
    const selected = winner === entry.id;
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => setWinner(entry.id)}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
            selected ? 'border-primary text-primary' : 'border-border hover:bg-muted/40',
          )}
        >
          <DeckThumb entry={entry} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.deckName}</span>
        </button>
        <label className="flex w-20 shrink-0 flex-col gap-0.5">
          <span className={LABEL}>Souls</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={7}
            value={souls[key]}
            onChange={e => setSouls(s => ({ ...s, [key]: e.target.value }))}
            className="h-9 tabular-nums"
            aria-label={`Souls rescued by ${entry.deckName}`}
          />
        </label>
      </div>
    );
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record result by hand</DialogTitle>
          <p className={cn(LABEL, 'mt-1')}>{view.label} · Game {gameNumber}</p>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">Pick the winner.</p>
          {side('a')}
          {side('b')}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="cancel" className="min-h-11" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="min-h-11" onClick={save} disabled={!winner || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
