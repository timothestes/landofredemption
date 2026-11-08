export default function GoldfishLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* Keeps white on green in dark mode; see .dark:has([data-game-surface]) in globals.css. */}
      <span hidden data-game-surface />
    </>
  );
}
