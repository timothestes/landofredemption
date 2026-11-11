"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { loadUserDecksAction, loadPublicDeckAction } from "@/app/decklist/actions";
import { searchDecksForTournamentAction, type DeckSearchResult } from "@/app/tracker/tournaments/actions";
import { STORAGE_KEY } from "@/app/decklist/scan/lib/deckTrayReducer";
import { FORMATS, normalizeFormat, type FormatId } from "@/lib/formats";
import PhotoDeckSource from "./PhotoDeckSource";

interface MyDeck {
  id: string;
  name: string;
  format: string | null;
}

type Tab = "mine" | "community" | "link" | "photo";

const TAB_LABELS: Record<Tab, string> = { mine: "My decks", community: "Community", link: "Link", photo: "Photo" };

interface DeckPickerProps {
  tournamentFormat: FormatId | "Other" | null;
  userId: string;
  code: string;
  eventName: string;
  /** The photo tab's button label: there it is the page's submit, not a pick. */
  photoSubmitLabel: string;
  /** Why the photo tab's button cannot be pressed yet, for a reason outside the picker. */
  photoBlocked?: string | null;
  /** A deck read from a photo and saved. Defaults to onSelect. */
  onPhotoDeck?: (deckId: string, deckName: string) => void;
  /** Told when the photo tab is showing, so a host with its own submit can step aside for the tab's. */
  onPhotoTab?: (showing: boolean) => void;
  onSelect: (deckId: string, deckName: string) => void;
}

// Compatibility is a sorting hint, not a gate — checkDeck (server-side, on
// submit) is the real legality check. A Limited deck is compatible with an
// Unlimited event (pool subset); an ungated tournament (null/'Other') treats
// everything as compatible.
function isCompatible(deckFormat: string | null | undefined, tf: FormatId | "Other" | null): boolean {
  if (tf === null || tf === "Other") return true;
  const df = normalizeFormat(deckFormat);
  return df === tf || (tf === "Unlimited" && df === "Limited");
}

function badgeClasses(format?: string | null) {
  const id = normalizeFormat(format);
  const base = "min-w-[2.5rem] flex-shrink-0 text-center inline-block px-1.5 py-0.5 rounded text-xs font-medium";
  if (id === "T2") return `${base} bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200`;
  if (id === "Paragon") return `${base} bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200`;
  if (id === "Limited") return `${base} bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200`;
  return `${base} bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200`;
}

function DeckRow({
  name,
  format,
  subtitle,
  onClick,
}: {
  name: string;
  format: string | null | undefined;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
    >
      <span className={badgeClasses(format)}>{FORMATS[normalizeFormat(format)].badge}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
      {subtitle && <span className="flex-shrink-0 text-xs text-muted-foreground">{subtitle}</span>}
    </button>
  );
}

/** One fixed height for the three list tabs: results arriving, or a switch between them, must not resize the card. */
const LIST_PANE = "flex h-80 flex-col";

