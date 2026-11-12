export default function GoldfishLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* The game area fades in from opacity 0 (.gf-area-enter). Without the
          game color behind it, the site background shows through for that
          moment: Jayden's tinted splash, or white in light mode. */}
      <div style={{ background: 'var(--gf-bg-dark)' }}>{children}</div>
      {/* Keeps white on green in dark mode; see .dark:has([data-game-surface]) in globals.css. */}
      <span hidden data-game-surface />
    </>
  );
}
