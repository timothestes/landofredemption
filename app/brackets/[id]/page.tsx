import { cache } from 'react';
import { notFound } from 'next/navigation';
import TopNav from '@/components/top-nav';
import { createClient } from '@/utils/supabase/server';
import { loadBracketAction } from '../actions';
import { BracketClient } from './BracketClient';

export const dynamic = 'force-dynamic';

// generateMetadata and the page share one load per request.
const load = cache(loadBracketAction);

type Params = Promise<{ id: string }>;
type Search = Promise<{ decided?: string; record?: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const res = await load(id);
  return { title: res.ok ? res.data.bracket.name : 'Bracket not found' };
}

export default async function BracketPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const res = await load(id);
  if (res.ok === false) notFound();
  const { isOwner, ...data } = res.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let viewer: { id: string; displayName: string } | null = null;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle();
    viewer = {
      id: user.id,
      displayName: profile?.username || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Player',
    };
  }

  return (
    <>
      <TopNav />
      <BracketClient
        data={data}
        isOwner={isOwner}
        viewer={viewer}
        searchParams={{ decided: search.decided ?? null, record: search.record ?? null }}
      />
    </>
  );
}
