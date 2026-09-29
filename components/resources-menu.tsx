"use client";

import { useState } from "react";
import Link from "next/link";
import { HiArrowSmRight, HiDocumentText, HiHeart } from "react-icons/hi";
import { Coffee } from "lucide-react";

import { RESOURCE_SECTIONS, type ResourceLink } from "../lib/resources";

/**
 * The Resources menu body, shared by the desktop dropdown and the mobile
 * drawer so the two can never drift apart.
 *
 * The sections are collapsed by default and only one opens at a time. Flat,
 * every link rendered at once came to 18 links across 3 headers — 876px of
 * dropdown, which on a 800px-tall laptop put the last ~130px permanently below
 * the fold. The menu is anchored to the sticky nav, so scrolling the page
 * doesn't bring those rows back; they were simply unreachable.
 *
 * Collapsing inline rather than flying a submenu out to the side keeps one
 * implementation for both breakpoints, and sidesteps hover-intent and
 * viewport-edge collision handling that a flyout would need.
 */
export function ResourcesMenu({
  variant,
  onNavigate,
}: {
  variant: "desktop" | "mobile";
  onNavigate: () => void;
}) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const isMobile = variant === "mobile";
  const row = isMobile
    ? "flex items-center gap-2 px-3 py-2 rounded-md text-sm"
    : "flex items-center gap-2 px-4 py-2 text-sm";
  const linkTone = isMobile ? "text-muted-foreground" : "text-foreground";

  const renderLink = (resource: ResourceLink, indented: boolean) => {
    const Icon = resource.icon;
    const content = (
      <>
        {isMobile && Icon && <Icon className="w-4 h-4 shrink-0" />}
        {resource.label}
      </>
    );
    const className = `${row} ${linkTone} hover:bg-muted ${isMobile ? "" : "hover:text-foreground"} ${
      indented ? (isMobile ? "pl-8" : "pl-10") : ""
    }`;
    return resource.internal ? (
      <Link key={resource.href} href={resource.href} onClick={onNavigate} className={className}>
        {content}
      </Link>
    ) : (
      <a
        key={resource.href}
        href={resource.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={className}
      >
        {content}
      </a>
    );
  };

  return (
    <>
      {/* Shareable index of everything below */}
      <Link
        href="/resources"
        onClick={onNavigate}
        className={`${row} font-medium text-foreground hover:bg-muted`}
      >
        {isMobile && <HiDocumentText className="w-4 h-4" />}
        All Resources
      </Link>

      {RESOURCE_SECTIONS.map((section) => {
        const isOpen = openSection === section.id;
        return (
          <div key={section.id} className={isMobile ? "space-y-1" : undefined}>
            <button
              type="button"
              onClick={(e) => {
                // top-nav closes every dropdown on any document click. That is
                // invisible while each row navigates away, but a section toggle
                // stays put — without this the menu shuts the moment it expands.
                // stopPropagation alone is not enough: the App Router hydrates the
                // document, so React's delegated listener and top-nav's
                // outside-click listener sit on the *same* node, and only
                // stopImmediatePropagation skips a sibling listener.
                e.nativeEvent.stopImmediatePropagation();
                setOpenSection(isOpen ? null : section.id);
              }}
              aria-expanded={isOpen}
              className={`${row} mt-1 w-full justify-between border-t border-border pt-3 font-medium text-foreground hover:bg-muted`}
            >
              <span>{section.title}</span>
              <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                {/* Decorative: keeps the button's accessible name the section title alone. */}
                <span aria-hidden="true">{section.links.length}</span>
                <svg
                  className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>
            {isOpen && section.links.map((resource) => renderLink(resource, true))}
          </div>
        );
      })}

      {/* Sponsors + Report a Bug */}
      <div className="border-t border-border mt-2 pt-2">
        <Link
          href="/sponsors"
          onClick={onNavigate}
          className={`${row} text-muted-foreground hover:bg-muted hover:text-foreground`}
        >
          {isMobile && <HiHeart className="w-4 h-4" />}
          Sponsors
        </Link>
        <Link
          href="/coffee"
          onClick={onNavigate}
          className={`${row} text-muted-foreground hover:bg-muted hover:text-foreground`}
        >
          {isMobile && <Coffee className="w-4 h-4" />}
          Buy me a coffee
        </Link>
        <Link
          href="/tracker/bug"
          onClick={onNavigate}
          className={`${row} text-muted-foreground hover:bg-muted hover:text-foreground`}
        >
          {isMobile && <HiArrowSmRight className="w-4 h-4" />}
          Report a Bug
        </Link>
      </div>
    </>
  );
}
