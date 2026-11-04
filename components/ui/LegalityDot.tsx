/** green/red/gray for true/false/null — shared between the participant table's
 * decklist cell and the submission modal's header so the two never drift apart.
 * Kept apart from SubmissionModal so the table can show the dot without a
 * static import of the modal (and the card catalog it reaches through
 * lib/cards/lookup). */
export function LegalityDot({ isLegal }: { isLegal: boolean | null }) {
  const color =
    isLegal === true
      ? "bg-primary"
      : isLegal === false
        ? "bg-destructive"
        : "bg-muted-foreground/50";
  const label = isLegal === true ? "Legal" : isLegal === false ? "Illegal" : "Legality unknown";
  return (
    <span
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  );
}
