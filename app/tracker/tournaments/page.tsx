"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import Breadcrumb from "../../../components/ui/breadcrumb";
import { createClient } from "../../../utils/supabase/client";
import { getUserSafe } from "../../../utils/supabase/getUserSafe";
import ToastNotification from "../../../components/ui/toast-notification";
import { Button } from "../../../components/ui/button";
import { HiPencil, HiTrash, HiPlus, HiOutlineDesktopComputer, HiOutlineLogin } from "react-icons/hi";
import { useRouter, useSearchParams } from "next/navigation";
import TournamentFormModal from "../../../components/ui/tournament-form-modal";
import JoinCodeDialog from "../../../components/ui/JoinCodeDialog";
import { categoryDefaults, requireDecklistsDefault } from "../../../utils/tournament/categoryDefaults";
import { normalizeTier } from "../../../utils/tournament/tiers";
import { getFormatDef } from "@/lib/formats";

const supabase = createClient();

function TournamentsPageInner() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddTournamentModalOpen, setisAddTournamentModalOpen] =
    useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [currentTournament, setCurrentTournament] = useState(null);
  const [newTournamentName, setNewTournamentName] = useState("");
  const [listingCity, setListingCity] = useState("");
  const [fromListingId, setFromListingId] = useState<string | null>(null);
  const [listingFormats, setListingFormats] = useState<string[]>([]);
  const [listingTier, setListingTier] = useState<string | null>(null);
  const [listingState, setListingState] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    fetchTournaments();
    // Reset document title when viewing tournaments list
    document.title = "Land of Redemption";

    // Auto-open modal if coming from "Host This Event" on /tournaments
    const listingId = searchParams.get("from_listing");
    const city = searchParams.get("city");
    const formats = searchParams.get("formats");
    // The listing's advertised tournament_type is free text ("South Central
    // Regional"); normalizeTier collapses it onto a canonical tier, or null if
    // it's something we don't recognize.
    const type = searchParams.get("type");
    const state = searchParams.get("state");
    if (listingId) {
      setListingCity(city ?? "");
      setListingState(state);
      setFromListingId(listingId);
      setListingFormats(formats ? formats.split("|").filter(Boolean) : []);
      setListingTier(normalizeTier(type));
      setisAddTournamentModalOpen(true);
    }
  }, [searchParams]);

  // Recover automatically when the session comes back (e.g. token refreshed),
  // and surface the session-expired state if the user gets signed out.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        fetchTournaments();
      } else if (event === "SIGNED_OUT") {
        setSessionError(true);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each item becomes one tournament. Hosting an event that offers several types
  // creates one per checked type in a single insert; when hosting from a listing
  // they share its listing_id and group under one event card.
  const handleAddTournament = async (
    items: {
      name: string;
      category: string | null;
      tier: string | null;
      city: string | null;
      state: string | null;
    }[]
  ) => {
    if (items.length === 0) return;
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error("Error fetching user:", userError);
        return;
      }
      // A silently-gone session returns no error but a null user; surface it the
      // same way the list does rather than throwing on user.id below.
      if (!user) {
        setSessionError(true);
        return;
      }

      const rows = items.map(({ name, category, tier, city, state }) => {
        const row: Record<string, unknown> = { name, host_id: user.id };
        if (fromListingId) row.listing_id = fromListingId;
        if (tier) row.tier = tier;
        if (city) row.city = city;
        if (state) row.state = state;
        // A chosen category records the format and pre-fills sensible settings the
        // host can still change later in Tournament Settings.
        if (category) {
          row.category = category;
          row.require_decklists = requireDecklistsDefault(category);
          const defaults = categoryDefaults(category);
          row.deck_format = defaults.deck_format;
          row.max_score = defaults.max_score;
          row.round_length = defaults.round_length;
        }
        return row;
      });

      const { data, error } = await supabase
        .from("tournaments")
        .insert(rows)
        .select("id");
      if (error) {
        console.error("Error adding tournament:", error);
      } else {
        // If created from a listing, point the listing back at the first new
        // tournament so the public page can show it's been picked up.
        if (fromListingId && data?.[0]?.id) {
          await supabase
            .from("tournament_listings")
            .update({ linked_tournament_id: data[0].id })
            .eq("id", fromListingId);
          setFromListingId(null);
          setListingCity("");
          setListingFormats([]);
          setListingTier(null);
          setListingState(null);
          // Clean up URL params
          router.replace("/tracker/tournaments", { scroll: false });
        }
        fetchTournaments();
        setisAddTournamentModalOpen(false);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
    }
  };

  // Open the create modal pre-targeted at an existing event's listing so the
  // host can add a category that was played later (or skipped on the day).
  // Tier and location are inherited from the siblings so the new category's
  // generated name matches the rest of the event. Not every sibling
  // necessarily has them set, so scan the whole group rather than just the
  // most recent one. Note: the generated date is today's, not the original
  // event date — a category added after the fact carries the date it was
  // created.
  const openHostAnotherCategory = (listingId: string, group: any[]) => {
    setFromListingId(listingId);
    setListingCity(group.map((t) => t.city).find(Boolean) ?? "");
    setListingState(group.map((t) => t.state).find(Boolean) ?? null);
    setListingTier(group.map((t) => t.tier).find(Boolean) ?? null);
    setListingFormats([]);
    setisAddTournamentModalOpen(true);
  };

  const fetchTournaments = async () => {
    // Verify the session first. The tournaments list is scoped entirely by the
    // RLS policy (auth.uid() = host_id), so a missing/expired token makes the
    // query return zero rows with no error — which would otherwise render as a
    // silent "No tournaments found". getUserSafe refreshes the token if it can
    // (self-heals a transient hiccup) and, crucially, keeps the session on a
    // network blip — so flaky venue wifi doesn't trigger a false "session
    // expired"; it only returns null when the server truly rejects the session.
    const user = await getUserSafe(supabase);
    if (!user) {
      setSessionError(true);
      setLoading(false);
      return;
    }
    setSessionError(false);

    const { data: tournaments, error } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Error fetching tournaments:", error);
    } else {
      setTournaments(tournaments);
    }
    setLoading(false);
  };

  const updateTournament = async () => {
    if (!currentTournament || !newTournamentName.trim()) return;

    const { data, error } = await supabase
      .from("tournaments")
      .update({ name: newTournamentName })
      .eq("id", currentTournament.id)
      .select();
    if (error) console.error("Error updating tournament:", error);
    else {
      fetchTournaments();
      setIsEditModalOpen(false);
    }
  };

  const deleteTournament = async (id) => {
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) console.error("Error deleting tournament:", error);
    else {
      fetchTournaments();
      setShowDeleteToast(true);
      setTimeout(() => setShowDeleteToast(false), 2000); // 2 seconds
    }
  };

  // Tournaments linked to the same listing are one real-world event with
  // multiple categories; everything else stands alone.
  const { groups, ungrouped } = useMemo(() => {
    const byListing = new Map<string, any[]>();
    const standalone: any[] = [];
    for (const t of tournaments) {
      if (t.listing_id) {
        if (!byListing.has(t.listing_id)) byListing.set(t.listing_id, []);
        byListing.get(t.listing_id)!.push(t);
      } else {
        standalone.push(t);
      }
    }
    return { groups: Array.from(byListing.entries()), ungrouped: standalone };
  }, [tournaments]);

  const formatCreatedAt = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));

  const deckFormatLabel = (format: string | null) => {
    if (!format) return null;
    if (format === "Other") return "Other"; // draft/sealed/etc. — not a real format id
    return getFormatDef(format).label; // "T1"/"T2"/"Paragon" -> Limited/T2/Paragon
  };

  // Subtle, scannable tint per category — mirrors the listing badges and keeps
  // the primary green reserved for actions.
  const typePillClasses = (type: string) => {
    const t = type.toLowerCase();
    const base =
      "inline-flex items-center flex-shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ";
    if (t.includes("teams"))
      return base + "bg-purple-500/15 text-purple-700 dark:text-purple-400";
    if (t.includes("type 2") || t === "t2")
      return base + "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    if (t.includes("draft"))
      return base + "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400";
    if (t.includes("sealed"))
      return base + "bg-teal-500/15 text-teal-700 dark:text-teal-400";
    if (t.includes("paragon"))
      return base + "bg-rose-500/15 text-rose-700 dark:text-rose-400";
    if (t === "limited")
      return base + "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    if (t.includes("type 1") || t.includes("type a") || t === "t1" || t === "unlimited")
      return base + "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    return base + "bg-muted text-muted-foreground";
  };

  // showName=false is used inside an event group, where the event name is in the
  // header and the category pill is the row's identity.
  const renderRow = (tournament: any, showName: boolean) => {
    const type = tournament.category || deckFormatLabel(tournament.deck_format);
    const showNameText = showName || !type;
    return (
    <li
      key={tournament.id}
      className="bg-card cursor-pointer hover:bg-muted transition-colors"
      onClick={() => router.push(`/tracker/tournaments/${tournament.id}`)}
    >
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {showNameText && (
              <p className="font-medium text-foreground truncate">
                {tournament.name}
              </p>
            )}
            {type && (
              <span className={typePillClasses(type)}>{type}</span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {formatCreatedAt(tournament.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/tracker/tournaments/${tournament.id}`);
            }}
            className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors touch-manipulation"
            aria-label="Edit"
          >
            <HiPencil className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteTournament(tournament.id);
            }}
            className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors touch-manipulation"
            aria-label="Delete"
          >
            <HiTrash className="w-5 h-5" />
          </button>
        </div>
      </div>
    </li>
    );
  };

  return (
    <div className="flex min-h-screen px-4 sm:px-5 w-full">
      <div className="max-w-4xl mx-auto space-y-3 w-full">
        <Breadcrumb
          items={[{ label: "Tournaments", href: "/tracker/tournaments" }]}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <h1 className="font-cinzel text-2xl font-bold tracking-tight mt-2 sm:text-3xl">Your Tournaments</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Button variant="outline" className="flex items-center gap-2" asChild>
              <a href="/board" target="_blank" rel="noopener noreferrer">
                <HiOutlineDesktopComputer className="w-4 h-4" />
                <span>Projector view</span>
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsJoinDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <HiOutlineLogin className="w-4 h-4" />
              <span>Join a Tournament</span>
            </Button>
            <Button
              onClick={() => setisAddTournamentModalOpen(true)}
              className="flex items-center gap-3 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <div className="flex items-center gap-1">
                <HiPlus className="w-4 h-4" />
                <span>Host a Tournament</span>
              </div>
            </Button>
          </div>
          <TournamentFormModal
            isOpen={isAddTournamentModalOpen}
            onClose={() => {
              setisAddTournamentModalOpen(false);
              if (fromListingId) {
                setFromListingId(null);
                setListingCity("");
                setListingFormats([]);
                setListingTier(null);
                setListingState(null);
                router.replace("/tracker/tournaments", { scroll: false });
              }
            }}
            onSubmit={handleAddTournament}
            listingCity={listingCity}
            categoryOptions={listingFormats.length > 0 ? listingFormats : undefined}
            listingState={listingState}
            defaultTier={listingTier}
          />
          <JoinCodeDialog
            isOpen={isJoinDialogOpen}
            onClose={() => setIsJoinDialogOpen(false)}
          />
        </div>
        {loading ? (
          <p>Loading tournaments...</p>
        ) : sessionError ? (
          <div className="rounded-lg border border-border bg-card px-4 py-6 text-center space-y-3">
            <p className="font-medium text-foreground">Your session expired</p>
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t verify your sign-in, so your tournaments
              can&apos;t load right now. Don&apos;t worry — none of your data is
              lost. Reload to sign back in.
            </p>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </div>
        ) : tournaments.length === 0 ? (
          <p className="text-muted-foreground">No tournaments found.</p>
        ) : (
          <div className="space-y-4">
            {groups.map(([listingId, group]) => (
              <div
                key={listingId}
                className="jayden-gradient-bg rounded-lg overflow-hidden border border-border"
              >
                <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 bg-muted/40 border-b border-border">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">
                      {group[0].name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {group.length}{" "}
                      {group.length === 1 ? "category" : "categories"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      openHostAnotherCategory(listingId, group)
                    }
                    className="flex items-center gap-1.5 flex-shrink-0 text-xs px-2.5 py-1.5"
                  >
                    <HiPlus className="w-4 h-4" />
                    <span className="hidden sm:inline">Host another category</span>
                    <span className="sm:hidden">Category</span>
                  </Button>
                </div>
                <ul className="divide-y divide-border">
                  {group.map((t) => renderRow(t, false))}
                </ul>
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div className="jayden-gradient-bg rounded-lg overflow-hidden border border-border">
                <ul className="divide-y divide-border">
                  {ungrouped.map((t) => renderRow(t, true))}
                </ul>
              </div>
            )}
          </div>
        )}
        <ToastNotification
          message="Tournament deleted successfully!"
          show={showDeleteToast}
          onClose={() => setShowDeleteToast(false)}
          type="error"
        />
      </div>
    </div>
  );
}

export default function TournamentsPage() {
  return (
    <Suspense>
      <TournamentsPageInner />
    </Suspense>
  );
}
