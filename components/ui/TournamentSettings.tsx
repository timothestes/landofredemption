"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, Check, Loader2, Lock } from "lucide-react";
import { suggestNumberOfRounds } from "../../utils/tournamentUtils";
import { createClient } from "../../utils/supabase/client";
import { FORMAT_IDS, normalizeTournamentFormat, type FormatId } from "../../lib/formats";
import { STANDARD_CATEGORIES } from "../../utils/tournament/categoryDefaults";
import { TOURNAMENT_TIERS } from "../../utils/tournament/tiers";
import { US_STATES } from "../../utils/tournament/usStates";
import { eventDateInputValue, planEventTypeChange, type EventTypePlan } from "../../utils/tournament/eventType";
import { fromDateInputValue, isNameFrozen } from "../../utils/tournament/naming";
import { getJoinStatsAction } from "../../app/tracker/tournaments/actions";

interface TournamentInfo {
  n_rounds: number | null;
  current_round: number | null;
  round_length: number | null;
  max_score: number | null;
  bye_points: number | null;
  bye_differential: number | null;
  starting_table_number: number | null;
  sound_notifications: boolean | null;
  numbering_mode: string | null;
  has_started: boolean | null;
  has_ended: boolean | null;
  // Event type. Edited through the dedicated tier/category state below rather
  // than in place, so these always hold the persisted values.
  name: string;
  tier: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  deck_format: string | null;
  require_decklists: boolean | null;
  created_at: string;
}

interface TournamentSettingsProps {
  tournamentId: string;
  participantCount: number;
  // Called after a successful save so the page header picks up a rename.
  onTournamentUpdated?: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const EMPTY_INFO: TournamentInfo = {
  n_rounds: null,
  current_round: null,
  round_length: null,
  max_score: null,
  bye_points: null,
  bye_differential: null,
  starting_table_number: null,
  sound_notifications: null,
  numbering_mode: "tables",
  has_started: null,
  has_ended: null,
  name: "",
  tier: null,
  category: null,
  city: null,
  state: null,
  deck_format: null,
  require_decklists: null,
  created_at: new Date(0).toISOString(),
};

// Fields the user can edit and that get written on Save.
const EDITABLE_KEYS = [
  "n_rounds",
  "round_length",
  "max_score",
  "starting_table_number",
  "bye_points",
  "bye_differential",
  "sound_notifications",
  "numbering_mode",
] as const;

export default function TournamentSettings({
  tournamentId,
  participantCount,
  onTournamentUpdated,
}: TournamentSettingsProps) {
  const [tournamentInfo, setTournamentInfo] = useState<TournamentInfo>(EMPTY_INFO);
  // Baseline reflecting what's persisted in the DB, used for dirty tracking.
  const [savedInfo, setSavedInfo] = useState<TournamentInfo>(EMPTY_INFO);
  const [round1Started, setRound1Started] = useState(false);
  const [pinnedCount, setPinnedCount] = useState(0);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Event type lives outside tournamentInfo: "" means unspecified, and the
  // cascade into name/format/derived settings is computed rather than typed.
  const [tier, setTier] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [state, setState] = useState<string>("");
  // The day of the event as the date field holds it ("2026-11-28"). It is not
  // a column: it is read out of the generated name and written back into it.
  const [eventDate, setEventDate] = useState<string>("");
  const [unofficialFormat, setUnofficialFormat] = useState<FormatId | "Other">("Other");

  const suggestedRounds = suggestNumberOfRounds(participantCount);

  useEffect(() => {
    const fetchTournamentInfo = async () => {
      if (!tournamentId) return;

      const client = createClient();
      const { data, error } = await client
        .from("tournaments")
        .select(
          "n_rounds, current_round, round_length, max_score, bye_points, bye_differential, starting_table_number, sound_notifications, has_started, has_ended, numbering_mode, name, tier, category, city, state, deck_format, require_decklists, created_at",
        )
        .eq("id", tournamentId)
        .single();

      if (error) {
        console.error("Error fetching tournament info:", error);
        return;
      }

      setTournamentInfo(data);
      setSavedInfo(data);
      setTier(data.tier ?? "");
      setCategory(data.category ?? "");
      setCity(data.city ?? "");
      setState(data.state ?? "");
      setEventDate(eventDateInputValue(data.name, data.created_at));
      setUnofficialFormat(normalizeTournamentFormat(data.deck_format) ?? "Other");

      // Only used to warn that changing the format leaves existing deck-check
      // verdicts stale. Host-gated server action; a non-host gets 0 and no warning.
      const stats = await getJoinStatsAction(tournamentId);
      setSubmittedCount(stats.success === true ? stats.submitted : 0);

      const { data: round1 } = await client
        .from("rounds")
        .select("started_at")
        .eq("tournament_id", tournamentId)
        .eq("round_number", 1)
        .maybeSingle();
      setRound1Started(!!round1?.started_at);

      const { count } = await client
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId)
        .not("assigned_seat", "is", null);
      setPinnedCount(count ?? 0);
    };

    fetchTournamentInfo();
  }, [tournamentId]);

