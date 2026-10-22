import Link from 'next/link';
import { HiPlus } from 'react-icons/hi';
import TopNav from '@/components/top-nav';
import { Button } from '@/components/ui/button';
import { createClient } from '@/utils/supabase/server';
import MyBracketsList from './MyBracketsList';

export const metadata = {
  title: 'Gauntlets',
  description: 'Pit your decks against each other in a single-elimination bracket',
};

export default async function BracketsIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <TopNav />
        <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
          <h1 className="mb-3 font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">Gauntlets</h1>
          <p className="mb-6 text-muted-foreground">Sign in to run a gauntlet of your decks.</p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href={`/sign-in?redirectTo=${encodeURIComponent('/brackets')}`}>Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-up">Create an account</Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">Gauntlets</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Seat your own decks in a single-elimination bracket and play every match yourself.
            </p>
          </div>
          <Button asChild className="flex items-center gap-2">
            <Link href="/brackets/new">
              <HiPlus className="w-4 h-4" />
              <span>New gauntlet</span>
            </Link>
          </Button>
        </div>
        <MyBracketsList />
      </div>
    </>
  );
}
