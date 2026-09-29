"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "../../components/ui/badge";
import { useIsAdmin } from "../../hooks/useIsAdmin";
import { Settings } from "lucide-react";
import type { PublicSpoiler } from "./actions";

/* ------------------------------------------------------------------ */
/*  Lightbox                                                           */
/* ------------------------------------------------------------------ */

function Lightbox({
  spoilers,
  currentIndex,
  onClose,
  onNavigate,
}: {
  spoilers: PublicSpoiler[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const spoiler = spoilers[currentIndex];
  const touchStartX = useRef(0);
  const [copied, setCopied] = useState(false);
  const [direction, setDirection] = useState(0);

  const navigate = useCallback(
    (newIndex: number) => {
      setDirection(newIndex > currentIndex ? 1 : -1);
      onNavigate(newIndex);
    },
    [currentIndex, onNavigate]
  );

  const copyLink = useCallback(() => {
    if (!spoiler) return;
    const url = `${window.location.origin}/spoilers/${spoiler.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [spoiler]);

  // Preload adjacent card images
  useEffect(() => {
    const toPreload: string[] = [];
    if (currentIndex > 0) toPreload.push(spoilers[currentIndex - 1].image_url);
    if (currentIndex < spoilers.length - 1) toPreload.push(spoilers[currentIndex + 1].image_url);
    // Preload 2 ahead as well for fast swiping
    if (currentIndex < spoilers.length - 2) toPreload.push(spoilers[currentIndex + 2].image_url);

    toPreload.forEach((url) => {
      const img = new window.Image();
      img.src = url;
    });
  }, [currentIndex, spoilers]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) navigate(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < spoilers.length - 1)
        navigate(currentIndex + 1);
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [currentIndex, spoilers.length, onClose, navigate]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 60) {
      if (diff > 0 && currentIndex < spoilers.length - 1)
        navigate(currentIndex + 1);
      if (diff < 0 && currentIndex > 0) navigate(currentIndex - 1);
    }
  };

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir * 80,
    }),
    center: {
      x: 0,
    },
    exit: (dir: number) => ({
      x: dir * -80,
    }),
  };

  if (!spoiler) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center touch-none"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onTouchEnd={(e) => e.stopPropagation()}
        aria-label="Close"
        className="absolute top-3 right-3 z-30 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Navigation arrows */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(currentIndex - 1);
          }}
          aria-label="Previous card"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 min-w-[44px] min-h-[44px] hidden sm:flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {currentIndex < spoilers.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(currentIndex + 1);
          }}
          aria-label="Next card"
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 min-w-[44px] min-h-[44px] hidden sm:flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Card image + caption with slide animation */}
      <AnimatePresence mode="popLayout" custom={direction}>
        <motion.div
          key={currentIndex}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fixed-size container — nearly full width on mobile, constrained on desktop */}
          <div className="relative w-[min(90vw,400px)] sm:w-[min(60vw,420px)] aspect-[5/7] rounded-lg overflow-hidden">
            <Image
              src={spoiler.image_url}
              alt={spoiler.card_name}
              fill
              sizes="(max-width: 640px) 90vw, 420px"
              className="object-contain"
              unoptimized
            />
            {/* Mobile: tap left/right half of card to navigate */}
            <div className="absolute inset-0 z-10 flex sm:hidden">
              <button
                className="w-1/2 h-full"
                onClick={() => currentIndex > 0 && navigate(currentIndex - 1)}
                aria-label="Previous card"
              />
              <button
                className="w-1/2 h-full"
                onClick={() =>
                  currentIndex < spoilers.length - 1 && navigate(currentIndex + 1)
                }
                aria-label="Next card"
              />
            </div>
          </div>

          {/* Caption */}
          <div className="mt-3 mb-4 text-center px-4">
            <p className="text-white font-medium">{spoiler.card_name}</p>
            <p className="text-white/60 text-sm">
              {spoiler.set_name}
              {spoiler.set_number && ` \u00B7 ${spoiler.set_number}`}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Counter + actions (outside animation so they don't slide) */}
      <div className="text-center px-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-2">
          <p className="text-white/40 text-xs">
            {currentIndex + 1} / {spoilers.length}
          </p>
          <span className="text-white/20 text-xs">|</span>
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors min-h-[44px] px-2 justify-center"
            aria-label="Copy link to card"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Share
              </>
            )}
          </button>
          <Link
            href={`/spoilers/${spoiler.id}`}
            className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors min-h-[44px] px-2 justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Card page
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card grid cell                                                     */
/* ------------------------------------------------------------------ */

function SpoilerCard({
  spoiler,
  isNew,
  onClick,
}: {
  spoiler: PublicSpoiler;
  isNew: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full text-left"
    >
      <div className="relative aspect-[5/7] w-full rounded-lg overflow-hidden bg-muted/50">
        <Image
          src={spoiler.image_url}
          alt={spoiler.card_name}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          className="object-contain transition-transform duration-200 ease-out group-hover:scale-[1.03]"
        />
        {isNew && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded uppercase">
            New
          </span>
        )}
      </div>
      <div className="mt-1.5 px-0.5">
        <p className="text-sm font-medium truncate">{spoiler.card_name}</p>
        {spoiler.set_number && (
          <p className="text-xs text-muted-foreground">{spoiler.set_number}</p>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Set section (collapsible)                                          */
/* ------------------------------------------------------------------ */

function SetSection({
  setName,
  spoilers,
  allSpoilers,
  defaultExpanded,
  onCardClick,
}: {
  setName: string;
  spoilers: PublicSpoiler[];
  allSpoilers: PublicSpoiler[];
  defaultExpanded: boolean;
  onCardClick: (globalIndex: number) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const now = Date.now();
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  const newCount = spoilers.filter(
    (s) => new Date(s.spoil_date).getTime() >= threeDaysAgo
  ).length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{setName}</h2>
          <Badge variant="outline" className="text-xs">
            {spoilers.length} card{spoilers.length !== 1 ? "s" : ""}
          </Badge>
          {newCount > 0 && (
            <Badge variant="default" className="text-xs">
              {newCount} new
            </Badge>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {spoilers.map((spoiler) => {
              const globalIndex = allSpoilers.findIndex(
                (s) => s.id === spoiler.id
              );
              const isNew =
                new Date(spoiler.spoil_date).getTime() >= threeDaysAgo;
              return (
                <SpoilerCard
                  key={spoiler.id}
                  spoiler={spoiler}
                  isNew={isNew}
                  onClick={() => onCardClick(globalIndex)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin FAB                                                          */
/* ------------------------------------------------------------------ */

function AdminManageFab() {
  const { isAdmin, permissions, loading } = useIsAdmin();
  if (loading || !isAdmin || !permissions.includes("manage_spoilers")) return null;

  return (
    <Link
      href="/admin/spoilers"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
    >
      <Settings className="h-4 w-4" />
      Manage
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Main client component                                              */
/* ------------------------------------------------------------------ */

function SpoilersPageInner({ initialSpoilers }: { initialSpoilers: PublicSpoiler[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [setFilter, setSetFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"latest" | "set-number">("latest");
  const searchParams = useSearchParams();

  const spoilers = initialSpoilers;

  // Group by set
  const sets = [...new Set(spoilers.map((s) => s.set_name))];
  const filteredSets = setFilter ? sets.filter((s) => s === setFilter) : sets;

  const spoilersBySet: Record<string, PublicSpoiler[]> = {};
  for (const s of spoilers) {
    if (!spoilersBySet[s.set_name]) spoilersBySet[s.set_name] = [];
    spoilersBySet[s.set_name].push(s);
  }

  // Sort cards within each set by set_number when in set-number mode
  if (sortBy === "set-number") {
    for (const setName of Object.keys(spoilersBySet)) {
      spoilersBySet[setName].sort((a, b) => {
        const numA = a.set_number ? parseInt(a.set_number, 10) : Infinity;
        const numB = b.set_number ? parseInt(b.set_number, 10) : Infinity;
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return (a.set_number ?? "").localeCompare(b.set_number ?? "");
      });
    }
  }

  // Flat list — respects current sort and filter for lightbox navigation
  const flatSpoilers = filteredSets.flatMap((setName) => spoilersBySet[setName] || []);
  if (sortBy === "latest") {
    flatSpoilers.sort(
      (a, b) => new Date(b.spoil_date).getTime() - new Date(a.spoil_date).getTime()
    );
  }

  // Deep-link: open card from URL
  useEffect(() => {
    const cardId = searchParams.get("card");
    if (cardId) {
      const index = flatSpoilers.findIndex((s) => s.id === cardId);
      if (index !== -1) setLightboxIndex(index);
    }
  }, [searchParams, flatSpoilers]);

  const now = Date.now();
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  return (
    <>
      <div className="max-w-6xl mx-auto px-4 py-8 jayden-gradient-bg">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">Card Spoilers</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Preview cards from upcoming sets.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "latest" | "set-number")}
              className="h-9 rounded-md border-2 border-input bg-background px-3 text-sm"
            >
              <option value="latest">Latest</option>
              <option value="set-number">Set Number</option>
            </select>
            {sets.length > 1 && (
              <select
                value={setFilter}
                onChange={(e) => setSetFilter(e.target.value)}
                className="h-9 rounded-md border-2 border-input bg-background px-3 text-sm"
              >
                <option value="">All sets</option>
                {sets.map((s) => (
                  <option key={s} value={s}>
                    {s} ({spoilersBySet[s]?.length || 0})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Content */}
        {spoilers.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-muted-foreground">
              No spoilers right now. Check back when a new set is announced.
            </p>
          </div>
        ) : sortBy === "latest" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {flatSpoilers.map((spoiler, index) => {
              const isNew = new Date(spoiler.spoil_date).getTime() >= threeDaysAgo;
              return (
                <SpoilerCard
                  key={spoiler.id}
                  spoiler={spoiler}
                  isNew={isNew}
                  onClick={() => setLightboxIndex(index)}
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-6">
            {filteredSets.map((setName, i) => (
              <SetSection
                key={setName}
                setName={setName}
                spoilers={spoilersBySet[setName]}
                allSpoilers={flatSpoilers}
                defaultExpanded={i === 0}
                onCardClick={setLightboxIndex}
              />
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <Lightbox
          spoilers={flatSpoilers}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}

      {/* Admin FAB */}
      <AdminManageFab />
    </>
  );
}

export default function SpoilersClient({ initialSpoilers }: { initialSpoilers: PublicSpoiler[] }) {
  return (
    <Suspense>
      <SpoilersPageInner initialSpoilers={initialSpoilers} />
    </Suspense>
  );
}
