import React, { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import {
  STANDARD_CATEGORIES,
  otherCategories,
} from "../../utils/tournament/categoryDefaults";
import { buildTournamentName, isNameFrozen } from "../../utils/tournament/naming";
import { TOURNAMENT_TIERS } from "../../utils/tournament/tiers";
import { US_STATES, normalizeState } from "../../utils/tournament/usStates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "./dialog";

interface TournamentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Create one tournament per item. With 0/1 category selected this is a single
  // item carrying the (editable) name; with 2+ it's one auto-named item per type.
  onSubmit: (
    items: {
      name: string;
      category: string | null;
      tier: string | null;
      city: string | null;
      state: string | null;
    }[]
  ) => void;
  // Location the source listing advertised, pre-filled when hosting from one.
  listingCity?: string;
  listingState?: string | null;
  // Categories to offer first. Defaults to the standard list when omitted (e.g.
  // an official listing passes its own formats here); the standard categories
  // it doesn't cover stay one click away under "Add other categories".
  categoryOptions?: string[];
  // Tier the source listing advertised, pre-selected when hosting from one.
  defaultTier?: string | null;
}

// Drop a trailing "- 2P" / "2P" player-count suffix; it reads as clutter.
const cleanCategory = (label: string) => label.replace(/\s*-?\s*2P$/i, "").trim();

