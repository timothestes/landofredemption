"use client";

// Loads the card catalog (lookup, cardIdentity, pickerSearch): hosts bring this in with dynamic(), never statically.
import { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import AddCardRow from "@/app/decklist/scan/components/AddCardRow";
import DeckRow from "@/app/decklist/scan/components/DeckRow";
import LostSoulSheet from "@/app/decklist/scan/components/LostSoulSheet";
import { DECK_COPY } from "@/app/decklist/scan/copy";
import type { TrayDeckRow } from "@/app/decklist/scan/lib/deckTrayReducer";
import PrintingPicker from "@/app/collection/scan/components/PrintingPicker";
import { printingsForIdentity } from "@/app/collection/scan/lib/pickerSearch";
import type { Candidate } from "@/app/collection/scan/types";
import { cardIdentityKey, cardNameStem } from "@/lib/cards/cardIdentity";
import { findCard, type CardData } from "@/lib/cards/lookup";
import type { DeckSnapshotCard } from "@/lib/tournament/deckSubmission";
import { typeLabel } from "@/lib/tournament/submissionView";
import {
  addCard, cardKeyOf, moveRow, parseCardKey, removeRow, replaceCard, rowIdOf, setQuantity, type SnapshotZone,
} from "@/lib/tournament/snapshotEdit";

const NO_QUANTITIES = new Map<string, number>();
const noPrice = () => null;
const NO_LOST_SOULS = { picked: 0, counted: 0, finished: true };

type Picker =
  | { for: "card"; rowId: string }
  | { for: "printing"; rowId: string }
  | { for: "add"; zone: SnapshotZone };

interface Props {
  cards: DeckSnapshotCard[];
  onChange: (cards: DeckSnapshotCard[]) => void;
  /** False while a save is in flight. */
  editable: boolean;
}

const ZONES: { zone: SnapshotZone; title: string }[] = [
  { zone: "main", title: DECK_COPY.zoneMain },
  { zone: "reserve", title: DECK_COPY.zoneReserve },
];

const lookup = (c: DeckSnapshotCard): CardData | undefined => findCard(c.name, c.set, c.imgFile ?? undefined);

// Lost Souls and Dominants never go to the Reserve.
const isMainOnly = (type: string) => /lost soul|dominant/i.test(type);

const toCandidate = (c: CardData): Candidate => ({
  key: `${c.name}|${c.set}|${c.imgFile}`,
  name: c.name,
  set: c.set,
  officialSet: c.officialSet,
  imgFile: c.imgFile,
  legality: c.legality,
  price: null,
});

/**
 * A submitted card list, editable: the photo reader's rows and pickers over a plain list of cards. A row's name
 * changes its card, minus and plus its copies, and ⋯ its printing and zone. Cards are grouped by type inside
 * each zone, as the read-only view groups them.
 */
export default function DecklistEditor({ cards, onChange, editable }: Props) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerSeq, setPickerSeq] = useState(0);
  const [lostSoulsOpen, setLostSoulsOpen] = useState(false);

  const openPicker = (p: Picker) => {
    setPicker(p);
    setPickerSeq((n) => n + 1);
  };

  const sections = useMemo(
    () =>
      ZONES.map(({ zone, title }) => {
        const groups = new Map<string, { card: DeckSnapshotCard; found: CardData | undefined }[]>();
        let total = 0;
        for (const card of cards) {
          if (card.zone !== zone) continue;
          total += card.quantity;
          const found = lookup(card);
          const type = typeLabel(found?.type) || "Other";
          groups.set(type, [...(groups.get(type) ?? []), { card, found }]);
        }
        const sorted = [...groups.entries()]
          .sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))
          .map(([type, rows]) => ({ type, rows: [...rows].sort((a, b) => a.card.name.localeCompare(b.card.name)) }));
        return { zone, title, total, groups: sorted };
      }),
    [cards],
  );

  const picked = picker && picker.for !== "add" ? cards.find((c) => rowIdOf(c) === picker.rowId) ?? null : null;
  const pickedFound = picked ? lookup(picked) : undefined;
  // Change printing lists the card's printings; Change card opens a search on its name with them underneath.
  const pickedPrintings = pickedFound ? printingsForIdentity(cardIdentityKey(pickedFound)) : [];

  const onPick = (key: string) => {
    if (!picker) return;
    if (picker.for === "add") onChange(addCard(cards, key, isMainOnly(typeOfKey(key)) ? "main" : picker.zone));
    else onChange(replaceCard(cards, picker.rowId, key));
  };

  return (
    <div className="space-y-5">
      {sections.map((sec) => (
        <section key={sec.zone} aria-label={sec.title}>
          <h4 className="text-sm font-semibold text-foreground">
            {sec.title} <span className="font-normal tabular-nums text-muted-foreground">({sec.total})</span>
          </h4>
          {sec.groups.map((g) => (
            <div key={g.type} className="mt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.type}</p>
              <ul className="divide-y divide-border/60">
                {g.rows.map(({ card, found }) => {
                  const rowId = rowIdOf(card);
                  const mainOnly = isMainOnly(found?.type ?? "");
                  const row: TrayDeckRow = {
                    rowKey: rowId, kind: "matched", key: cardKeyOf(card), title: null, quantity: card.quantity,
                    shares: {}, readIds: [], mainOnly, groupKey: sec.zone, zone: card.zone,
                  };
                  return (
                    <DeckRow
                      key={rowId}
                      row={row}
                      readTitle={null}
                      candidates={found ? [toCandidate(found)] : []}
                      groupZone={sec.zone}
                      lostSouls={NO_LOST_SOULS}
                      editable={editable}
                      onOpenPicker={() => openPicker({ for: "card", rowId })}
                      onChangePrinting={() => openPicker({ for: "printing", rowId })}
                      onQty={(qty) => onChange(setQuantity(cards, rowId, qty))}
                      onMove={(zone) => onChange(moveRow(cards, rowId, zone))}
                      onRemove={() => onChange(removeRow(cards, rowId))}
                      onOpenLostSouls={() => setLostSoulsOpen(true)}
                    />
                  );
                })}
              </ul>
            </div>
          ))}
          <ul className="mt-1">
            <AddCardRow disabled={!editable} onAdd={() => openPicker({ for: "add", zone: sec.zone })} />
            {sec.zone === "main" && (
              // Lost Souls are found by picture and verse, not by name: they get their own list.
              <li>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setLostSoulsOpen(true)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md pl-2 text-left text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex w-11 justify-center">
                    <Layers className="h-4 w-4" aria-hidden />
                  </span>
                  Add Lost Souls…
                </button>
              </li>
            )}
          </ul>
        </section>
      ))}

      {picker && editable && (picker.for === "add" || picked) && (
        <PrintingPicker
          key={pickerSeq}
          subject={{
            readTitle: picked ? cardNameStem(picked.name, pickedFound?.type) : "",
            candidates: pickedPrintings,
            currentKey: picked ? cardKeyOf(picked) : null,
          }}
          // A card the catalog does not know has no printings to list: its printing is changed by finding it.
          mode={picker.for === "printing" && pickedPrintings.length > 0 ? "printing" : "search"}
          selectQueryOnOpen
          title={picker.for === "add" ? DECK_COPY.addCard : undefined}
          oneRowPerCard={picker.for !== "printing"}
          quantities={NO_QUANTITIES}
          showPrices={false}
          getPrice={noPrice}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}

      {lostSoulsOpen && editable && (
        <LostSoulSheet
          inTray={cards.map(cardKeyOf)}
          placeholders={0}
          picks={[]}
          listedLabel="Already in this list"
          onCommit={(picks) => {
            if (picks.length === 0) return;
            onChange(picks.reduce((next, p) => addCard(next, p.key, "main", p.qty), cards));
          }}
          onClose={() => setLostSoulsOpen(false)}
        />
      )}
    </div>
  );
}

/** The type of the card a picker key names, for keeping a Lost Soul or Dominant out of the Reserve. */
function typeOfKey(key: string): string {
  const card = parseCardKey(key);
  return card ? findCard(card.name, card.set, card.imgFile ?? undefined)?.type ?? "" : "";
}
