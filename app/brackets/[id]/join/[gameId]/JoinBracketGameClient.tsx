'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getBracketGameHostSideAction } from '../../../actions';
import { writeJoinGameParams, type BracketGameParams } from '../../../lib/gameParams';

export function JoinBracketGameClient(props: {
  code: string;
  gameId: string;
  deckBId: string;
  deckBName: string;
  displayName: string;
  supabaseUserId: string;
  format: string;
  bracket: BracketGameParams;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [swapped, setSwapped] = useState(false);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    // The host can swap decks while this page is open; joining on a stale
    // page would seat the friend with the deck they were not shown.
    const side = await getBracketGameHostSideAction(props.gameId).catch(() => null);
    if (side && side !== (props.bracket.hostSide ?? 'a')) {
      setSwapped(true);
      setJoining(false);
      router.refresh();
      return;
    }
    writeJoinGameParams(props.code, {
      deckBId: props.deckBId,
      deckBName: props.deckBName,
      displayName: props.displayName,
      supabaseUserId: props.supabaseUserId,
      format: props.format,
      bracket: props.bracket,
    });
    router.push('/play/' + props.code);
  };

  return (
    <>
      {swapped && (
        <p role="alert" className="mt-4 text-sm font-medium">
          The host swapped decks. Check who plays what above, then join.
        </p>
      )}
      <Button size="lg" className="mt-6 min-h-11" onClick={join} disabled={joining}>
        Join game
      </Button>
    </>
  );
}
