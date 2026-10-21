'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { writeJoinGameParams, type BracketGameParams } from '../../../lib/gameParams';

export function JoinBracketGameClient(props: {
  code: string;
  deckBId: string;
  deckBName: string;
  displayName: string;
  supabaseUserId: string;
  format: string;
  bracket: BracketGameParams;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);

  const join = () => {
    if (joining) return;
    setJoining(true);
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
    <Button size="lg" className="mt-6 min-h-11" onClick={join} disabled={joining}>
      Join game
    </Button>
  );
}
