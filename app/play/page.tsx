import { createClient } from '@/utils/supabase/server';
import Link from 'next/link';
import TopNav from '@/components/top-nav';
import { GameLobby } from './components/GameLobby';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Play Online',
  description: 'Create or join an online game',
};

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const params = await searchParams;
    const returnPath = params.join ? `/play?join=${encodeURIComponent(params.join)}` : '/play';

    return (
      <>
        <TopNav />
        <div className="container mx-auto px-4 py-16 max-w-md text-center">
          <h1 className="text-3xl font-bold mb-3 font-cinzel jayden-gradient-text">Play Online</h1>
          <p className="text-muted-foreground mb-6">
            Sign in to your account to create or join games.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`/sign-in?redirectTo=${encodeURIComponent(returnPath)}`}>Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-up">Create an account</Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  const [{ data: decks }, { data: profile }] = await Promise.all([
    supabase
      .from('decks')
      .select('id, name, format, card_count, preview_card_1, preview_card_2, paragon, last_played_at')
      .eq('user_id', user.id)
      .order('last_played_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single(),
  ]);

  const username = profile?.username ?? null;

  return (
    <>
    <TopNav />
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <h1 className="text-3xl font-bold mb-8 font-cinzel jayden-gradient-text">Play Online</h1>
      <GameLobby
        decks={decks || []}
        userId={user.id}
        displayName={username || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Player'}
        hasUsername={!!username}
      />
    </div>
    </>
  );
}
