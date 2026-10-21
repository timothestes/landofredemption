import { GameClient } from './client';

interface Props {
  params: Promise<{ code: string }>;
}

export default async function GamePage({ params }: Props) {
  const { code } = await params;
  return <GameClient key={code} code={code} />;
}