const TournamentFormModal: React.FC<TournamentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  listingCity,
  listingState,
  categoryOptions,
  defaultTier,
}) => {
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // The set of checked categories. Each checked type becomes its own tournament.
  const [selected, setSelected] = useState<string[]>([]);
  // Sanctioning tier and location, shared by every tournament this modal
  // creates — one event is one tier in one place even when it runs several
  // categories. "" means unspecified.
  const [tier, setTier] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [state, setState] = useState<string>("");
  // Once the host edits the name, we stop auto-building it from the category.
  const [nameTouched, setNameTouched] = useState(false);
  // The standard categories beyond a listing's own formats start tucked away.
  const [showOthers, setShowOthers] = useState(false);

  const hasListingOptions = !!categoryOptions && categoryOptions.length > 0;
  const options = Array.from(
    new Set(
      (hasListingOptions ? categoryOptions : [...STANDARD_CATEGORIES]).map(
        cleanCategory
      )
    )
  );
  // Only a listing narrows the list; with the standard list there is nothing
  // more to add.
  const extraOptions = hasListingOptions ? otherCategories(options) : [];

  useEffect(() => {
    if (!isOpen) return;
    // Pre-check the first type so the modal opens ready to add one tournament,
    // matching the previous single-select default. The host can check more.
    const initial = options[0] ? [options[0]] : [];
    const initialTier = defaultTier ?? "";
    const initialCity = listingCity ?? "";
    const initialState = normalizeState(listingState) ?? "";
    setSelected(initial);
    setTier(initialTier);
    setCity(initialCity);
    setState(initialState);
    setNameTouched(false);
    setShowOthers(false);
    setName(
      buildTournamentName(cleanCategory(initial[0] ?? ""), {
        tier: initialTier || null,
        city: initialCity || null,
        state: initialState || null,
      })
    );
    requestAnimationFrame(() => {
      firstCheckboxRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultTier, listingCity, listingState]);

  // Creating multiple tournaments at once: each gets an auto-built name, so the
  // single editable name field is replaced by a preview list.
  const isMulti = selected.length >= 2;
  // A single official category freezes the name to the generated form; only
  // Unofficial (or no category yet) keeps the field editable.
  const frozen = selected.length === 1 && isNameFrozen(selected[0]);

  // The name every generated (frozen or multi) tournament gets. Also seeds the
  // editable field, so what the host sees while typing is what gets created.
  const generatedName = (
    category: string,
    over?: { tier?: string; city?: string; state?: string }
  ) =>
    buildTournamentName(cleanCategory(category), {
      tier: (over?.tier ?? tier) || null,
      city: (over?.city ?? city) || null,
      state: (over?.state ?? state) || null,
    });

  // Any event-identity edit re-syncs the single name field, unless the host has
  // taken the name over or isn't on exactly one category.
  const resyncName = (
    next: string[],
    over?: { tier?: string; city?: string; state?: string }
  ) => {
    if (nameTouched) return;
    if (next.length === 1) setName(generatedName(next[0], over));
    else if (next.length === 0) setName("");
  };

  const toggleCategory = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((c) => c !== value)
      : [...selected, value];
    setSelected(next);
    resyncName(next);
  };

  const handleTierChange = (value: string) => {
    setTier(value);
    resyncName(selected, { tier: value });
  };

  const handleCityChange = (value: string) => {
    setCity(value);
    resyncName(selected, { city: value });
  };

  const handleStateChange = (value: string) => {
    setState(value);
    resyncName(selected, { state: value });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const shared = {
      tier: tier || null,
      city: city.trim() || null,
      state: state || null,
    };
    if (isMulti) {
      onSubmit(
        selected.map((c) => ({ name: generatedName(c), category: c, ...shared }))
      );
      return;
    }
    if (frozen) {
      onSubmit([
        { name: generatedName(selected[0]), category: selected[0], ...shared },
      ]);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit([{ name: trimmed, category: selected[0] ?? null, ...shared }]);
  };

  const fieldClasses =
    "w-full rounded-lg border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none";

  const canSubmit =
    selected.length >= 1 && (isMulti || frozen || name.trim().length > 0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add Tournament</DialogTitle>
        </DialogHeader>
        {/* The form is the dialog's flex child, so it has to be a shrinkable
            column itself — otherwise it sizes to its content, the body never
            scrolls, and the footer gets clipped by the dialog on short screens. */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <DialogBody className="space-y-3">
            <div>
              <label
                htmlFor="tier"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Tier
              </label>
              <select
                id="tier"
                value={tier}
                onChange={(e) => handleTierChange(e.target.value)}
                className={fieldClasses}
              >
                <option value="">Not specified</option>
                {TOURNAMENT_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Appears in the event name. Applies to every category you check.
              </p>
            </div>
            <div className="grid grid-cols-[1fr_10rem] gap-2">
              <div>
                <label
                  htmlFor="city"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  value={city}
                  maxLength={60}
                  placeholder="Optional"
                  onChange={(e) => handleCityChange(e.target.value)}
                  className={fieldClasses}
                />
              </div>
              <div>
                <label
                  htmlFor="state"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  State
                </label>
                <select
                  id="state"
                  value={state}
                  onChange={(e) => handleStateChange(e.target.value)}
                  className={fieldClasses}
                >
                  <option value="">Not specified</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div
              role="group"
              aria-labelledby="category-group-label"
              aria-describedby="category-group-help"
            >
              <span
                id="category-group-label"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Categories
              </span>
              <div className="rounded-lg border border-border bg-card divide-y divide-border max-h-72 overflow-y-auto">
                {[...options, ...(showOthers ? extraOptions : [])].map((opt, i) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground cursor-pointer hover:bg-muted"
                  >
                    <input
                      ref={i === 0 ? firstCheckboxRef : undefined}
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={() => toggleCategory(opt)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
              </div>
              {extraOptions.length > 0 && !showOthers && (
                <button
                  type="button"
                  onClick={() => setShowOthers(true)}
                  className="mt-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
                >
                  + Add other categories
                </button>
              )}
              <p
                id="category-group-help"
                className="mt-1 text-xs text-muted-foreground"
              >
                Check more than one to create a tournament for each. Categories set
                sensible defaults (souls to win, round length) you can change later.
              </p>
            </div>
            {isMulti ? (
              <div>
                <span className="block text-xs font-medium text-muted-foreground mb-1">
                  Will create {selected.length} tournaments
                </span>
                <ul className="rounded-lg border border-border bg-muted/40 px-3 py-2 space-y-1">
                  {selected.map((c) => (
                    <li
                      key={c}
                      className="text-sm text-foreground truncate"
                      title={generatedName(c)}
                    >
                      {generatedName(c)}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Official event names are standardized.
                </p>
              </div>
            ) : frozen ? (
              <div>
                <span className="block text-xs font-medium text-muted-foreground mb-1">
                  Tournament name
                </span>
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground truncate">
                  {generatedName(selected[0])}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Official events use standardized names.
                </p>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="name"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Tournament name
                </label>
                <input
                  id="name"
                  type="text"
                  placeholder="Tournament name"
                  required
                  maxLength={60}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  className={fieldClasses}
                />
              </div>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="submit" variant="success" disabled={!canSubmit}>
              {isMulti ? `Add ${selected.length} tournaments` : "Add"}
            </Button>
            <Button type="button" variant="cancel" onClick={onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default TournamentFormModal;
