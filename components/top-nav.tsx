"use client";

import { useState, useEffect } from "react";
import type { IconType } from "react-icons";
import { HiMenu, HiDocumentText, HiUserAdd, HiShieldCheck, HiGlobeAlt, HiSparkles, HiCalendar, HiCollection, HiChartBar, HiKey, HiClipboardList, HiShoppingCart, HiPencilAlt, HiNewspaper } from "react-icons/hi";
import { GiCrossedSwords, GiAnvil } from "react-icons/gi";
import { IoClose } from "react-icons/io5";
import { FaTrophy, FaBookOpen } from "react-icons/fa6";
import { TbCardsFilled, TbListNumbers, TbSearch } from "react-icons/tb";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "./ui/button";
import { ThemeSwitcher } from "./theme-switcher";
import { createClient } from "../utils/supabase/client";
import { getUserSafe } from "../utils/supabase/getUserSafe";
import { signOutAction } from "../app/actions";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { ResourcesMenu } from "./resources-menu";
// Hidden until Nationals 2026 registration reopens next year — see commented nav link below.
// import { NATIONALS_CONFIG } from "../app/config/nationals";

// @supabase/ssr's createBrowserClient is already a singleton in the browser,
// but binding the result to a module-level const keeps the JS reference stable
// across renders. Otherwise [supabase]-keyed effects re-fire every render and
// cause repeated getUser() round-trips, which feeds the refresh-token storm.
const supabase = createClient();

