"use client";

import { useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { decklistPdfDownloadUrl } from "@/app/decklist/card-search/utils/pdfDownloadUrl";
import { requestSubmissionPdf, type SubmissionPdfRequest } from "@/lib/tournament/submissionPdf";

interface Props {
  /** The list and its labels, read when the button is pressed; null when there is nothing to make a PDF of. */
  load: () => Promise<SubmissionPdfRequest | null> | SubmissionPdfRequest | null;
  /** Names the downloaded file. */
  fileName: string;
  /** Both states share it, so the button does not change shape when the PDF is ready. */
  className: string;
}

/**
 * Makes the deck check PDF of a submitted list. The press makes it; the button then becomes the download link,
 * because a download started after the wait would be stopped as a pop-up on a phone.
 */
export default function SubmissionPdfButton({ load, fileName, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const make = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = await load();
      if (!request || request.cards.length === 0) throw new Error("There is no decklist to make a PDF of.");
      setUrl(await requestSubmissionPdf(request));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't make the PDF. Try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      {url ? (
        <a href={decklistPdfDownloadUrl(url, fileName)} target="_blank" rel="noopener noreferrer" className={className}>
          <FileDown className="h-4 w-4" aria-hidden />
          Download PDF
        </a>
      ) : (
        <button type="button" onClick={() => void make()} disabled={busy} className={className}>
          <FileDown className="h-4 w-4" aria-hidden />
          {busy ? "Making PDF…" : "Deck check PDF"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
    </>
  );
}