export default function DeckPicker({
  tournamentFormat, userId, code, eventName, photoSubmitLabel, photoBlocked, onPhotoDeck, onPhotoTab, onSelect,
}: DeckPickerProps) {
  const [tab, setTab] = useState<Tab>("mine");
  const photoTab = useRef(onPhotoTab);
  photoTab.current = onPhotoTab;
  useEffect(() => {
    photoTab.current?.(tab === "photo");
    return () => photoTab.current?.(false);
  }, [tab]);
  // Once the player picks a tab themselves, the picker stops choosing one for them.
  const touched = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The body's height just before a tab change, so the change can glide instead of snapping.
  const heightBefore = useRef<number | null>(null);
  const switchTab = (t: Tab) => {
    heightBefore.current = bodyRef.current?.offsetHeight ?? null;
    setTab(t);
    if (t === "photo") setPhotoOpened(true);
  };
  const openPhoto = () => switchTab("photo");

  // The three list tabs share one height, so only the photo tab changes the picker's size. That change is
  // animated: the join card is centred on the page, so a snap moves everything above the picker too.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const inner = el?.firstElementChild as HTMLElement | null;
    const from = heightBefore.current;
    heightBefore.current = null;
    if (!el || !inner || from === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Held at the old height for two frames: the photo reader mounts a frame after its tab first opens, and
    // gliding toward the empty tab in the meantime would dip before it grows.
    el.style.height = `${from}px`;
    el.style.overflow = "clip";
    const follow = () => {
      el.style.height = `${inner.offsetHeight}px`;
    };
    const observer = new ResizeObserver(follow);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        el.style.transition = "height 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        follow();
        observer.observe(inner); // content still settling keeps moving the target
      });
    });
    // Released when done: a fixed height would clip the tray as photos are read, and its sticky bar and menus.
    const release = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.style.height = "";
      el.style.overflow = "";
      el.style.transition = "";
    };
    const timer = window.setTimeout(release, 320);
    return () => {
      window.clearTimeout(timer);
      release();
    };
  }, [tab]);
  // The photo reader mounts on the tab's first visit, then stays mounted so a read in flight survives a tab switch.
  const [photoOpened, setPhotoOpened] = useState(false);

  // A photo tray left from before a reload (or started on the scan page) opens straight away: the player's
  // work must not look lost behind an empty My decks tab.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(userId));
      const photos = raw ? JSON.parse(raw)?.photos : null;
      if (Array.isArray(photos) && photos.length > 0 && !touched.current) openPhoto();
    } catch {
      // Storage unavailable or unreadable: stay on My decks.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // My decks
  const [myDecks, setMyDecks] = useState<MyDeck[] | null>(null);
  const [myLoading, setMyLoading] = useState(false);
  const [myQuery, setMyQuery] = useState("");

  useEffect(() => {
    if (myDecks !== null) return;
    setMyLoading(true);
    loadUserDecksAction()
      .then((res) => {
        const decks = res.success === true ? (res.decks as MyDeck[]) : [];
        setMyDecks(decks);
        // No saved decks: the photo is the way in, not an empty list.
        if (res.success === true && decks.length === 0 && !touched.current) openPhoto();
      })
      .catch(() => {
        // Network drop: fall back to the same empty state the non-throw
        // failure path already uses, rather than leaving myLoading stuck.
        setMyDecks([]);
      })
      .finally(() => {
        setMyLoading(false);
      });
    // Load once regardless of which tab is active first — cheap and avoids a
    // spinner if the player switches to "My decks" after browsing others.
  }, [myDecks]);

  const filteredMine = (myDecks ?? []).filter((d) =>
    d.name.toLowerCase().includes(myQuery.trim().toLowerCase())
  );
  const compatibleMine = filteredMine.filter((d) => isCompatible(d.format, tournamentFormat));
  const incompatibleMine = filteredMine.filter((d) => !isCompatible(d.format, tournamentFormat));
  const otherFormatLabel =
    tournamentFormat && tournamentFormat !== "Other" ? FORMATS[tournamentFormat].label : "this event's format";

  // Community
  const [communityQuery, setCommunityQuery] = useState("");
  const [communityResults, setCommunityResults] = useState<DeckSearchResult[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);

  useEffect(() => {
    const term = communityQuery.trim();
    if (!term) {
      setCommunityResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setCommunityLoading(true);
      try {
        const res = await searchDecksForTournamentAction(term);
        if (res.success === true) setCommunityResults(res.decks);
      } catch {
        // Network drop: don't leave communityLoading stuck true forever.
        setCommunityResults([]);
      } finally {
        setCommunityLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [communityQuery]);

  // Paste a link
  const [linkInput, setLinkInput] = useState("");
  const [linkPreview, setLinkPreview] = useState<{ id: string; name: string; format: string | null } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  async function handleLinkLookup() {
    setLinkError(null);
    setLinkPreview(null);
    const match = linkInput.match(/([0-9a-f-]{36})/i);
    if (!match) {
      setLinkError("Paste a deck link or ID.");
      return;
    }
    setLinkLoading(true);
    try {
      const res = await loadPublicDeckAction(match[1]);
      if (res.success === true && res.deck) {
        setLinkPreview({ id: res.deck.id, name: res.deck.name, format: res.deck.format ?? null });
      } else {
        setLinkError(res.error ?? "Couldn't load that deck.");
      }
    } catch {
      // Network drop: don't leave linkLoading stuck true forever.
      setLinkError("Something went wrong — try again.");
    } finally {
      setLinkLoading(false);
    }
  }

  return (
    // On a phone the photo tray needs the width: the box runs to the edges of the join card (its p-6).
    <div
      className={`mt-2 border border-border ${
        tab === "photo" ? "-mx-6 border-x-0 sm:mx-0 sm:rounded-lg sm:border-x" : "rounded-lg"
      }`}
    >
      <div className="flex border-b border-border text-sm">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              touched.current = true;
              switchTab(t);
            }}
            className={`flex-auto px-1 py-2 font-medium sm:px-2 transition-colors ${
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div ref={bodyRef}>
      <div className="p-3">
        {tab === "mine" && (
          <div className={LIST_PANE}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={myQuery}
                onChange={(e) => setMyQuery(e.target.value)}
                placeholder="Search your decks..."
                className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground"
              />
            </div>
            {myLoading && <p className="mt-3 text-sm text-muted-foreground">Loading your decks…</p>}
            {!myLoading && myDecks !== null && filteredMine.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                {myDecks.length === 0 ? "No saved decks yet." : "No decks found."}{" "}
                <button
                  type="button"
                  onClick={openPhoto}
                  className="font-medium text-foreground underline underline-offset-4 focus:outline-none"
                >
                  Photograph your deck instead
                </button>
              </p>
            )}
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {compatibleMine.map((d) => (
                <DeckRow key={d.id} name={d.name} format={d.format} onClick={() => onSelect(d.id, d.name)} />
              ))}
              {incompatibleMine.length > 0 && (
                <>
                  <div className="my-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    Different format
                  </div>
                  {incompatibleMine.map((d) => (
                    <div key={d.id}>
                      <DeckRow name={d.name} format={d.format} onClick={() => onSelect(d.id, d.name)} />
                      <p className="pl-3 pb-1 text-xs text-amber-600 dark:text-amber-400">
                        Different format — will be validated as {otherFormatLabel}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {tab === "community" && (
          <div className={LIST_PANE}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={communityQuery}
                onChange={(e) => setCommunityQuery(e.target.value)}
                placeholder="Search public decks..."
                className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground"
              />
            </div>
            {communityLoading && <p className="mt-3 text-sm text-muted-foreground">Searching…</p>}
            {!communityLoading && communityQuery.trim() && communityResults.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">No decks found.</p>
            )}
            {!communityQuery.trim() && (
              <p className="mt-3 text-sm text-muted-foreground">Search public decks by name.</p>
            )}
            {/* Keyed on the result set, so each new set fades in rather than swapping under the eye. */}
            <div
              key={communityResults.map((d) => d.id).join()}
              className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto duration-200 animate-in fade-in"
            >
              {communityResults.map((d) => (
                <DeckRow
                  key={d.id}
                  name={d.name}
                  format={d.format}
                  subtitle={d.username && d.username !== "You" ? `by ${d.username}` : undefined}
                  onClick={() => onSelect(d.id, d.name)}
                />
              ))}
            </div>
          </div>
        )}

        {tab === "link" && (
          <div className={LIST_PANE}>
            <div className="flex gap-2">
              <input
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  setLinkPreview(null);
                  setLinkError(null);
                }}
                placeholder="Paste a deck link or ID"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <button
                type="button"
                onClick={handleLinkLookup}
                disabled={linkLoading || !linkInput.trim()}
                className="flex-shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {linkLoading ? "Looking up…" : "Find"}
              </button>
            </div>
            {linkError && <p className="mt-2 text-sm text-destructive">{linkError}</p>}
            {linkPreview && (
              <div className="mt-3">
                <DeckRow
                  name={linkPreview.name}
                  format={linkPreview.format}
                  onClick={() => onSelect(linkPreview.id, linkPreview.name)}
                />
              </div>
            )}
          </div>
        )}

        {photoOpened && (
          <div hidden={tab !== "photo"}>
            <PhotoDeckSource
              userId={userId}
              code={code}
              eventName={eventName}
              eventFormat={tournamentFormat === "Other" ? null : tournamentFormat}
              active={tab === "photo"}
              submitLabel={photoSubmitLabel}
              blocked={photoBlocked}
              onSelect={onPhotoDeck ?? onSelect}
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
