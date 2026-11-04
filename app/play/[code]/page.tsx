import type { Metadata } from 'next';
import { GameClient } from './client';

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Game ${code}` };
}

export default async function GamePage({ params }: Props) {
  const { code } = await params;
  return <GameClient key={code} code={code} />;
}
