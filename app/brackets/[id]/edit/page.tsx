import { notFound, redirect } from 'next/navigation';
import TopNav from '@/components/top-nav';
import { createClient } from '@/utils/supabase/server';
import { canEditBracket } from '@/lib/bracket';
import { loadBracketAction } from '../../actions';
import { loadDraftDecks } from '../../lib/loadDraftDecks';
import { NewBracketClient } from '../../new/NewBracketClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Edit Gauntlet',
  description: 'Change the decks, format or series of a bracket before any result is recorded',
};

// The setup screen again, pre-filled. Only the owner may open it, and only
// while no game has a result; everyone else lands on the bracket.
export default async function EditBracketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?redirectTo=${encodeURIComponent(`/brackets/${id}/edit`)}`);

  const res = await loadBracketAction(id);
  if (res.ok === false) notFound();
  const { isOwner, bracket, entries, games } = res.data;
  if (!isOwner || !canEditBracket(games)) redirect(`/brackets/${id}`);

  const ids = [...entries].sort((a, b) => a.seed - b.seed).flatMap(e => (e.deckId ? [e.deckId] : []));
  const { decks, missing } = await loadDraftDecks(supabase, user.id, ids);

  return (
    <>
      <TopNav />
      <NewBracketClient
        editing={{ id: bracket.id, format: bracket.format, bestOf: bracket.bestOf }}
        initialDecks={decks}
        missingCount={missing + (entries.length - ids.length)}
        defaultName={bracket.name}
      />
    </>
  );
}
