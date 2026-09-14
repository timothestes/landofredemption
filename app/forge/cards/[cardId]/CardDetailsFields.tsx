"use client";

import {
  CARD_TYPES, ALIGNMENTS, CLASSES, ICONS, RARITIES, MULTI_BRIGADES,
  deriveAlignmentFromTypes, toggleMultiBrigade, brigadeLabels,
  type DesignCard, type CardType, type Brigade,
} from "@/app/forge/lib/designCard";
import StatInput from "./StatInput";
import IdentifiersInput from "./IdentifiersInput";
import {
  typeIconSrc, brigadeIconSrc, multiBrigadeIconSrc, glyphIconSrc,
  typeLabel, brigadeLabel,
} from "@/app/forge/lib/filterIcons";
import { deriveTestamentAndGospel, formatTestament } from "@/app/decklist/card-search/data/testament";

type ClassName = (typeof CLASSES)[number];
type IconName = (typeof ICONS)[number];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? [];
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
}

// One picker option, built like the deckbuilder's filter tiles: the art does the
// fast visual work and the label keeps it unambiguous. The label always shows —
// brigade color on its own isn't a safe signal — and `title` carries the value as
// it's stored. The art is lazy so the ~35 images don't fetch while the block is
// still collapsed.
function Tile({ src, label, title, ariaLabel, selected, onClick }: {
  src: string; label: string; title: string; ariaLabel?: string;
  selected: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} title={title} aria-label={ariaLabel}
      className={`flex min-w-[56px] flex-col items-center justify-end gap-1 rounded border px-2 py-1 transition-colors ${
        selected
          ? "border-primary/40 bg-primary/15"
          : "border-transparent bg-muted/40 hover:border-border hover:bg-muted"
      }`}>
      <img src={src} alt="" aria-hidden="true" loading="lazy" className="h-7 w-auto" />
      <span className={`whitespace-nowrap text-[10px] font-medium leading-none ${
        selected ? "text-primary" : "text-muted-foreground"
      }`}>
        {label}
      </span>
    </button>
  );
}