const TopNav: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isResourcesOpen, setIsResourcesOpen] = useState(false);
  const [isDecksOpen, setIsDecksOpen] = useState(false);
  const [isTournamentsOpen, setIsTournamentsOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { isAdmin, isSuperuser, permissions, isForgeMember, loading: adminLoading } = useIsAdmin();
  const pathname = usePathname();

  // Nav is "ready" when both auth and admin checks have resolved
  const navReady = !authLoading && !adminLoading;

  const [isAdminOpen, setIsAdminOpen] = useState(false);

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    setIsDecksOpen(false);
    setIsResourcesOpen(false);
    setIsAdminOpen(false);
    setIsTournamentsOpen(false);
  };

  const toggleMobileMenu = () => {
    if (isMobileMenuOpen) {
      closeMobileMenu();
    } else {
      setIsMobileMenuOpen(true);
    }
  };

  const closeAllDropdowns = () => {
    setIsResourcesOpen(false);
    setIsDecksOpen(false);
    setIsAdminOpen(false);
    setIsTournamentsOpen(false);
  };

  const toggleResources = () => {
    const next = !isResourcesOpen;
    closeAllDropdowns();
    setIsResourcesOpen(next);
  };

  const toggleDecks = () => {
    const next = !isDecksOpen;
    closeAllDropdowns();
    setIsDecksOpen(next);
  };

  const toggleAdmin = () => {
    const next = !isAdminOpen;
    closeAllDropdowns();
    setIsAdminOpen(next);
  };

  const toggleTournaments = () => {
    const next = !isTournamentsOpen;
    closeAllDropdowns();
    setIsTournamentsOpen(next);
  };


  // Auth effect — runs once on mount, listens for session changes
  useEffect(() => {
    const getUser = async () => {
      const currentUser = await getUserSafe(supabase);
      setUser(currentUser);
      setAuthLoading(false);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      closeAllDropdowns();
    };
    if (isDecksOpen || isResourcesOpen || isAdminOpen || isTournamentsOpen) {
      // Use a slight delay so the toggle click doesn't immediately re-close
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside, { once: true });
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [isDecksOpen, isResourcesOpen, isAdminOpen, isTournamentsOpen]);

  const isActive = (path: string) => pathname?.startsWith(path);

  type NavLink = { href: string; label: string; icon: IconType; highlight?: boolean; authRequired?: boolean; isNew?: boolean };

  const navLinks: NavLink[] = [
    // Hidden until Nationals 2026 registration reopens next year — re-enable this link and the NATIONALS_CONFIG import above.
    // { href: "/register", label: NATIONALS_CONFIG.adminOnly ? `${NATIONALS_CONFIG.displayName} (Admin Only)` : `${NATIONALS_CONFIG.displayName}`, icon: HiUserAdd, highlight: true },
    { href: "/play", label: "Play", icon: GiCrossedSwords },
    { href: "/decklist/card-search?new=true", label: "Deck Builder", icon: TbSearch },
    { href: "/spoilers", label: "Spoilers", icon: HiSparkles },
    { href: "/articles", label: "Articles", icon: HiNewspaper },
  ];

  const tournamentLinks: NavLink[] = [
    { href: "/tournaments", label: "Upcoming Events", icon: HiCalendar },
    { href: "/tournaments/results", label: "Results", icon: HiClipboardList, isNew: true },
    { href: "/tournaments/rnrs-points", label: "RNRS Points", icon: HiChartBar },
    { href: "/tournaments/history", label: "History", icon: FaBookOpen },
    { href: "/tracker/tournaments", label: "My Tournaments", icon: FaTrophy, authRequired: true },
  ];

  const deckLinks: NavLink[] = [
    { href: "/decklist/community", label: "Community Decks", icon: HiGlobeAlt },
    { href: "/decklist/my-decks", label: "My Decks", icon: TbCardsFilled, authRequired: true },
    { href: "/collection", label: "My Collection", icon: HiCollection, authRequired: true, isNew: true },
    { href: "/decklist/generate", label: "Deck Check PDF", icon: TbCardsFilled },
    { href: "/decklist/card-search/tier-list", label: "Tier List Maker", icon: TbListNumbers, isNew: true },
  ];

  // The document lists themselves live in lib/resources.ts so this dropdown and
  // the /resources page can never drift apart.

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background shadow-sm">
      <div className="max-w-full mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <div className="cursor-pointer" style={{ width: 120, height: 32 }}>
              <Image
                src="/brand/lor-wordmark-dark.webp"
                alt="Land of Redemption"
                width={118}
                height={32}
                style={{ width: "auto", height: "auto", maxHeight: "32px" }}
                className="dark:hidden [.jayden_&]:hidden"
                priority
              />
              <Image
                src="/brand/lor-wordmark.webp"
                alt="Land of Redemption"
                width={118}
                height={32}
                style={{ width: "auto", height: "auto", maxHeight: "32px" }}
                className="hidden dark:block [.jayden_&]:block"
                priority
              />
            </div>
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden lg:flex lg:items-center lg:space-x-1 flex-1 justify-center">
            {/* Highlighted lead link (e.g. Nationals registration) — only when present */}
            {navLinks.filter((link) => link.highlight).map((link) => {
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Dropdown - for app admins and/or Forge members */}
            {(isAdmin || isForgeMember) && (
              <div className="relative">
                <button
                  onClick={toggleAdmin}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors
                    ${isAdminOpen || isActive('/admin')
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <HiShieldCheck className="w-4 h-4" />
                  Admin
                  <svg
                    className={`w-4 h-4 transition-transform ${isAdminOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isAdminOpen && (
                  <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                    <div className="py-2">
                      {permissions.includes('manage_registrations') && (
                        <Link
                          href="/admin/registrations"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiUserAdd className="w-4 h-4" />
                          Registrations
                        </Link>
                      )}
                      {permissions.includes('manage_tags') && (
                        <Link
                          href="/admin/tags"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <TbCardsFilled className="w-4 h-4" />
                          Manage Tags
                        </Link>
                      )}
                      {permissions.includes('manage_spoilers') && (
                        <Link
                          href="/admin/spoilers"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiSparkles className="w-4 h-4" />
                          Manage Spoilers
                        </Link>
                      )}
                      {permissions.includes('manage_cards') && (
                        <Link
                          href="/admin/cards"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiCollection className="w-4 h-4" />
                          Manage Cards
                        </Link>
                      )}
                      {permissions.includes('manage_rulings') && (
                        <Link
                          href="/admin/rulings"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiDocumentText className="w-4 h-4" />
                          Manage Rulings
                        </Link>
                      )}
                      {permissions.includes('manage_shopify_imports') && (
                        <Link
                          href="/admin/ytg"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiShoppingCart className="w-4 h-4" />
                          YTG Store
                        </Link>
                      )}
                      {permissions.includes('publish_posts') && (
                        <Link
                          href="/admin/posts"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiNewspaper className="w-4 h-4" />
                          Posts
                        </Link>
                      )}
                      {(isSuperuser || permissions.includes('manage_catalog')) && (
                        <Link
                          href="/admin/catalog"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiPencilAlt className="w-4 h-4" />
                          Manage Catalog
                        </Link>
                      )}
                      {isSuperuser && (
                        <Link
                          href="/admin/permissions"
                          onClick={() => setIsAdminOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <HiKey className="w-4 h-4" />
                          Permissions
                        </Link>
                      )}
                      {isForgeMember && (
                        <div className={isAdmin ? "border-t border-border mt-1 pt-1" : undefined}>
                          <Link
                            href="/forge"
                            onClick={() => setIsAdminOpen(false)}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                          >
                            <GiAnvil className="w-4 h-4" />
                            The Forge
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Play link - after Admin */}
            <Link
              href="/play"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive('/play')
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <GiCrossedSwords className="w-4 h-4" />
              Play
            </Link>

            {/* Tournaments Dropdown */}
            <div className="relative">
              <button
                onClick={toggleTournaments}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isTournamentsOpen || isActive('/tournaments') || isActive('/tracker/tournaments')
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <FaTrophy className="w-4 h-4" />
                Events
                <svg
                  className={`w-4 h-4 transition-transform ${isTournamentsOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isTournamentsOpen && (
                <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {tournamentLinks.map((link) => {
                      if (link.authRequired && !user) return null;
                      const Icon = link.icon;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setIsTournamentsOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon className="w-4 h-4" />
                          {link.label}
                          {link.isNew && (
                            <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                              New
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Rest of nav links (Play, Spoilers and Articles are rendered separately, so exclude them) */}
            {navLinks.filter((link) => !link.highlight && link.href !== "/play" && link.href !== "/spoilers" && link.href !== "/articles").map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}

            {/* Decks Dropdown */}
            <div className="relative">
              <button
                onClick={toggleDecks}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isDecksOpen || isActive('/decklist')
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <TbCardsFilled className="w-4 h-4" />
                Decks
                <svg
                  className={`w-4 h-4 transition-transform ${isDecksOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isDecksOpen && (
                <div className="absolute left-0 mt-2 w-56 rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    {deckLinks.map((link) => {
                      const Icon = link.icon;
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setIsDecksOpen(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted"
                        >
                          <Icon className="w-4 h-4" />
                          {link.label}
                          {link.isNew && (
                            <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                              New
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Spoilers link - after Decks */}
            <Link
              href="/spoilers"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive('/spoilers')
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <HiSparkles className="w-4 h-4" />
              Spoilers
            </Link>

            {/* Articles link - after Spoilers */}
            <Link
              href="/articles"
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive('/articles')
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
            >
              <HiNewspaper className="w-4 h-4" />
              Articles
            </Link>

            {/* Resources Dropdown */}
            <div className="relative">
              <button
                onClick={toggleResources}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${isResourcesOpen
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
              >
                <HiDocumentText className="w-4 h-4" />
                Resources
                <svg
                  className={`w-4 h-4 transition-transform ${isResourcesOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Resources Dropdown Menu */}
              {isResourcesOpen && (
                <div className="absolute left-0 mt-2 w-72 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-md shadow-lg bg-card ring-1 ring-black ring-opacity-5">
                  <div className="py-2">
                    <ResourcesMenu variant="desktop" onNavigate={() => setIsResourcesOpen(false)} />
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* Auth Section - Right Side */}
          <div className="hidden lg:flex lg:items-center lg:gap-3">
            <ThemeSwitcher />
            {!navReady ? (
              <div className="flex items-center gap-2">
                <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
                <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
              </div>
            ) : user ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {user.email}
                </span>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline" size="sm">
                    Sign out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild size="sm" variant="default">
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={toggleMobileMenu}
            className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            {isMobileMenuOpen ? <IoClose size={24} /> : <HiMenu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <div className="lg:hidden border-t border-border max-h-[calc(100dvh-4rem)] overflow-y-auto">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {/* Play + Nationals links */}
            {navLinks.slice(0, 2).map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Admin Dropdown - for app admins and/or Forge members */}
            {(isAdmin || isForgeMember) && (
              <div className="pt-2">
                <button
                  onClick={toggleAdmin}
                  className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
                >
                  <div className="flex items-center gap-3">
                    <HiShieldCheck className="w-5 h-5" />
                    Admin
                  </div>
                  <svg
                    className={`w-4 h-4 transition-transform ${isAdminOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isAdminOpen && (
                  <div className="mt-2 ml-8 space-y-1">
                    {permissions.includes('manage_registrations') && (
                      <Link
                        href="/admin/registrations"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiUserAdd className="w-4 h-4" />
                        Registrations
                      </Link>
                    )}
                    {permissions.includes('manage_tags') && (
                      <Link
                        href="/admin/tags"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <TbCardsFilled className="w-4 h-4" />
                        Manage Tags
                      </Link>
                    )}
                    {permissions.includes('manage_spoilers') && (
                      <Link
                        href="/admin/spoilers"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiSparkles className="w-4 h-4" />
                        Manage Spoilers
                      </Link>
                    )}
                    {permissions.includes('manage_cards') && (
                      <Link
                        href="/admin/cards"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiCollection className="w-4 h-4" />
                        Manage Cards
                      </Link>
                    )}
                    {permissions.includes('manage_rulings') && (
                      <Link
                        href="/admin/rulings"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiDocumentText className="w-4 h-4" />
                        Manage Rulings
                      </Link>
                    )}
                    {permissions.includes('manage_shopify_imports') && (
                      <Link
                        href="/admin/ytg"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiShoppingCart className="w-4 h-4" />
                        YTG Store
                      </Link>
                    )}
                    {permissions.includes('publish_posts') && (
                      <Link
                        href="/admin/posts"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiNewspaper className="w-4 h-4" />
                        Posts
                      </Link>
                    )}
                    {(isSuperuser || permissions.includes('manage_catalog')) && (
                      <Link
                        href="/admin/catalog"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiPencilAlt className="w-4 h-4" />
                        Manage Catalog
                      </Link>
                    )}
                    {isSuperuser && (
                      <Link
                        href="/admin/permissions"
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <HiKey className="w-4 h-4" />
                        Permissions
                      </Link>
                    )}
                    {isForgeMember && (
                      <div className={isAdmin ? "border-t border-border mt-1 pt-1" : undefined}>
                        <Link
                          href="/forge"
                          onClick={closeMobileMenu}
                          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                        >
                          <GiAnvil className="w-4 h-4" />
                          The Forge
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Mobile Tournaments Section */}
            <div className="pt-2">
              <button
                onClick={toggleTournaments}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <FaTrophy className="w-5 h-5" />
                  Events
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isTournamentsOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isTournamentsOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  {tournamentLinks.map((link) => {
                    if (link.authRequired && !user) return null;
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <Icon className="w-4 h-4" />
                        {link.label}
                        {link.isNew && (
                          <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                            New
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mobile Decks Section */}
            <div className="pt-2">
              <button
                onClick={toggleDecks}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <TbCardsFilled className="w-5 h-5" />
                  Decks
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isDecksOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isDecksOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  {deckLinks.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMobileMenu}
                        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
                      >
                        <Icon className="w-4 h-4" />
                        {link.label}
                        {link.isNew && (
                          <span className="ml-auto px-1.5 py-0.5 bg-primary/15 text-primary text-[10px] font-bold rounded uppercase">
                            New
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rest of nav links (Spoilers) - after Decks */}
            {navLinks.slice(2).map((link) => {
              if (link.authRequired && !user) return null;
              const Icon = link.icon;
              const isHighlight = link.highlight;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-base font-medium transition-colors
                    ${isHighlight
                      ? 'border-2 border-primary text-primary hover:bg-primary/10'
                      : isActive(link.href)
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}

            {/* Mobile Resources Section */}
            <div className="pt-2">
              <button
                onClick={toggleResources}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium text-muted-foreground hover:bg-muted"
              >
                <div className="flex items-center gap-3">
                  <HiDocumentText className="w-5 h-5" />
                  Resources
                </div>
                <svg
                  className={`w-4 h-4 transition-transform ${isResourcesOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isResourcesOpen && (
                <div className="mt-2 ml-8 space-y-1">
                  <ResourcesMenu variant="mobile" onNavigate={closeMobileMenu} />
                </div>
              )}
            </div>

            {/* Mobile Auth Section */}
            <div className="pt-4 mt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between px-3">
                <span className="text-sm font-medium text-muted-foreground">Theme</span>
                <ThemeSwitcher />
              </div>
              {user ? (
                <>
                  <div className="px-3 text-sm text-muted-foreground">
                    {user.email}
                  </div>
                  <form
                    action={signOutAction}
                    className="px-3"
                  >
                    <Button type="submit" variant="outline" size="sm" className="w-full">
                      Sign out
                    </Button>
                  </form>
                </>
              ) : (
                <div className="px-3 space-y-2">
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                  <Button asChild size="sm" variant="default" className="w-full">
                    <Link href="/sign-up">Sign up</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default TopNav;
