import Link from 'next/link';

export const metadata = {
  title: 'Practice Mode',
  description: 'Practice your Redemption deck in goldfish mode',
};

export default function GoldfishEntryPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d0905] px-4">
      <div
        className="w-full max-w-lg rounded-lg border p-8"
        style={{
          background: '#1e1610',
          borderColor: 'var(--gf-border)',
        }}
      >
        <h1
          className="text-2xl font-bold mb-2 text-center font-cinzel"
          style={{ color: 'var(--gf-text-bright)' }}
        >
          Practice Mode
        </h1>
        <p className="text-center mb-6" style={{ color: 'var(--gf-text)' }}>
          Draw hands and play out turns against no opponent — the fastest way to
          test whether a deck actually does what you built it to do.
        </p>

        <div className="flex flex-col gap-4">
          {/* Your own decks were unreachable from here: the only button led to
              the community list, which never contains your private decks. */}
          <Link
            href="/decklist/my-decks"
            className="block text-center py-3 px-4 rounded font-medium transition-colors"
            style={{
              background: 'var(--gf-accent, #c4955a)',
              color: '#1a1206',
              border: '1px solid var(--gf-accent, #c4955a)',
            }}
          >
            Practice One of My Decks
          </Link>

          <Link
            href="/decklist/community"
            className="block text-center py-3 px-4 rounded font-medium transition-colors"
            style={{
              background: 'var(--gf-bg)',
              color: 'var(--gf-text-bright)',
              border: '1px solid var(--gf-border)',
            }}
          >
            Browse Community Decks
          </Link>

          <div className="text-center text-sm" style={{ color: 'var(--gf-text-dim)' }}>
            Open any deck, then use the play button to practice with it.
          </div>
        </div>
      </div>
    </div>
  );
}