// Structured, deck-relevant fields. The freeform text box stays the primary way to
// write a card; these give the deckbuilder/validator machine-readable data (type,
// brigade, stats, class, icons, identifiers, alignment, scripture). Every field is
// always editable so any card — including a brand-new idea with no type yet — can be
// filled out completely.
export default function CardDetailsFields({
  snapshot, update,
}: { snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void }) {
  const types = snapshot.cardType ?? [];

  // Auto-fill alignment from the selected types, without clobbering a manual
  // pick: only applies when alignment is unset, or still equals what the
  // previous type set would have derived (i.e. it hasn't been overridden).
  function onToggleType(t: CardType) {
    const newTypes = toggle<CardType>(snapshot.cardType, t);
    const prevAlignment = deriveAlignmentFromTypes(types);
    const nextAlignment = deriveAlignmentFromTypes(newTypes);
    const patch: Partial<DesignCard> = { cardType: newTypes };
    if (nextAlignment !== null && (!snapshot.alignment || snapshot.alignment === prevAlignment)) {
      patch.alignment = nextAlignment;
    }
    update(patch);
  }

  // Testament is never stored — it's derived from the reference. Mirror what the
  // deckbuilder's N.T./O.T. filter will see so designers get instant feedback
  // (and catch a mistyped reference that wouldn't classify).
  const reference = (snapshot.reference ?? "").trim();
  const { testament, isGospel } = deriveTestamentAndGospel(reference);

  // Collapsed by default (the block is tall); the summary previews what's set so
  // the card stays readable at a glance without opening it.
  const preview = [
    ...types,
    ...brigadeLabels(snapshot.brigades ?? []),
    snapshot.strength || snapshot.toughness
      ? `${snapshot.strength ?? "—"}/${snapshot.toughness ?? "—"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
        Card details
        <span className="ml-2 font-normal text-muted-foreground">
          {preview || "type, brigade, stats, identifiers…"}
        </span>
      </summary>
      <div className="space-y-4 px-4 pb-4">
      <p className="text-xs text-muted-foreground">
        Used for deck building — the builder reads these to categorize and validate the card.
      </p>

      {/* Type. Dominants and Fortresses show their good or evil art, following the
          alignment below. */}
      <div>
        <span className="mb-1 block text-sm font-medium">Type</span>
        <div className="flex flex-wrap gap-1.5">
          {CARD_TYPES.map((t) => (
            <Tile key={t}
              src={typeIconSrc(t, snapshot.alignment)}
              label={typeLabel(t)} title={t}
              selected={types.includes(t)}
              onClick={() => onToggleType(t)} />
          ))}
        </div>
      </div>

      {/* Alignment */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Alignment</span>
        <select value={snapshot.alignment ?? ""}
          onChange={(e) => update({ alignment: (e.target.value || undefined) as DesignCard["alignment"] })}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">—</option>
          {ALIGNMENTS.map((a) => <option key={a} value={a}>{a === "Good_Evil" ? "Good/Evil" : a}</option>)}
        </select>
      </label>

      {/* Rarity */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Rarity</span>
        <select value={snapshot.rarity ?? ""}
          onChange={(e) => update({ rarity: e.target.value || undefined })}
          className="rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">—</option>
          {/* An imported/legacy value outside the curated list (e.g. "Legacy Rare")
              still needs a slot so we don't silently blank it out. */}
          {snapshot.rarity && !(RARITIES as readonly string[]).includes(snapshot.rarity) && (
            <option value={snapshot.rarity}>{snapshot.rarity}</option>
          )}
          {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      {/* Brigade, split by alignment so the two sets don't read as one 16-wide wrap.
          Each row's Multi tile selects (or clears) that whole set, which is how a
          printed "Multi" card is stored. */}
      <div>
        <span className="mb-1 block text-sm font-medium">Brigade</span>
        <div className="space-y-2">
          {(["Good", "Evil"] as const).map((side) => {
            const multi = MULTI_BRIGADES[side].every((b) => (snapshot.brigades ?? []).includes(b));
            return (
              <div key={side}>
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {side}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Tile
                    src={multiBrigadeIconSrc(side)}
                    label="Multi" title={`${side} Multi`} ariaLabel={`${side} Multi`}
                    selected={multi}
                    onClick={() => update({ brigades: toggleMultiBrigade(snapshot.brigades, side) })} />
                  {MULTI_BRIGADES[side].map((b) => (
                    <Tile key={b}
                      src={brigadeIconSrc(b)}
                      label={brigadeLabel(b)} title={b}
                      selected={(snapshot.brigades ?? []).includes(b)}
                      onClick={() => update({ brigades: toggle<Brigade>(snapshot.brigades, b) })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strength / Toughness */}
      <div>
        <div className="flex gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Strength</span>
            <StatInput value={snapshot.strength} onCommit={(v) => update({ strength: v })}
              className="w-24 rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Toughness</span>
            <StatInput value={snapshot.toughness} onCommit={(v) => update({ toughness: v })}
              className="w-24 rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Dual-alignment or dual-sided? Enter both sides per stat as <span className="font-medium">6/0</span> (stored as 6 (0)). Use <span className="font-medium">X</span> for a variable value.
        </p>
      </div>

      {/* Class */}
      <div>
        <span className="mb-1 block text-sm font-medium">Class</span>
        <div className="flex flex-wrap gap-1.5">
          {CLASSES.map((c) => (
            <Tile key={c}
              src={glyphIconSrc(c)} label={c} title={c}
              selected={(snapshot.class ?? []).includes(c)}
              onClick={() => update({ class: toggle<ClassName>(snapshot.class, c) })} />
          ))}
        </div>
      </div>

      {/* Icons — Territory / Star / Cloud */}
      <div>
        <span className="mb-1 block text-sm font-medium">Icons</span>
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((ic) => (
            <Tile key={ic}
              src={glyphIconSrc(ic)} label={ic} title={ic}
              selected={(snapshot.icons ?? []).includes(ic)}
              onClick={() => update({ icons: toggle<IconName>(snapshot.icons, ic) })} />
          ))}
        </div>
      </div>

      {/* Identifier(s) */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Identifier(s)</span>
        <IdentifiersInput
          value={snapshot.identifiers ?? []}
          onChange={(identifiers) => update({ identifiers })}
          placeholder="Comma-separated, e.g. Genesis, Patriarch"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>

      {/* Reference — scripture citation printed on the card */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Reference</span>
        <input
          value={snapshot.reference ?? ""}
          onChange={(e) => update({ reference: e.target.value || undefined })}
          placeholder="e.g. Revelation 19:15"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        <span className="mt-1 block text-xs text-muted-foreground">The scripture reference printed on the card.</span>
        {reference !== "" &&
          (testament ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">{formatTestament(testament)}</span>
              {isGospel && (
                <span className="rounded border px-1.5 py-0.5 font-medium text-muted-foreground">Gospel</span>
              )}
            </span>
          ) : (
            <span className="mt-1.5 block text-xs text-amber-700 dark:text-amber-300">
              Couldn&rsquo;t determine testament from this reference.
            </span>
          ))}
      </label>

      {/* Scripture — the verse text printed on the card */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Scripture</span>
        <textarea
          value={snapshot.scripture ?? ""}
          onChange={(e) => update({ scripture: e.target.value || undefined })}
          placeholder="The scripture text printed on the card."
          className="h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>
      </div>
    </details>
  );
}
