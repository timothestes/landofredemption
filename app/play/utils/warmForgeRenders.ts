// Multiplayer only (spec Unit 6). The image preloader gives up on a URL for good after two
// retries, so a new set's first game could leave card backs on the board while the server
// renders cold. Fetching this player's own deck's rendered cards as soon as the deck loads gets
// them rendered, cached in Blob, and cached by this browser (immutable responses) before the
// preloader asks. Fire-and-forget: a failure here only means the preloader does the work.
export function warmForgeRenders(urls: string[], concurrency = 4): void {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        await res.arrayBuffer(); // read to the end so the browser keeps the response
      } catch {
        // ignored: the preloader retries on its own
      }
    }
  };
  for (let i = 0; i < Math.min(concurrency, urls.length); i++) void worker();
}
