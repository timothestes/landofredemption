'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import ToastNotification from '@/components/ui/toast-notification';
import PhotoGroup from '@/app/collection/scan/components/PhotoGroup';
import PrintingPicker, { type PickerMode } from '@/app/collection/scan/components/PrintingPicker';
import type { PickerHit } from '@/app/collection/scan/lib/pickerSearch';
import { DECK_COPY, deckDoneLine, fill } from '../copy';
import { useCheckWalker } from '../hooks/useCheckWalker';
import { trayRows, type DeckTrayAction, type TrayDeckRow } from '../lib/deckTrayReducer';
import { totals } from '../lib/handoff';
import type { Candidate, DeckPhoto, DeckTrayState, TrayEntry, Zone } from '../types';
import DeckRow, { AMBER_KINDS } from './DeckRow';
import GroupSection from './GroupSection';
import LostSoulPickRow from './LostSoulPickRow';
import LostSoulSheet from './LostSoulSheet';

// suggest.ts pulls the card catalog: it loads with the picker, once.
let suggestModule: Promise<typeof import('../lib/suggest')> | null = null;
const loadSuggest = () => (suggestModule ??= import('../lib/suggest'));

const NO_QUANTITIES = new Map<string, number>();
const noPrice = () => null;

type Picker =
  | { for: 'row'; rowKey: string; mode: PickerMode }
  | { for: 'add'; groupKey: string };

interface Props {
  state: DeckTrayState;
  dispatch: Dispatch<DeckTrayAction>;
  thumbs: Map<string, string>;
  editable: boolean;
  online: boolean;
  canRetry: (photoId: string) => boolean;
  onRetry: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onChooseAnother: () => void;
}

type Section = {
  key: string;
  index: number;
  group: DeckPhoto['groups'][number] | null;
  readCount: number;
  rows: TrayDeckRow[];
};

const keyName = (key: string | null): string | null => {
  if (!key) return null;
  const b = key.lastIndexOf('|');
  const a = b > 0 ? key.lastIndexOf('|', b - 1) : -1;
  return a > 0 ? key.slice(0, a) : null;
};

