/**
 * The reader's first-photo instructions as three numbered steps: what a first-timer can take in at a glance,
 * where a column of small hints reads as a wall. Hosts pass it as the reader's `intro` and name their own last
 * step ("join", "open it in the deck builder").
 */
export default function PhotoSteps({ then }: { then: string }) {
  const steps = [
    'Lay out your deck with every title showing. Reserve in its own row.',
    'Take a photo from where you would read the cards. Big deck? Two photos, half each.',
    `Fix anything we misread, then ${then}.`,
  ];
  return (
    <ol className="space-y-2.5 pb-1 text-sm text-foreground">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
            {i + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}
