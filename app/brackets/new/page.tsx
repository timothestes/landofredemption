import Link from 'next/link';
import TopNav from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import type { DraftDeck } from '../lib/draft';
import { NewBracketClient } from './NewBracketClient';

export const metadata = {
  title: 'New Deck Bracket',
  description: 'Build a single-elimination bracket of your decks',
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
          <h1 className="mb-3 font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">New deck bracket</h1>
          <p className="mb-6 text-muted-foreground">Sign in to build a bracket of your decks.</p>
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

  const ids = Array.from(new Set((params.decks ?? '').split(',').map(s => s.trim()).filter(Boolean))).slice(0, 16);
  let initialDecks: DraftDeck[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('decks')
      .select('id, name, format, preview_card_1, preview_card_2, paragon, user_id, is_public')
      .in('id', ids);
    const usable = new Map(
      (data ?? [])
        .filter(d => d.user_id === user.id || d.is_public)
        .map(d => [d.id as string, d]),
    );
    initialDecks = ids.flatMap(id => {
      const d = usable.get(id);
      return d
        ? [{ id: d.id, name: d.name, format: d.format, preview_card_1: d.preview_card_1, preview_card_2: d.preview_card_2, paragon: d.paragon }]
        : [];
    });
  }

  return (
    <>
      <TopNav />
      <NewBracketClient
        initialDecks={initialDecks}
        missingCount={ids.length - initialDecks.length}
        defaultName={`Deck Bracket · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
      />
    </>
  );
}
