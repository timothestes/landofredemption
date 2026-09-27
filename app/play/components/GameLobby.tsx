'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Pencil, ArrowLeftRight, Eye } from 'lucide-react';
import { getCardImageUrl } from '@/lib/card-images';
import { getCardImageUrl as getBlobCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useSpacetimeConnection } from '../hooks/useSpacetimeConnection';
import { SpacetimeProvider } from '../lib/spacetimedb-provider';
import { DeckPickerModal, type PickerTab } from './DeckPickerModal';
import { hasStarterDecks } from '@/app/config/starterDecks';
import { LobbyList } from './LobbyList';
import UsernameModal from '@/app/decklist/my-decks/UsernameModal';
import { loadDeckForGame, getInviteGameInfo } from '../actions';
import type { InviteGameInfo } from '../actions';
import type { DeckOption } from './DeckPickerCard';

/** Survives the /play → /play/[code] → /play bounce a failed join causes.
 *  Deliberately sessionStorage: scoped to this tab's visit, not a preference. */
const SELECTED_DECK_KEY = 'play_selected_deck';

interface GameLobbyProps {
  decks: DeckOption[];
  userId: string;
  displayName: string;
  hasUsername: boolean;
}

export function GameLobby({ decks, userId, displayName: initialDisplayName, hasUsername: initialHasUsername }: GameLobbyProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill game code from ?join=XXXX invite link
  const joinCode = searchParams.get('join')?.toUpperCase().slice(0, 4) ?? '';

  // Decks are sorted server-side by last_played_at DESC NULLS LAST, so decks[0]
  // is already the last-played deck — no client-side swap needed.
  const [selectedDeck, setSelectedDeck] = useState<DeckOption | null>(
    decks.length > 0 ? decks[0] : null
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>('my');
  function openPicker(tab: PickerTab) {
    setPickerTab(tab);
    setPickerOpen(true);
  }

  // Warm the browser HTTP cache with the selected deck's card images as soon
  // as the user commits to a deck. By the time they click Host/Join and
  // navigate into /play/[code], the images are already on disk — cold-deck
  // startup goes from "several seconds" to "instant." Especially matters for
  // the joiner, who otherwise has no idle window before the game begins.
  const prefetchedDeckIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const deckId = selectedDeck?.id;
    if (!deckId) return;
    if (prefetchedDeckIdsRef.current.has(deckId)) return;
    prefetchedDeckIdsRef.current.add(deckId);

    let cancelled = false;
    (async () => {
      try {
        const result = await loadDeckForGame(deckId);
        if (cancelled) return;
        const seen = new Set<string>();
        for (const card of result.deckData) {
          if (!card.cardImgFile) continue;
          const url = getBlobCardImageUrl(card.cardImgFile);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          // Fire-and-forget: the browser HTTP cache holds the response; we
          // don't need the decoded image here. No retry — this is best-effort
          // warmup; the real preloader in /play/[code] is what drives the game.
          const img = new Image();
          img.src = url;
        }
      } catch {
        // Silent. A failed warmup just means the real preloader will fetch
        // normally once the game starts. Nothing to surface to the user.
      }
    })();

    return () => { cancelled = true; };
  }, [selectedDeck?.id]);

  // Game state
  const [gameCode, setGameCode] = useState(joinCode);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spectate toggle
  const [isSpectate, setIsSpectate] = useState(false);

  // Invite-link mode: classify the code so Forge playtest games don't show
  // dead-end Join/Spectate buttons (null = still resolving).
  const [inviteInfo, setInviteInfo] = useState<InviteGameInfo | null>(null);
  useEffect(() => {
    if (!joinCode) return;
    let cancelled = false;
    getInviteGameInfo(joinCode)
      .then((info) => { if (!cancelled) setInviteInfo(info); })
      .catch(() => { if (!cancelled) setInviteInfo({ isForge: false, isForgeMember: false }); });
    return () => { cancelled = true; };
  }, [joinCode]);

  // Username gate — require a username before creating/joining games
  const [hasUsername, setHasUsername] = useState(initialHasUsername);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<'create' | 'join' | 'lobby-join' | null>(null);
  const [pendingLobbyCode, setPendingLobbyCode] = useState<string | null>(null);

  // Show error from redirect (e.g. stale lobby join attempt)
  useEffect(() => {
    const lobbyError = sessionStorage.getItem('lobby_error');
    if (lobbyError) {
      setError(lobbyError);
      sessionStorage.removeItem('lobby_error');
    }
  }, []);

  // Restore the deck choice after a bounce through /play/[code]. A failed join
  // remounts this component, and `selectedDeck` only ever initialises from the
  // user's OWN decks — so a community deck (the only option for someone who
  // owns none) was silently discarded, disabling Create Game and forcing the
  // whole picker flow again just because a code was mistyped.
  useEffect(() => {
    if (selectedDeck) return;
    try {
      const saved = sessionStorage.getItem(SELECTED_DECK_KEY);
      if (saved) setSelectedDeck(JSON.parse(saved) as DeckOption);
    } catch {
      // Malformed or unavailable storage — fall through to the normal picker.
    }
  }, []);

  const [isPrivate, setIsPrivate] = useState(false);

  // SpacetimeDB connection for lobby
  const { connectionBuilder, error: connError } = useSpacetimeConnection();

  function handleSelectDeck(deck: DeckOption) {
    setSelectedDeck(deck);
    setPickerOpen(false);
    setError(null);
    try {
      sessionStorage.setItem(SELECTED_DECK_KEY, JSON.stringify(deck));
    } catch {
      // Storage unavailable (private mode): the pick still works for this view.
    }
  }

  function handleUsernameSet(newUsername: string) {
    setHasUsername(true);
    setDisplayName(newUsername);
    setShowUsernameModal(false);

    // Resume the action that was blocked
    const action = pendingAction;
    const lobbyCode = pendingLobbyCode;
    setPendingAction(null);
    setPendingLobbyCode(null);

    if (action === 'create') handleCreateGame(newUsername);
    else if (action === 'join') handleJoinGame(newUsername);
    else if (action === 'lobby-join' && lobbyCode) handleJoinFromLobby(lobbyCode, newUsername);
  }

  function handleUsernameClosed() {
    setShowUsernameModal(false);
    setPendingAction(null);
    setPendingLobbyCode(null);
  }

  function handleWatchFromLobby(code: string) {
    router.push(`/play/spectate/${code}`);
  }

  function handleJoinFromLobby(code: string, overrideDisplayName?: string) {
    if (!hasUsername && !overrideDisplayName) {
      setPendingAction('lobby-join');
      setPendingLobbyCode(code);
      setShowUsernameModal(true);
      return;
    }
    if (!selectedDeck) {
      setError('Please select a deck first.');
      return;
    }
    setGameCode(code);
    setIsJoining(true);
    setError(null);
    localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
    sessionStorage.setItem(
      `stdb_game_params_${code}`,
      JSON.stringify({
        role: 'join',
        deckId: selectedDeck.id,
        deckName: selectedDeck.name,
        displayName: overrideDisplayName || displayName,
        supabaseUserId: userId,
        format: selectedDeck.format || 'Type 1',
        paragon: selectedDeck.paragon || null,
      })
    );
    router.push(`/play/${code}`);
  }

  function handleCreateGame(overrideDisplayName?: string) {
    if (!hasUsername && !overrideDisplayName) {
      setPendingAction('create');
      setShowUsernameModal(true);
      return;
    }
    if (!selectedDeck) {
      setError('Please select a deck.');
      return;
    }
    setIsCreating(true);
    setError(null);
    localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
    const code = Math.random().toString(36).slice(2, 6).toUpperCase();
    sessionStorage.setItem(
      `stdb_game_params_${code}`,
      JSON.stringify({
        role: 'create',
        deckId: selectedDeck.id,
        deckName: selectedDeck.name,
        displayName: overrideDisplayName || displayName,
        supabaseUserId: userId,
        format: selectedDeck.format || 'Type 1',
        paragon: selectedDeck.paragon || null,
        isPublic: !isPrivate,
        lobbyMessage: '',
      })
    );
    router.push(`/play/${code}`);
  }

  function handleJoinGame(overrideDisplayName?: string) {
    const code = gameCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Game code must be 4 characters.');
      return;
    }
    if (isSpectate) {
      router.push(`/play/spectate/${code}`);
      return;
    }
    if (!hasUsername && !overrideDisplayName) {
      setPendingAction('join');
      setShowUsernameModal(true);
      return;
    }
    if (!selectedDeck) {
      setError('Please select a deck.');
      return;
    }
    setIsJoining(true);
    setError(null);
    localStorage.setItem('lastPlayedDeckId', selectedDeck.id);
    sessionStorage.setItem(
      `stdb_game_params_${code}`,
      JSON.stringify({
        role: 'join',
        deckId: selectedDeck.id,
        deckName: selectedDeck.name,
        displayName: overrideDisplayName || displayName,
        supabaseUserId: userId,
        format: selectedDeck.format || 'Type 1',
        paragon: selectedDeck.paragon || null,
      })
    );
    router.push(`/play/${code}`);
  }

  // Preview image helpers
  const img1Url = getCardImageUrl(selectedDeck?.preview_card_1);
  const img2Url = getCardImageUrl(selectedDeck?.preview_card_2);
  const hasPreview = img1Url || img2Url;
  const isParagon =
    selectedDeck?.format?.toLowerCase().includes('paragon') && selectedDeck?.paragon;

  // In invite-link mode the top deck picker only applies to a normal (non-Forge)
  // "Join as Player". Forge invites pick their playtest deck on /forge/play, so
  // hide it for Forge games — and while we're still classifying the code, to
  // avoid a flash of the wrong picker.
  const showDeckSection = !joinCode || (inviteInfo !== null && !inviteInfo.isForge);

  return (
    <div className="flex flex-col gap-5">
      {/* Deck selection — hidden for Forge invites; the Forge lobby has its own
          playtest-deck picker. Matches community/my-decks card preview style. */}
      {showDeckSection && (
      <section className="rounded-lg border border-border overflow-hidden bg-gradient-to-br from-card to-muted/40 [.jayden_&]:border-primary/30 [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)]">
        {selectedDeck ? (
          <>
            {/* Card preview header — same style as community DeckCard */}
            {isParagon ? (
              <div className="h-32 overflow-hidden">
                <img
                  src={`/paragons/Paragon ${selectedDeck.paragon}.png`}
                  alt={selectedDeck.paragon!}
                  className="w-full h-full object-cover object-top"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ) : hasPreview ? (
              <div className="h-32 overflow-hidden flex items-center justify-center gap-1 px-2 py-2">
                {img1Url && (
                  <img src={img1Url} alt="" className="h-full object-contain rounded shadow-md" />
                )}
                {img2Url && (
                  <img src={img2Url} alt="" className="h-full object-contain rounded shadow-md" />
                )}
              </div>
            ) : (
              <div className="h-20 bg-muted flex items-center justify-center">
                <img
                  src="/gameplay/cardback.webp"
                  alt=""
                  className="h-14 w-auto object-contain rounded opacity-30"
                />
              </div>
            )}

            {/* Deck info + change button */}
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex flex-col min-w-0">
                <span className="font-semibold truncate text-base">{selectedDeck.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {selectedDeck.format && (
                    <Badge variant="secondary" className="text-xs">
                      {selectedDeck.format}
                    </Badge>
                  )}
                  {selectedDeck.card_count != null && (
                    <span className="text-xs text-muted-foreground">
                      {selectedDeck.card_count} cards
                    </span>
                  )}
                  {selectedDeck.id === decks[0]?.id && selectedDeck.last_played_at && (
                    <span className="text-xs text-muted-foreground/80">· Last played</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!selectedDeck.username && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/decklist/card-search?deckId=${selectedDeck.id}`} className="inline-flex items-center gap-1.5">
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => openPicker('my')}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  Change deck
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6 px-5">
            <p className="text-sm text-muted-foreground text-center">
              {hasStarterDecks() ? (
                <>
                  No saved decks yet. Try a starter deck,{' '}
                  <a href="/decklist/card-search" className="underline text-primary">
                    build one
                  </a>
                  , or pick from the community.
                </>
              ) : (
                <>
                  No saved decks.{' '}
                  <a href="/decklist/card-search" className="underline text-primary">
                    Build one
                  </a>{' '}
                  or pick from the community.
                </>
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {hasStarterDecks() && (
                <Button onClick={() => openPicker('starter')}>
                  Try a starter deck
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => openPicker('my')}
              >
                Browse Decks
              </Button>
            </div>
          </div>
        )}
      </section>
      )}

      {/* Deck Picker Modal */}
      {showDeckSection && (
        <DeckPickerModal
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handleSelectDeck}
          selectedDeckId={selectedDeck?.id}
          initialTab={pickerTab}
        />
      )}

      {/* Actions — invite link mode shows join/spectate choice, normal mode shows create/join + lobby */}
      {joinCode ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground text-center">
            You&apos;ve been invited to game <span className="font-mono font-bold text-foreground">{joinCode}</span>
          </p>
          {inviteInfo === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : inviteInfo.isForge ? (
            inviteInfo.isForgeMember ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    size="lg"
                    onClick={() => router.push(`/forge/play?join=${joinCode}`)}
                    className="flex-1 h-12 text-base"
                  >
                    Join as Player
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => router.push(`/play/spectate/${joinCode}`)}
                    className="flex-1 h-12 text-base"
                  >
                    Watch as Spectator
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Playtest game — joining uses one of your{' '}
                  <Link href="/forge/play/decks" className="underline hover:text-foreground">
                    Forge decks
                  </Link>.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center">This game is private.</p>
            )
          ) : (
            <div className="flex gap-2">
              <Button
                size="lg"
                onClick={() => handleJoinGame()}
                disabled={isJoining || !selectedDeck}
                className="flex-1 h-12 text-base"
              >
                {isJoining ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Joining...
                  </>
                ) : (
                  'Join as Player'
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => router.push(`/play/spectate/${joinCode}`)}
                className="flex-1 h-12 text-base"
              >
                Watch as Spectator
              </Button>
            </div>
          )}
          <a
            href="/play"
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors text-center"
          >
            Or create your own game
          </a>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </div>
      ) : (
        <SpacetimeProvider connectionBuilder={connectionBuilder}>
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <div className="sm:basis-0 sm:flex-1 flex flex-col gap-2.5">
              <Button
                size="lg"
                onClick={() => handleCreateGame()}
                disabled={isCreating || isJoining || !selectedDeck}
                className="w-full h-12 text-base"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading deck...
                  </>
                ) : (
                  'Create Game'
                )}
              </Button>
              {/* Private game toggle — visually belongs to Create Game */}
              <div className="flex items-center gap-2.5 justify-center">
                <label htmlFor="private-toggle" className="text-sm text-muted-foreground">
                  Private game
                </label>
                <button
                  id="private-toggle"
                  role="switch"
                  aria-checked={isPrivate}
                  onClick={() => setIsPrivate(!isPrivate)}
                  className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    isPrivate ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isPrivate ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* OR divider */}
            <div className="flex sm:flex-col items-center justify-center gap-2 sm:gap-1 py-1 sm:py-0 sm:px-2 shrink-0">
              <div className="flex-1 h-px sm:h-auto sm:w-px bg-border sm:flex-1" />
              <span className="text-xs text-muted-foreground tracking-widest">OR</span>
              <div className="flex-1 h-px sm:h-auto sm:w-px bg-border sm:flex-1" />
            </div>

            <div className="sm:basis-0 sm:flex-1 flex flex-col gap-2.5">
              <div className="flex gap-2">
                <Input
                  value={gameCode}
                  onChange={(e) =>
                    setGameCode(e.target.value.toUpperCase().slice(0, 4))
                  }
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text').toUpperCase();
                    const cleaned = pasted.replace(/[^A-Z0-9]/g, '');
                    if (cleaned.length > 4 || /[^A-Z0-9]/.test(pasted)) {
                      e.preventDefault();
                      setGameCode(cleaned.slice(-4));
                    }
                  }}
                  // "Game Code" truncated to "GAME COD" in the phone-width
                  // input; the aria-label keeps the accessible name (and the
                  // e2e getByRole lookups) intact.
                  placeholder="CODE"
                  aria-label="Game Code"
                  maxLength={4}
                  // Keyboard hints for a 4-char code (mirrors app/join):
                  // caps to match the CSS-uppercased field, no autocorrect /
                  // QuickType over it, Go key submits instead of doing nothing.
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      gameCode.length === 4 &&
                      !isJoining &&
                      !isCreating &&
                      (isSpectate || selectedDeck)
                    ) {
                      handleJoinGame();
                    }
                  }}
                  className="flex-1 uppercase tracking-widest font-mono text-center h-12 text-base focus-visible:ring-0 focus-visible:border-primary"
                />
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => handleJoinGame()}
                  disabled={isJoining || isCreating || gameCode.length !== 4 || (!isSpectate && !selectedDeck)}
                  className="shrink-0 h-12 w-24"
                >
                  {isJoining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isSpectate ? (
                    <>
                      <Eye className="mr-1.5 h-4 w-4" />
                      Watch
                    </>
                  ) : (
                    'Join'
                  )}
                </Button>
              </div>
              {/* Spectate toggle */}
              <div className="flex items-center gap-2.5 justify-center">
                <label htmlFor="spectate-toggle" className="text-sm text-muted-foreground">
                  Spectate
                </label>
                <button
                  id="spectate-toggle"
                  role="switch"
                  aria-checked={isSpectate}
                  onClick={() => setIsSpectate(!isSpectate)}
                  className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    isSpectate ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isSpectate ? 'translate-x-[22px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>
              {/* The Join button is disabled until the code is complete, which
                  on its own reads as a dead button. Say what it's waiting for. */}
              {gameCode.length > 0 && gameCode.length < 4 && (
                <p className="text-xs text-muted-foreground text-center">
                  Game codes are 4 characters — {4 - gameCode.length} to go.
                </p>
              )}
              {isSpectate && (
                <p className="text-xs text-muted-foreground text-center">
                  Spectating — you&apos;ll watch this game, not play.
                </p>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          {/* Open Games */}
          {connError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-destructive mb-1">Could not connect to game server</p>
              <p className="text-xs text-muted-foreground">{connError}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-2">
              <h3 className="text-sm font-medium text-muted-foreground">Open Games</h3>
              <LobbyList
                selectedDeckId={selectedDeck?.id ?? null}
                selectedDeckFormat={selectedDeck?.format ?? null}
                joiningCode={isJoining ? gameCode : null}
                onJoinGame={handleJoinFromLobby}
                onWatchGame={handleWatchFromLobby}
              />
            </div>
          )}
        </SpacetimeProvider>
      )}
      {/* Username modal — shown when user tries to play without a username set */}
      {showUsernameModal && (
        <UsernameModal
          onSuccess={handleUsernameSet}
          onClose={handleUsernameClosed}
        />
      )}
    </div>
  );
}
