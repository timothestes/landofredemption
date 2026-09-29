"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  HiCalendar,
  HiViewList,
  HiChevronLeft,
  HiChevronRight,
  HiClipboardCopy,
  HiCheck,
} from "react-icons/hi";
import { TournamentListing } from "./actions";

// ─── Date helpers ────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(start: string, end: string | null): string {
  if (!end || end === start) return formatDate(start);
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  if (s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}–${e.getDate()}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function getMonthKey(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T12:00:00");
  return Math.ceil(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function toDateKey(dateStr: string): string {
  return dateStr; // already YYYY-MM-DD
}

// Seasonal (and the retired Local/District levels it replaced in the 2026
// Host Guide) share the muted fallback with unknown types.
function getTypeBadgeClasses(type: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("regional") || t.includes("national")) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  }
  if (t.includes("state")) {
    return "bg-primary/10 text-primary";
  }
  return "bg-muted text-muted-foreground";
}

function getTypeDotColor(type: string | null): string {
  const t = (type || "").toLowerCase();
  if (t.includes("regional") || t.includes("national")) {
    return "bg-amber-500";
  }
  if (t.includes("state")) {
    return "bg-primary";
  }
  return "bg-muted-foreground/50";
}

// ─── House styles ────────────────────────────────────────────

const KICKER =
  "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

const CHIP =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-3 text-sm transition-colors";
const CHIP_IDLE =
  "border-border bg-foreground/[0.03] text-muted-foreground hover:border-foreground/40 hover:text-foreground";
const CHIP_ACTIVE = "border-foreground bg-foreground text-background";

function TypeBadge({
  type,
  className = "",
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      className={`items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getTypeBadgeClasses(type)} ${className}`}
    >
      {type}
    </span>
  );
}

// ─── Grouping helpers ────────────────────────────────────────

interface ListingsByMonth {
  month: string;
  listings: TournamentListing[];
}

