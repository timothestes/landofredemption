"use client";
import React from "react";

interface MobileBottomNavProps {
  isDeckOpen: boolean;
  onToggleDeck: () => void;
  deckCardCount: number;
  onSaveDeck?: () => void;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  isAuthenticated?: boolean;
}

export function MobileBottomNav({
  isDeckOpen,
  onToggleDeck,
  deckCardCount,
  onSaveDeck,
  hasUnsavedChanges = false,
  isSaving = false,
  isAuthenticated = false,
}: MobileBottomNavProps) {
  // The Save slot is always laid out, even before auth resolves and while the deck
  // is empty, so Search and Deck never slide sideways under a thumb. Signed-out
  // players keep the slot invisible and inert; an empty deck shows Save disabled.
  const hasChangesToSave = hasUnsavedChanges && deckCardCount > 0;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-[70] bg-card border-t border-border flex items-center justify-around h-14 pb-[env(safe-area-inset-bottom)]">
      {onSaveDeck && (
        <button
          onClick={onSaveDeck}
          disabled={!isAuthenticated || isSaving || !hasChangesToSave}
          className={`relative flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg transition-colors ${
            isAuthenticated ? "" : "invisible"
          } ${
            isSaving
              ? "text-muted-foreground"
              : hasChangesToSave
                ? "text-green-600 dark:text-green-400"
                : "text-muted-foreground"
          }`}
        >
          {isSaving ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          )}
          <span className="text-[10px] font-medium">
            {isSaving ? "Saving" : "Save"}
          </span>
          {hasChangesToSave && !isSaving && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-green-500 rounded-full" />
          )}
        </button>
      )}

      <button
        onClick={() => { if (isDeckOpen) onToggleDeck(); }}
        className={`flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-lg transition-colors ${
          !isDeckOpen
            ? "text-primary"
            : "text-muted-foreground"
        }`}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-xs font-medium">Search</span>
      </button>

      <button
        onClick={onToggleDeck}
        className={`relative flex flex-col items-center gap-0.5 px-6 py-1.5 rounded-lg transition-colors ${
          isDeckOpen
            ? "text-accent"
            : "text-muted-foreground"
        }`}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-xs font-medium">Deck</span>
        {deckCardCount > 0 && (
          <span className="absolute -top-1 right-2 bg-purple-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {deckCardCount}
          </span>
        )}
      </button>
    </nav>
  );
}
