import Link from 'next/link';
import TopNav from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import { loadDraftDecks } from '../lib/loadDraftDecks';
import { NewBracketClient } from './NewBracketClient';

export const metadata = {
  title: 'New Gauntlet',
  description: 'Pit your decks against each other in a single-elimination bracket',
};

export default async function NewBracketPage({ searchParams }: { searchParams: Promise<{ decks?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const returnPath = params.decks ? `/brackets/new?decks=${encodeURIComponent(params.decks)}` : '/brackets/new';
    return (
      <>
        <TopNav />
        <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
          <h1 className="mb-3 font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">New gauntlet</h1>
          <p className="mb-6 text-muted-foreground">Sign in to run a gauntlet of your decks.</p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
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

  const ids = (params.decks ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const { decks: initialDecks, missing } = await loadDraftDecks(supabase, user.id, ids);

  return (
    <>
      <TopNav />
      <NewBracketClient
        initialDecks={initialDecks}
        missingCount={missing}
        defaultName={`Gauntlet · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
      />
    </>
  );
}