function groupByMonth(listings: TournamentListing[]): ListingsByMonth[] {
  const groups: Map<string, TournamentListing[]> = new Map();
  for (const l of listings) {
    const key = getMonthKey(l.start_date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  return Array.from(groups.entries()).map(([month, listings]) => ({
    month,
    listings,
  }));
}

function groupByDate(
  listings: TournamentListing[]
): Map<string, TournamentListing[]> {
  const map = new Map<string, TournamentListing[]>();
  for (const l of listings) {
    const key = toDateKey(l.start_date);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return map;
}

function getUniqueStates(listings: TournamentListing[]): string[] {
  const states = new Set(listings.map((l) => l.state));
  return Array.from(states).sort();
}

// ─── Calendar grid helpers ───────────────────────────────────

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay(); // 0=Sun
  const totalDays = lastDay.getDate();

  const days: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= totalDays; d++) days.push(d);
  // Pad to complete the last row
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function dateToKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Listing Row (shared between views) ──────────────────────

function ListingRow({
  listing,
  isExpanded,
  onToggle,
}: {
  listing: TournamentListing;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const daysUntil = getDaysUntil(listing.start_date);
  const isImminent = daysUntil >= 0 && daysUntil <= 3;
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = [listing.venue_name, listing.venue_address]
      .filter(Boolean)
      .join(", ");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; silently ignore.
    }
  };

  return (
    <div>
      {/* Phones: date + chevron on line one, place + type under it.
          sm and up: date | place + type | tier | chevron on one line. */}
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-left transition-colors hover:bg-muted/40 sm:flex-nowrap sm:gap-x-4"
      >
        <div className="order-1 flex flex-1 items-baseline gap-2 sm:block sm:w-28 sm:flex-none">
          <span className="text-sm font-medium tabular-nums text-foreground">
            {formatDateRange(listing.start_date, listing.end_date)}
          </span>
          {isImminent && daysUntil >= 0 && (
            <span className="text-xs font-medium text-primary sm:block">
              {daysUntil === 0
                ? "Today"
                : daysUntil === 1
                  ? "Tomorrow"
                  : `In ${daysUntil} days`}
            </span>
          )}
        </div>

        <div className="order-3 w-full min-w-0 sm:order-2 sm:w-auto sm:flex-1">
          <div className="truncate font-medium text-foreground">
            {listing.city}, {listing.state}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {listing.formats.length > 0 && (
              <span className="truncate">
                {listing.formats
                  .map((f) => f.format.split(" - ")[0])
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")}
              </span>
            )}
            {listing.tournament_type && (
              <TypeBadge
                type={listing.tournament_type}
                className="inline-flex shrink-0 sm:hidden"
              />
            )}
          </div>
        </div>

        {listing.tournament_type && (
          <TypeBadge
            type={listing.tournament_type}
            className="order-3 hidden shrink-0 sm:inline-flex"
          />
        )}

        <span
          aria-hidden="true"
          className="order-2 -my-2.5 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground/60 sm:order-4"
        >
          <svg
            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </button>

      {isExpanded && (
        <div className="pb-5 pt-1 sm:pl-32">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {(listing.venue_name || listing.venue_address) && (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className={KICKER}>Venue</div>
                  {listing.venue_name && (
                    <div className="mt-0.5 font-medium text-foreground">
                      {listing.venue_name}
                    </div>
                  )}
                  {listing.venue_address && (
                    <div className="text-muted-foreground">
                      {listing.venue_address}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCopyAddress}
                  title={copied ? "Copied!" : "Copy address"}
                  aria-label={copied ? "Address copied" : "Copy address"}
                  className="-my-1.5 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {copied ? (
                    <HiCheck className="h-4 w-4 text-primary" />
                  ) : (
                    <HiClipboardCopy className="h-4 w-4" />
                  )}
                </button>
              </div>
            )}

            {listing.start_time && (
              <div>
                <div className={KICKER}>Time</div>
                <div className="mt-0.5 text-foreground">
                  {listing.start_time}
                </div>
              </div>
            )}

            {listing.host_name && (
              <div>
                <div className={KICKER}>Host</div>
                <div className="mt-0.5 text-foreground">
                  {listing.host_name}
                </div>
              </div>
            )}

            {listing.door_fee && (
              <div>
                <div className={KICKER}>Door fee</div>
                <div className="mt-0.5 text-foreground">{listing.door_fee}</div>
              </div>
            )}
          </div>

          {listing.formats.length > 0 && (
            <div className="mt-4">
              <h4 className={`${KICKER} border-b border-border/60 pb-1`}>
                Formats
              </h4>
              <div className="divide-y divide-border/60">
                {listing.formats.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 py-1.5 text-sm"
                  >
                    <span className="text-foreground">{f.format}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {f.entry_fee || "Free"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {listing.description && (
            <p className="mt-4 text-sm text-muted-foreground">
              {listing.description}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/tracker/tournaments?from_listing=${listing.id}&city=${encodeURIComponent(listing.city)}&state=${encodeURIComponent(listing.state)}${listing.formats.length > 0 ? `&formats=${encodeURIComponent(listing.formats.map((f) => f.format).join("|"))}` : ""}${listing.tournament_type ? `&type=${encodeURIComponent(listing.tournament_type)}` : ""}`}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Host This Event
            </Link>
            {listing.linked_tournament_id && (
              <span className="text-sm text-muted-foreground">
                Already linked to a tournament
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Calendar View ───────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarView({
  listings,
  expandedId,
  setExpandedId,
}: {
  listings: TournamentListing[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}) {
  const byDate = useMemo(() => groupByDate(listings), [listings]);

  // Determine initial month from first listing or today
  const initialDate = listings.length > 0
    ? new Date(listings[0].start_date + "T12:00:00")
    : new Date();

  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const days = getCalendarDays(viewYear, viewMonth);
  const today = new Date();
  const todayKey =
    today.getFullYear() === viewYear && today.getMonth() === viewMonth
      ? today.getDate()
      : null;

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Determine which months have events for nav bounds
  const lastListing = listings[listings.length - 1];
  const lastDate = lastListing
    ? new Date(lastListing.start_date + "T12:00:00")
    : today;

  const canGoNext =
    viewYear < lastDate.getFullYear() ||
    (viewYear === lastDate.getFullYear() && viewMonth < lastDate.getMonth());

  const firstListing = listings[0];
  const firstDate = firstListing
    ? new Date(firstListing.start_date + "T12:00:00")
    : today;

  const canGoPrev =
    viewYear > firstDate.getFullYear() ||
    (viewYear === firstDate.getFullYear() && viewMonth > firstDate.getMonth());

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
    setSelectedDate(null);
  };

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
    setSelectedDate(null);
  };

  const selectedListings = selectedDate ? byDate.get(selectedDate) || [] : [];

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={!canGoPrev}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <HiChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-sm font-semibold text-foreground">{monthLabel}</h2>
        <button
          onClick={goNext}
          disabled={!canGoNext}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <HiChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className={`${KICKER} py-1 text-center`}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 border-l border-t border-border/60">
        {days.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="border-b border-r border-border/60 bg-muted/20"
              />
            );
          }

          const key = dateToKey(viewYear, viewMonth, day);
          const events = byDate.get(key);
          const hasEvents = !!events && events.length > 0;
          const isToday = day === todayKey;
          const isSelected = selectedDate === key;
          const isPast =
            new Date(viewYear, viewMonth, day) <
            new Date(today.getFullYear(), today.getMonth(), today.getDate());

          return (
            <button
              key={key}
              onClick={() => {
                if (hasEvents) {
                  setSelectedDate(isSelected ? null : key);
                  setExpandedId(null);
                }
              }}
              disabled={!hasEvents}
              className={`
                relative border-b border-r border-border/60
                min-h-[3rem] sm:min-h-[3.5rem] p-1
                flex flex-col items-center justify-start
                transition-colors
                ${hasEvents ? "cursor-pointer" : "cursor-default"}
                ${isSelected ? "bg-primary/10" : hasEvents ? "hover:bg-muted/40" : ""}
                ${isPast && !hasEvents ? "opacity-40" : ""}
              `}
            >
              <span
                className={`
                  text-xs tabular-nums leading-none mt-1
                  ${isToday ? "font-bold text-primary" : hasEvents ? "font-medium text-foreground" : "text-muted-foreground"}
                `}
              >
                {day}
              </span>

              {/* Event dots */}
              {hasEvents && (
                <div className="flex items-center gap-0.5 mt-1.5 flex-wrap justify-center">
                  {events.slice(0, 3).map((e, j) => (
                    <span
                      key={j}
                      className={`w-1.5 h-1.5 rounded-full ${getTypeDotColor(e.tournament_type)}`}
                    />
                  ))}
                  {events.length > 3 && (
                    <span className="text-[8px] text-muted-foreground ml-0.5">
                      +{events.length - 3}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          Seasonal
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          State
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Regional
        </div>
      </div>

      {/* Selected day listings */}
      {selectedDate && selectedListings.length > 0 && (
        <div className="mt-6">
          <h3 className={`${KICKER} border-b border-border/60 py-2`}>
            {formatDate(selectedDate)}
          </h3>
          <div className="divide-y divide-border/60 border-b border-border/60">
            {selectedListings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                isExpanded={expandedId === listing.id}
                onToggle={() =>
                  setExpandedId(expandedId === listing.id ? null : listing.id)
                }
              />
            ))}
          </div>
        </div>
      )}

      {selectedDate && selectedListings.length === 0 && (
        <div className="mt-4 py-6 text-center text-sm text-muted-foreground">
          No events on this date.
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export default function TournamentsClient({
  listings,
}: {
  listings: TournamentListing[];
}) {
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");

  const states = getUniqueStates(listings);

  const filtered =
    stateFilter === "all"
      ? listings
      : listings.filter((l) => l.state === stateFilter);

  const grouped = groupByMonth(filtered);

  return (
    <main className="max-w-3xl mx-auto px-4 pt-8 pb-16">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight sm:text-4xl">
          Upcoming Tournaments
        </h1>
        <div className="mt-2 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {filtered.length} event{filtered.length !== 1 ? "s" : ""} scheduled
            {stateFilter !== "all" ? ` in ${stateFilter}` : ""}
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/tournaments/results"
              className="whitespace-nowrap text-sm text-foreground hover:underline"
            >
              Recent results<span aria-hidden="true"> →</span>
            </Link>

            {/* View toggle */}
            <div className="flex items-center rounded-md border border-border">
              <button
                onClick={() => setView("list")}
                className={`flex h-11 w-11 items-center justify-center rounded-[5px] transition-colors ${
                  view === "list"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="List view"
              >
                <HiViewList className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`flex h-11 w-11 items-center justify-center rounded-[5px] transition-colors ${
                  view === "calendar"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Calendar view"
              >
                <HiCalendar className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* State filter */}
      {states.length > 1 && (
        <div className="no-scrollbar mb-6 flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setStateFilter("all")}
            className={`${CHIP} ${stateFilter === "all" ? CHIP_ACTIVE : CHIP_IDLE}`}
          >
            All states
          </button>
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(s === stateFilter ? "all" : s)}
              className={`${CHIP} ${stateFilter === s ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Calendar View */}
      {view === "calendar" && (
        <CalendarView
          listings={filtered}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
        />
      )}

      {/* List View */}
      {view === "list" && (
        <>
          {grouped.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                No upcoming tournaments
                {stateFilter !== "all" ? ` in ${stateFilter}` : ""}.
              </p>
              {stateFilter !== "all" && (
                <button
                  onClick={() => setStateFilter("all")}
                  className="mt-2 min-h-11 text-sm text-foreground underline underline-offset-2 hover:text-primary"
                >
                  Show all states
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {grouped.map(({ month, listings: monthListings }) => (
                <section key={month}>
                  <h2
                    className={`${KICKER} sticky top-16 z-10 border-b border-border/60 bg-background py-2`}
                  >
                    {month}
                  </h2>
                  <div className="divide-y divide-border/60 border-b border-border/60">
                    {monthListings.map((listing) => (
                      <ListingRow
                        key={listing.id}
                        listing={listing}
                        isExpanded={expandedId === listing.id}
                        onToggle={() =>
                          setExpandedId(
                            expandedId === listing.id ? null : listing.id
                          )
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Source attribution */}
      <div className="mt-12 border-t border-border/60 pt-6 text-center">
        <p className="text-xs text-muted-foreground">
          Tournament data sourced from{" "}
          <a
            href="https://www.cactusgamedesign.com/redemption/tournaments/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Cactus Game Design
          </a>
          . Updated daily.
        </p>
      </div>
    </main>
  );
}
