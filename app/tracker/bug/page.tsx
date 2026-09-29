export default function BugPage() {
  return (
    <div className="flex min-h-screen bg-50 justify-center mx-auto px-6">
      <div className="flex flex-col items-start justify-start flex-grow text-left p-0 space-y-4">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight">Report a Bug</h1>
        <p className="max-w-lg text-lg text-700 leading-relaxed">
          Found a bug? Let us know so we can fix it! You can send a screenshot
          to BaboonyTim on the{" "}
          <a
            href="https://discord.com/invite/jREJdTysPp"
            className="text-primary underline font-medium hover:text-primary/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            Redemption Discord
          </a>{" "}
          or file an issue on Land of Redemption's GitHub{" "}
          <a
            href="https://github.com/timothestes/landofredemption/issues"
            className="text-primary underline font-medium hover:text-primary/80"
            target="_blank"
            rel="noopener noreferrer"
          >
            here
          </a>
          .
        </p>
        <div className="flex flex-row flex-wrap gap-6 items-start mt-4">
          <a
            href="https://discord.com/invite/jREJdTysPp"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg shadow-lg hover:bg-primary/90"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join Redemption Discord
          </a>
          <a
            href="https://github.com/timothestes/landofredemption/issues"
            className="px-6 py-3 bg-red-800 text-white rounded-lg shadow-lg hover:bg-red-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            File an Issue on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