  const flashSaved = useCallback(() => {
    setSaveStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveStatus("idle"), 3000);
  }, []);

  const editingDisabled = !!tournamentInfo.has_ended;
  const maxScoreLocked = round1Started || editingDisabled;

  const savedTier = savedInfo.tier ?? "";
  const savedCategory = savedInfo.category ?? "";
  const savedCity = savedInfo.city ?? "";
  const savedState = savedInfo.state ?? "";
  const savedUnofficialFormat = normalizeTournamentFormat(savedInfo.deck_format) ?? "Other";
  // Only an official category has a generated name for the date to go into,
  // and a cleared field is not a change.
  const pickedDate = fromDateInputValue(eventDate);
  const dateDirty =
    isNameFrozen(category) &&
    !!pickedDate &&
    eventDate !== eventDateInputValue(savedInfo.name, savedInfo.created_at);
  const eventTypeDirty =
    tier !== savedTier ||
    category !== savedCategory ||
    city.trim() !== savedCity ||
    state !== savedState ||
    dateDirty ||
    (category === "Unofficial" && unofficialFormat !== savedUnofficialFormat);

  // The same plan drives the preview and the persisted patch, so what the host
  // is shown and what gets written can't drift apart. Only computed once a
  // category is picked — there's nothing to cascade from "unspecified".
  const plan: EventTypePlan | null = useMemo(() => {
    if (!category || !eventTypeDirty) return null;
    return planEventTypeChange(
      {
        name: savedInfo.name,
        tier: savedInfo.tier,
        category: savedInfo.category,
        city: savedInfo.city,
        state: savedInfo.state,
        deck_format: savedInfo.deck_format,
        // Pending edits count as host overrides: a round length just changed by
        // hand shouldn't be re-seeded out from under them.
        max_score: tournamentInfo.max_score,
        round_length: tournamentInfo.round_length,
        require_decklists: savedInfo.require_decklists,
        created_at: savedInfo.created_at,
      },
      {
        tier: tier || null,
        category,
        city: city.trim() || null,
        state: state || null,
        date: dateDirty ? fromDateInputValue(eventDate) ?? undefined : undefined,
        unofficialFormat: category === "Unofficial" ? unofficialFormat : undefined,
      },
      { maxScoreLocked },
    );
  }, [
    category,
    eventTypeDirty,
    savedInfo,
    tournamentInfo.max_score,
    tournamentInfo.round_length,
    tier,
    city,
    state,
    eventDate,
    dateDirty,
    unofficialFormat,
    maxScoreLocked,
  ]);

  const scalarDirty = EDITABLE_KEYS.some(
    (key) => tournamentInfo[key] !== savedInfo[key],
  );
  const isDirty = scalarDirty || eventTypeDirty;

  // Changing the format leaves already-stored deck-check verdicts stale — they
  // were computed against the old one and are not re-run.
  const formatChanging =
    !!plan && normalizeTournamentFormat(savedInfo.deck_format) !== plan.deck_format;

  const handleSave = useCallback(async () => {
    const patch: Partial<TournamentInfo> = {};
    for (const key of EDITABLE_KEYS) {
      if (tournamentInfo[key] !== savedInfo[key]) {
        patch[key] = tournamentInfo[key] as never;
      }
    }
    // The event-type cascade wins over a same-field scalar edit: re-seeded
    // values are computed from the pending edits, so they're already current.
    if (plan) {
      Object.assign(patch, plan as Partial<TournamentInfo>);
    } else if (eventTypeDirty) {
      // Tier or location changed on a tournament that has no category. There's
      // nothing to cascade from and no frozen name to regenerate — just write
      // the fields themselves.
      patch.tier = tier || null;
      patch.city = city.trim() || null;
      patch.state = state || null;
    }
    if (Object.keys(patch).length === 0) return;

    const snapshot = { ...tournamentInfo, ...patch };
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const client = createClient();
      const { error } = await client
        .from("tournaments")
        .update(patch)
        .eq("id", tournamentId);
      if (error) throw error;
      setSavedInfo(snapshot);
      // Re-seeded settings and the regenerated name have to show up in the form
      // too, not just in the baseline.
      setTournamentInfo(snapshot);
      flashSaved();
      onTournamentUpdated?.();
    } catch (err) {
      console.error("Error updating tournament:", err);
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaveStatus("error");
    }
  }, [tournamentId, tournamentInfo, savedInfo, plan, flashSaved, onTournamentUpdated]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const numberingModeLocked = !!tournamentInfo.has_started || editingDisabled;
  const minRounds = Math.max(1, tournamentInfo.current_round || 1);

  const inputClasses =
    "w-full bg-background border border-border text-foreground rounded-lg p-2.5 focus:outline-none focus:border-primary/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

  // Events hosted from an official listing carry that listing's own category
  // string ("Type 1 - 2P", "Type 1 - Teams"), which isn't in the standard list.
  // Prepend it so opening Settings never silently coerces the category.
  const categoryOptions =
    savedCategory && !STANDARD_CATEGORIES.includes(savedCategory as never)
      ? [savedCategory, ...STANDARD_CATEGORIES]
      : [...STANDARD_CATEGORIES];

  // Same guard for state: the column is free text, so a value the US list
  // doesn't cover (an international event, a scraper oddity) must survive
  // opening this page rather than being silently blanked.
  const stateCodes = US_STATES.map((s) => s.code);
  const stateOptions =
    savedState && !stateCodes.includes(savedState)
      ? [savedState, ...stateCodes]
      : stateCodes;

  return (
    <div className="w-full max-w-[800px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          Tournament Settings
        </h2>
        {/* Save status lives in the sticky footer next to the button, where the
            host is actually looking when they click it — this card is tall
            enough that a header-only confirmation flashes off-screen. */}
      </div>

      <div className="bg-card jayden-gradient-bg shadow-md dark:shadow-none border border-border rounded-xl overflow-hidden">
        {/* Tournament ID */}
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Tournament ID
          </p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono text-foreground truncate flex-1 min-w-0">
              {tournamentId}
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(tournamentId)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
              title="Copy tournament ID"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {/* Event type — the single owner of category/format. The QR Join
              dialog reads these; it no longer writes them. */}
          <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Event Type</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sets the deck format players are checked against, and the event name.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Tier
                </span>
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  disabled={editingDisabled}
                  className={inputClasses}
                >
                  <option value="">Not specified</option>
                  {TOURNAMENT_TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Category
                </span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={editingDisabled}
                  className={inputClasses}
                >
                  {/* Only offered while the event genuinely has no category
                      (pre-dates the field). Once one is set, clearing it would
                      strand the frozen name with a category it no longer has. */}
                  {!savedCategory && <option value="">Not specified</option>}
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              {/* Official events only: an Unofficial event's name is the
                  host's own, so there is no date in it to correct. */}
              {isNameFrozen(category) && (
                <label className="block">
                  <span className="text-sm font-medium text-foreground mb-1.5 block">
                    Event date
                  </span>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    disabled={editingDisabled}
                    className={inputClasses}
                  />
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-4">
              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  City
                </span>
                <input
                  type="text"
                  value={city}
                  maxLength={60}
                  placeholder="Optional"
                  onChange={(e) => setCity(e.target.value)}
                  disabled={editingDisabled}
                  className={inputClasses}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  State
                </span>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  disabled={editingDisabled}
                  className={inputClasses}
                >
                  <option value="">—</option>
                  {stateOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {category === "Unofficial" ? (
              <label className="block">
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Format
                </span>
                <select
                  value={unofficialFormat}
                  onChange={(e) =>
                    setUnofficialFormat(e.target.value as FormatId | "Other")
                  }
                  disabled={editingDisabled}
                  className={inputClasses}
                >
                  {FORMAT_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </label>
            ) : (
              <div>
                <span className="text-sm font-medium text-foreground mb-1.5 block">
                  Format
                </span>
                <div className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-2.5">
                  <span className="font-medium text-foreground">
                    {plan
                      ? plan.deck_format
                      : normalizeTournamentFormat(savedInfo.deck_format) ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {category ? "Set by the category" : "Pick a category to set this"}
                  </span>
                </div>
              </div>
            )}

            {plan && (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-1">
                <p className="text-xs font-medium text-foreground">On save:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {plan.name && (
                    <li>
                      Renames to <span className="text-foreground">{plan.name}</span>
                    </li>
                  )}
                  {plan.max_score !== undefined && (
                    <li>
                      Lost Souls {tournamentInfo.max_score} → {plan.max_score}
                    </li>
                  )}
                  {plan.round_length !== undefined && (
                    <li>
                      Round length {tournamentInfo.round_length} → {plan.round_length} min
                    </li>
                  )}
                  {plan.require_decklists !== undefined && (
                    <li>
                      Decklists {plan.require_decklists ? "required" : "no longer required"}
                    </li>
                  )}
                  {!plan.name &&
                    plan.max_score === undefined &&
                    plan.round_length === undefined &&
                    plan.require_decklists === undefined && (
                      <li>No other settings change.</li>
                    )}
                </ul>
              </div>
            )}

            {formatChanging && submittedCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {submittedCount} submitted decklist{submittedCount === 1 ? " was" : "s were"}{" "}
                  checked against{" "}
                  {normalizeTournamentFormat(savedInfo.deck_format) ?? "no format"}. Changing
                  the format won&apos;t re-check {submittedCount === 1 ? "it" : "them"} — the
                  legality badges will be stale.
                </p>
              </div>
            )}
          </div>

          {/* Status row (always read-only) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/40 border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Participants
              </p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {participantCount}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Current round
              </p>
              <p className="text-2xl font-semibold text-foreground tabular-nums">
                {tournamentInfo.current_round ?? "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 border border-border p-3 col-span-2 sm:col-span-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <p className="text-sm font-medium text-foreground mt-1">
                {tournamentInfo.has_ended
                  ? "Ended"
                  : tournamentInfo.has_started
                    ? "In progress"
                    : "Not started"}
              </p>
            </div>
          </div>

          {/* Editable settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Number of Rounds
              </span>
              <input
                type="number"
                min={minRounds}
                value={tournamentInfo.n_rounds ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, n_rounds: value }));
                }}
                onBlur={(e) => {
                  const value = Math.max(minRounds, parseInt(e.target.value) || minRounds);
                  setTournamentInfo((prev) => ({ ...prev, n_rounds: value }));
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
              {participantCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Suggested for {participantCount} players: {suggestedRounds}
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Round Length (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={120}
                value={tournamentInfo.round_length ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, round_length: value }));
                }}
                onBlur={(e) => {
                  const value = Math.min(120, Math.max(1, parseInt(e.target.value) || 45));
                  setTournamentInfo((prev) => ({ ...prev, round_length: value }));
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                Maximum Lost Souls Score
                {maxScoreLocked && !editingDisabled && (
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Locked" />
                )}
              </span>
              <select
                value={tournamentInfo.max_score ?? 5}
                onChange={(e) =>
                  setTournamentInfo((prev) => ({ ...prev, max_score: Number(e.target.value) }))
                }
                disabled={maxScoreLocked}
                className={inputClasses}
              >
                <option value="5">5 Lost Souls</option>
                <option value="7">7 Lost Souls</option>
              </select>
              {maxScoreLocked && !editingDisabled && (
                <p className="text-xs text-muted-foreground mt-1">
                  Locked once round 1 has started
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Starting Table Number
              </span>
              <input
                type="number"
                min={1}
                value={tournamentInfo.starting_table_number ?? ""}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  if (!Number.isFinite(value)) return;
                  setTournamentInfo((prev) => ({ ...prev, starting_table_number: value }));
                }}
                onBlur={(e) => {
                  const value = Math.max(1, parseInt(e.target.value) || 1);
                  setTournamentInfo((prev) => ({ ...prev, starting_table_number: value }));
                }}
                disabled={editingDisabled}
                className={inputClasses}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Match Points for Bye
              </span>
              <select
                value={tournamentInfo.bye_points ?? 3}
                onChange={(e) =>
                  setTournamentInfo((prev) => ({ ...prev, bye_points: Number(e.target.value) }))
                }
                disabled={editingDisabled}
                className={inputClasses}
              >
                <option value="1">1 Point</option>
                <option value="1.5">1.5 Points</option>
                <option value="2">2 Points</option>
                <option value="3">3 Points</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 block">
                Differential for Bye
              </span>
              <select
                value={tournamentInfo.bye_differential ?? 0}
                onChange={(e) =>
                  setTournamentInfo((prev) => ({ ...prev, bye_differential: Number(e.target.value) }))
                }
                disabled={editingDisabled}
                className={inputClasses}
              >
                <option value="0">0 (No Differential)</option>
                <option value="1">+1</option>
                <option value="2">+2</option>
                <option value="3">+3</option>
                <option value="4">+4</option>
                <option value="5">+5</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                Numbering
                {numberingModeLocked && !editingDisabled && (
                  <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Locked" />
                )}
              </span>
              <select
                value={tournamentInfo.numbering_mode ?? "tables"}
                onChange={(e) =>
                  setTournamentInfo((prev) => ({ ...prev, numbering_mode: e.target.value }))
                }
                disabled={numberingModeLocked}
                className={inputClasses}
              >
                <option value="tables">Tables — one number per match</option>
                <option value="seats">Seats — numbered chairs, two per table</option>
              </select>
              {numberingModeLocked && !editingDisabled && (
                <p className="text-xs text-muted-foreground mt-1">
                  Locked once the tournament starts.
                </p>
              )}
              {pinnedCount > 0 && tournamentInfo.numbering_mode !== savedInfo.numbering_mode && (
                <p className="text-xs text-amber-500 mt-1">
                  {pinnedCount} player{pinnedCount === 1 ? " has" : "s have"} a static
                  assignment — the number keeps its value but is reinterpreted under the
                  new mode. Review assignments after saving.
                </p>
              )}
            </label>
          </div>

          {/* Sound notifications */}
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-background p-3 hover:bg-muted/40 transition-colors">
            <input
              type="checkbox"
              checked={tournamentInfo.sound_notifications ?? false}
              onChange={(e) =>
                setTournamentInfo((prev) => ({ ...prev, sound_notifications: e.target.checked }))
              }
              disabled={editingDisabled}
              className="mt-0.5 h-4 w-4 rounded border-2 border-border text-primary bg-card focus:outline-none focus:ring-0 flex-shrink-0"
            />
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground">
                Sound notification
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Play a sound when the round timer expires
              </p>
            </div>
          </label>

          {tournamentInfo.has_started && !tournamentInfo.has_ended && (
            <p className="text-xs text-muted-foreground italic">
              Changes apply to future rounds only.
            </p>
          )}
          {editingDisabled && (
            <p className="text-xs text-muted-foreground italic">
              Tournament has ended — settings are locked.
            </p>
          )}

          {!editingDisabled && (
            // Sticky so the button and its status stay on screen while the host
            // scrolls this (very tall) form. -mx/-mb pull it out of the card's
            // padding so the backdrop spans the full width.
            <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-2 px-4 sm:px-6 py-3 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 flex items-center justify-end gap-3 flex-wrap">
              <div
                className="text-xs flex items-center gap-1.5 mr-auto"
                aria-live="polite"
              >
                {saveStatus === "saving" && (
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving…
                  </span>
                )}
                {saveStatus === "saved" && (
                  <span className="text-primary flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
                {saveStatus === "error" && (
                  <span className="text-destructive">
                    Failed to save{saveError ? `: ${saveError}` : ""}
                  </span>
                )}
                {saveStatus === "idle" &&
                  (isDirty ? (
                    <span className="text-amber-600 dark:text-amber-500">
                      Unsaved changes
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No changes to save</span>
                  ))}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saveStatus === "saving"}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saveStatus === "saving" && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {saveStatus === "saving" ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
