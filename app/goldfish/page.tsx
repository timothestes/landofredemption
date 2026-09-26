import Link from 'next/link';
import { hasStarterDecks } from '@/app/config/starterDecks';
import { loadStarterDecksAction } from '@/app/play/actions';
import { getFormatDef } from '@/lib/formats';

export const metadata = {
  title: 'Practice Mode | Land of Redemption',
  description: 'Practice your Redemption deck in goldfish mode',
};

export default async function GoldfishEntryPage() {
  // Starter decks are public, so this works signed out. Skipped entirely while
  // the config is empty, which keeps the page static in that case.
  const starterDecks = hasStarterDecks() ? await loadStarterDecksAction() : [];

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
          {starterDecks.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--gf-text-dim)' }}
              >
                Starter decks
              </h2>
              <ul
                className="divide-y rounded border overflow-hidden"
                style={{ borderColor: 'var(--gf-border-dim)' }}
              >
                {starterDecks.map((deck) => (
                  <li
                    key={deck.id}
                    className="flex items-center gap-3 px-3 py-2.5"
                    style={{ borderColor: 'var(--gf-border-dim)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium" style={{ color: 'var(--gf-text-bright)' }}>
                        {deck.name}
                      </div>
                      <div className="truncate text-xs" style={{ color: 'var(--gf-text-dim)' }}>
                        {getFormatDef(deck.format).id}
                        {deck.card_count != null && ` · ${deck.card_count} cards`}
                        {deck.blurb && ` · ${deck.blurb}`}
                      </div>
                    </div>
                    <Link
                      href={`/goldfish/${deck.id}`}
                      className="shrink-0 rounded px-3.5 py-2.5 text-sm font-medium transition-colors"
                      style={{
                        background: 'var(--gf-accent, #c4955a)',
                        color: '#1a1206',
                      }}
                    >
                      Practice
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