/** The photos, each with its group sections and rows, then the totals line, the picker and the Undo toast. */
export default function DeckTray({
  state, dispatch, thumbs, editable, online, canRetry, onRetry, onRemovePhoto, onChooseAnother,
}: Props) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickerSeq, setPickerSeq] = useState(0);
  const [suggestions, setSuggestions] = useState<PickerHit[]>([]);
  const [removed, setRemoved] = useState<{ text: string; seq: number } | null>(null);
  const removeSeq = useRef(0);
  const [lostSoulsOpen, setLostSoulsOpen] = useState(false);
  const closeToast = useCallback(() => setRemoved(null), []);

  const rows = useMemo(() => trayRows(state), [state]);
  const entryById = useMemo(() => new Map(state.entries.map(e => [e.entryId, e])), [state.entries]);
  const firstEntry = (row: TrayDeckRow): TrayEntry | undefined => entryById.get(row.readIds[0]);

  // Sections in reading order: each photo's groups, then any group its reads name that the model did not list.
  const { sectionsByPhoto, amberIds, readByPhoto } = useMemo(() => {
    const byGroup = new Map<string, TrayDeckRow[]>();
    for (const r of rows) byGroup.set(r.groupKey, [...(byGroup.get(r.groupKey) ?? []), r]);
    const read = new Map<string, number>();
    const perPhoto = new Map<string, number>();
    for (const e of state.entries) {
      if (e.original === null) continue;
      const k = `${e.photoId}:${e.group}`;
      read.set(k, (read.get(k) ?? 0) + 1);
      perPhoto.set(e.photoId, (perPhoto.get(e.photoId) ?? 0) + 1);
    }
    const sections = new Map<string, Section[]>();
    const amber: string[] = [];
    let index = 0;
    for (const p of state.photos) {
      const ids = p.groups.map(g => g.id);
      for (const e of state.entries) if (e.photoId === p.photoId && !ids.includes(e.group)) ids.push(e.group);
      const list: Section[] = ids.map(id => {
        const key = `${p.photoId}:${id}`;
        const groupRows = byGroup.get(key) ?? [];
        for (const r of groupRows) if (AMBER_KINDS.includes(r.kind)) amber.push(r.rowKey);
        return { key, index: ++index, group: p.groups.find(g => g.id === id) ?? null, readCount: read.get(key) ?? 0, rows: groupRows };
      });
      sections.set(p.photoId, list);
    }
    return { sectionsByPhoto: sections, amberIds: amber, readByPhoto: perPhoto };
  }, [rows, state.entries, state.photos]);

  const walk = useCheckWalker(amberIds);
  const t = useMemo(() => totals(state), [state]);
  const lostSoulsPicked = state.lostSoulPicks.reduce((n, p) => n + p.qty, 0);
  // Picks are deck-wide: they list under the first Lost Soul summary row only.
  const firstLostSoulRow = useMemo(() => {
    for (const p of state.photos) {
      for (const sec of sectionsByPhoto.get(p.photoId) ?? []) {
        const r = sec.rows.find(x => x.kind === 'lost_soul');
        if (r) return r.rowKey;
      }
    }
    return null;
  }, [state.photos, sectionsByPhoto]);

  // Picks whose placeholder row is gone (its photo was removed) still show, so they are never saved unseen.
  const orphanPicks = state.lostSoulPicks.length > 0 && firstLostSoulRow === null;

  const pickedRow = picker?.for === 'row' ? rows.find(r => r.rowKey === picker.rowKey) ?? null : null;
  const pickedEntry = pickedRow ? firstEntry(pickedRow) : undefined;
  // A card with no printings on hand (one the player added) changes printing from a search for its name.
  const pickerMode: PickerMode | null = !picker
    ? null
    : picker.for === 'add'
      ? 'search'
      : picker.mode === 'printing' && (pickedEntry?.candidates.length ?? 0) === 0 ? 'search' : picker.mode;
  const pickerTitle = picker?.for === 'row' && picker.mode === 'printing'
    ? keyName(pickedRow?.key ?? null)
    : picker?.for === 'row' ? pickedEntry?.title ?? keyName(pickedRow?.key ?? null) : '';

  const openPicker = (p: Picker) => {
    setPicker(p);
    setPickerSeq(n => n + 1);
    setSuggestions([]);
  };

  // Suggestions come with the picker: the read title's near misses and search hits.
  useEffect(() => {
    if (!picker || picker.for !== 'row' || picker.mode !== 'search' || !pickedEntry) return;
    const { title, near } = pickedEntry;
    if (!title && !near?.length) return;
    let live = true;
    void loadSuggest().then(m => live && setSuggestions(m.suggestFor(title, near)));
    return () => { live = false; };
    // Once per opening: the entry is looked up again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerSeq]);

  // A search pick carries its card's printings, so a later Change printing lists the right card.
  const onPick = (key: string, _via: 'candidates' | 'search', candidates?: Candidate[]) => {
    if (!picker) return;
    if (picker.for === 'add') {
      dispatch({ type: 'addCard', groupKey: picker.groupKey, key, candidates });
    } else if (pickedRow && (pickedRow.kind === 'unread' || pickedRow.kind === 'not_found') && pickedRow.quantity > 1) {
      // "3 unread" becomes three picks: this pick corrects one read and the rest stay as they were.
      dispatch({ type: 'setCardOne', rowKey: pickedRow.rowKey, key, candidates });
    } else if (pickedRow) {
      dispatch({ type: 'setCard', rowKey: pickedRow.rowKey, key, candidates });
    }
  };

  const removeRow = (row: TrayDeckRow) => {
    const e = firstEntry(row);
    dispatch({ type: 'removeRow', rowKey: row.rowKey });
    const text = row.kind === 'unread'
      ? fill(row.quantity === 1 ? DECK_COPY.removedUnreadOne : DECK_COPY.removedUnread, { n: row.quantity })
      : row.kind === 'not_found'
        ? fill(DECK_COPY.removedNotFound, { title: e?.title ?? '' })
        : fill(DECK_COPY.removed, { name: keyName(row.key) ?? e?.title ?? '' });
    setRemoved({ text, seq: ++removeSeq.current });
  };

  // "Removed {name} · Undo": the message, and the Undo button's label after the last " · ".
  const removedText = removed?.text ?? '';
  const undoAt = removedText.lastIndexOf(' · ');

  const totalsLine = fill(DECK_COPY.totals, { m: t.main, r: t.reserve, ls: t.lostSoulsToPick, u: t.unread })
    .split(' · ')
    // Lost Souls to pick and unread are left out at zero.
    .filter((part, i) => i < 2 || !part.startsWith('0 '))
    .join(' · ');

  return (
    <>
      <div className="divide-y divide-border border-t border-border">
        {state.photos.map(photo => {
          const n = readByPhoto.get(photo.photoId) ?? 0;
          const sections = sectionsByPhoto.get(photo.photoId) ?? [];
          const thumb = thumbs.get(photo.photoId);
          return (
            <PhotoGroup
              key={photo.photoId}
              photo={photo}
              thumb={thumb}
              detectionCount={n}
              mergedCount={0}
              doneLine={deckDoneLine(n, photo.groups.length, photo.photoQuality, photo.longEdge)}
              signInHref="/sign-in?redirectTo=/decklist/scan"
              editable={editable}
              online={online}
              canRetry={canRetry(photo.photoId)}
              onRetry={() => onRetry(photo.photoId)}
              onRemove={() => onRemovePhoto(photo.photoId)}
              onChooseAnother={onChooseAnother}
            >
              {sections.map(sec => {
                const zone: Zone = state.groupZones[sec.key] ?? 'main';
                return (
                  <GroupSection
                    key={sec.key}
                    index={sec.index}
                    photoN={photo.n}
                    group={sec.group}
                    readCount={sec.readCount}
                    zone={zone}
                    thumb={thumb}
                    editable={editable}
                    onZone={z => dispatch({ type: 'setGroupZone', groupKey: sec.key, zone: z })}
                    onAdd={() => openPicker({ for: 'add', groupKey: sec.key })}
                  >
                    {sec.rows.map(row => {
                      const e = firstEntry(row);
                      return (
                        <Fragment key={row.rowKey}>
                        <DeckRow
                          row={row}
                          readTitle={e?.title ?? null}
                          candidates={e?.candidates ?? []}
                          groupZone={zone}
                          lostSoulsPicked={lostSoulsPicked}
                          editable={editable}
                          onOpenPicker={() => openPicker({ for: 'row', rowKey: row.rowKey, mode: row.kind === 'which' ? 'candidates' : 'search' })}
                          onChangePrinting={() => openPicker({ for: 'row', rowKey: row.rowKey, mode: 'printing' })}
                          onQty={qty => dispatch({ type: 'setQty', rowKey: row.rowKey, qty })}
                          onMove={z => dispatch({ type: 'moveRow', rowKey: row.rowKey, zone: z })}
                          onRemove={() => removeRow(row)}
                          onOpenLostSouls={() => setLostSoulsOpen(true)}
                        />
                        {row.rowKey === firstLostSoulRow && state.lostSoulPicks.map(p => (
                          <LostSoulPickRow
                            key={p.key}
                            pick={p}
                            editable={editable}
                            onQty={qty => dispatch({
                              type: 'setLostSoulPicks',
                              picks: state.lostSoulPicks.map(x => (x.key === p.key ? { ...x, qty } : x)).filter(x => x.qty > 0),
                            })}
                          />
                        ))}
                        </Fragment>
                      );
                    })}
                  </GroupSection>
                );
              })}
            </PhotoGroup>
          );
        })}
      </div>

      {orphanPicks && (
        <div className="mt-3 rounded-lg border border-border">
          {state.lostSoulPicks.map(p => (
            <LostSoulPickRow
              key={p.key}
              pick={p}
              editable={editable}
              onQty={qty => dispatch({
                type: 'setLostSoulPicks',
                picks: state.lostSoulPicks.map(x => (x.key === p.key ? { ...x, qty } : x)).filter(x => x.qty > 0),
              })}
            />
          ))}
          {editable && (
            <button
              type="button"
              onClick={() => setLostSoulsOpen(true)}
              className="min-h-11 w-full px-3 text-left text-sm font-medium underline-offset-4 hover:underline focus:outline-none"
            >
              {DECK_COPY.pickWhich}
            </button>
          )}
        </div>
      )}

      {(rows.length > 0 || orphanPicks) && (
        <p aria-live="polite" className="mt-3 flex flex-wrap items-center gap-x-2 text-sm tabular-nums text-muted-foreground">
          <span>{totalsLine}</span>
          {t.toCheck > 0 && (
            <button
              type="button"
              onClick={walk}
              className="min-h-11 font-medium text-amber-600 underline-offset-4 hover:underline focus:outline-none dark:text-amber-400"
            >
              {fill(DECK_COPY.toCheck, { n: t.toCheck })}
            </button>
          )}
        </p>
      )}

      {picker && pickerMode && editable && (picker.for === 'add' || pickedRow) && (
        <PrintingPicker
          key={pickerSeq}
          subject={{
            readTitle: pickerTitle ?? '',
            candidates: pickedEntry?.candidates ?? [],
            currentKey: pickedRow?.key ?? null,
          }}
          mode={pickerMode}
          suggestions={suggestions}
          selectQueryOnOpen
          title={picker.for === 'add' ? DECK_COPY.addCard : undefined}
          quantities={NO_QUANTITIES}
          showPrices={false}
          getPrice={noPrice}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      )}

      {lostSoulsOpen && editable && (
        <LostSoulSheet
          trayRows={rows.filter(r => r.kind === 'matched' && r.key).map(r => ({ key: r.key as string, qty: r.quantity }))}
          placeholders={rows.reduce((n, r) => n + (r.kind === 'lost_soul' ? r.quantity : 0), 0)}
          picks={state.lostSoulPicks}
          onDone={picks => dispatch({ type: 'setLostSoulPicks', picks })}
          onSkip={() => dispatch({ type: 'skipLostSouls' })}
          onClose={() => setLostSoulsOpen(false)}
        />
      )}

      <ToastNotification
        key={removed?.seq ?? 0}
        message={undoAt > 0 ? removedText.slice(0, undoAt) : removedText}
        show={removed !== null}
        onClose={closeToast}
        type="info"
        duration={5000}
        action={undoAt > 0 ? { label: removedText.slice(undoAt + 3), onClick: () => dispatch({ type: 'undoRemove' }) } : undefined}
      />
    </>
  );
}
