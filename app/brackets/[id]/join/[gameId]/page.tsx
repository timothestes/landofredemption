import Link from 'next/link';
import TopNav from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import { roundNames } from '@/lib/bracket';
import { loadBracketAction } from '../../../actions';
import { DeckThumb } from '../../../components/DeckThumb';
import { stdbFormatFor, type BracketGameParams } from '../../../lib/gameParams';
import { JoinBracketGameClient } from './JoinBracketGameClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Join a bracket game' };

type Params = Promise<{ id: string; gameId: string }>;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <h1 className="mb-6 font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">Join a bracket game</h1>
        {children}
      </div>
    </>
  );
}

function Notice({ text, bracketId, linkLabel }: { text: string; bracketId?: string; linkLabel?: string }) {
  return (
    <Shell>
      <p className="text-muted-foreground">{text}</p>
      {bracketId && (
        <Button asChild variant="outline" className="mt-4 min-h-11">
          <Link href={`/brackets/${bracketId}`}>{linkLabel ?? 'Open the bracket'}</Link>
        </Button>
      )}
    </Shell>
  );
}

export default async function JoinBracketGamePage({ params }: { params: Params }) {
  const { id, gameId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const returnPath = `/brackets/${id}/join/${gameId}`;
    return (
      <Shell>
        <p className="mb-6 text-muted-foreground">Sign in to your account to join this game.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={`/sign-in?redirectTo=${encodeURIComponent(returnPath)}`}>Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-up">Create an account</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  const res = await loadBracketAction(id);
  if (res.ok === false) return <Notice text="This bracket could not be found." />;
  const { bracket, entries, matches, games, ownerId, isOwner } = res.data;

  if (isOwner) {
    return <Notice text="This is your own bracket; open it to play." bracketId={bracket.id} />;
  }

  const game = games.find(g => g.id === gameId);
  if (!game) return <Notice text="This game was cancelled." bracketId={bracket.id} />;
  if (game.winnerEntryId) return <Notice text="This game is already finished." bracketId={bracket.id} />;
  const match = matches.find(m => m.id === game.matchId);
  const entryA = entries.find(e => e.id === match?.entryAId);
  const entryB = entries.find(e => e.id === match?.entryBId);
  if (game.mode !== 'online' || !game.code || !match || !entryA || !entryB) {
    return <Notice text="This game is not open to join." bracketId={bracket.id} />;
  }
  if (!entryB.deckId) {
    return <Notice text="This deck has been deleted, so the game cannot be played." bracketId={bracket.id} />;
  }

  const [{ data: host }, { data: profile }] = await Promise.all([
    supabase.from('profiles').select('username').eq('id', ownerId).maybeSingle(),
    supabase.from('profiles').select('username').eq('id', user.id).maybeSingle(),
  ]);
  const hostName = host?.username || 'A player';
  const displayName = profile?.username || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Player';
  const roundName = roundNames(bracket.size)[match.round - 1] ?? 'bracket';

  const bracketParams: BracketGameParams = {
    gameId: game.id,
    bracketId: bracket.id,
    matchId: match.id,
    gameNumber: game.gameNumber,
    bestOf: bracket.bestOf,
    mode: 'online',
    entryAId: entryA.id,
    entryBId: entryB.id,
    deckAName: entryA.deckName,
    deckBName: entryB.deckName,
    returnTo: `/brackets/${bracket.id}`,
  };

  return (
    <Shell>
      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <DeckThumb entry={entryB} size={64} />
          <span className="text-sm text-muted-foreground">vs</span>
          <DeckThumb entry={entryA} size={64} />
        </div>
        <p className="text-base">
          {hostName} invited you to play <strong>{entryB.deckName}</strong> against{' '}
          <strong>{entryA.deckName}</strong>
          <span className="text-muted-foreground"> · Game {game.gameNumber} of the {roundName} in {bracket.name}</span>
        </p>
        <JoinBracketGameClient
          code={game.code}
          deckBId={entryB.deckId}
          deckBName={entryB.deckName}
          displayName={displayName}
          supabaseUserId={user.id}
          format={stdbFormatFor(bracket.format)}
          bracket={bracketParams}
        />
      </div>
    </Shell>
  );
}
