"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "flowbite-react";
import { Camera, FileText } from "lucide-react";
import ToastNotification from "../../../components/ui/toast-notification";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DeckSourcePicker from "./DeckSourcePicker";
import NewFeatureCallout, { markPhotoCalloutDone } from "./NewFeatureCallout";
import PhotoSource from "./PhotoSource";
import { deckTypeFromMain, effectiveDeck, outcomesSignature, type Source } from "./decklistText";
import { recordScanOutcomesAction } from "../actions";
import { DECK_COPY, fill } from "../scan/copy";
import { buildDeckText } from "../scan/lib/deckText";
import { deckOutcomes, totals, type DeckOutcome } from "../scan/lib/handoff";
import type { DeckTrayState } from "../scan/types";
import { decklistPdfDownloadUrl } from "../card-search/utils/pdfDownloadUrl";

async function checkLegality(decklist: string, deckType: string, deckId?: string | null): Promise<boolean | null> {
  // The PDF/image generator omits the legal/illegal seal entirely (renders `?`)
  // when is_legal is missing, so log every reason this fallback returns null.
  try {
    const body: Record<string, unknown> = deckId
      ? { deckId }
      : { decklist, decklist_type: deckType };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch("/api/deckcheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[generate-legality] /api/deckcheck returned non-ok — output will render without legality seal", { deckId, status: res.status, body: text.slice(0, 500) });
      return null;
    }
    const result = await res.json();
    if (result?.valid == null) {
      console.warn("[generate-legality] /api/deckcheck returned ok but `valid` is missing", { deckId, result });
    }
    return result.valid ?? null;
  } catch (err) {
    console.warn("[generate-legality] /api/deckcheck threw — output will render without legality seal", { deckId, err });
    return null;
  }
}

/** What the photo source's tray comes to, kept apart from the typed decklist. */
interface PhotoDeck {
  /** Two-column text for the generators: resolved rows and Lost Soul picks. */
  text: string;
  /** Cards that will be in the PDF. */
  cards: number;
  /** Unresolved rows and Lost Souls not picked yet: not in the PDF. */
  leftOut: number;
  /** A photo is queued or being read. */
  reading: boolean;
  outcomes: Record<string, DeckOutcome[]>;
}

const NO_PHOTO_DECK: PhotoDeck = { text: "", cards: 0, leftOut: 0, reading: false, outcomes: {} };

export default function GenerateDeckList() {
  const [typedDecklist, setDecklist] = useState("");
  const [deckType, setDeckType] = useState("type_1");
  const [name, setName] = useState("");
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ url: string; message: string } | null>(null);
  const [screenshotSuccess, setScreenshotSuccess] = useState<{ url: string; message: string } | null>(null);
  const [showAlignment, setShowAlignment] = useState(false);
  const [nCardColumns, setNCardColumns] = useState(10);
  const [activeTab, setActiveTab] = useState<'pdf' | 'screenshot'>('pdf');
  const [mCount, setMCount] = useState(false);
  const [aodCount, setAodCount] = useState(false);
  const [loadedDeckName, setLoadedDeckName] = useState<string | null>(null);
  const [typedDeckId, setLoadedDeckId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("paste");
  const [photoMounted, setPhotoMounted] = useState(false);
  const [photo, setPhoto] = useState<PhotoDeck>(NO_PHOTO_DECK);
  const [confirm, setConfirm] = useState<"pdf" | "image" | null>(null);
  // The player's own choice of Deck Type wins over the next photo's read.
  const deckTypeTouched = useRef(false);
  const photosDone = useRef(0);
  const photoReports = useRef(0);
  const lastRecorded = useRef<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const screenshotSuccessRef = useRef<HTMLDivElement>(null);

  const handleDeckSelected = useCallback((text: string, deckName: string, deckTypeValue: string | null, deckId?: string) => {
    setDecklist(text);
    setLoadedDeckName(deckName);
    setLoadedDeckId(deckId || null);
    if (deckTypeValue) {
      setDeckType(deckTypeValue);
    }
  }, []);

  const chooseSource = useCallback((next: Source) => {
    setSource(next);
    if (next === "photo") setPhotoMounted(true);
  }, []);

  // ?source=photo opens the photo source (the callout, the reader's own page and What's New link here).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("source") === "photo") chooseSource("photo");
  }, [chooseSource]);

  const handlePhotoChange = useCallback((state: DeckTrayState) => {
    const t = totals(state);
    setPhoto({
      text: buildDeckText(state, { columns: 2 }),
      cards: t.main + t.reserve,
      leftOut: t.leftOut + t.lostSoulsToPick,
      reading: state.photos.some((p) => p.status === "queued" || p.status === "reading"),
      outcomes: deckOutcomes(state),
    });
    const done = state.photos.filter((p) => p.status === "done").length;
    // The first report is the tray as it was restored, not a read made on this page.
    const restored = photoReports.current++ === 0;
    if (done > photosDone.current) {
      if (!deckTypeTouched.current) setDeckType(deckTypeFromMain(t.main));
      deckTypeTouched.current = false;
      if (!restored) markPhotoCalloutDone();
    }
    photosDone.current = done;
  }, []);

  const chooseDeckType = (value: string) => {
    deckTypeTouched.current = true;
    setDeckType(value);
  };

  // Auto-scroll to success message when it appears
  useEffect(() => {
    if (success && successRef.current) {
      successRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }, [success]);

  // Auto-scroll to screenshot success message when it appears
  useEffect(() => {
    if (screenshotSuccess && screenshotSuccessRef.current) {
      screenshotSuccessRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }, [screenshotSuccess]);

  const validateForm = (list: string, name?: string, event?: string): { valid: boolean; message?: string } => {
    if (!list.trim()) {
      return { valid: false, message: "Decklist cannot be empty" };
    }

    // Validate lengths if provided
    if (name && name.length > 50) {
      return { valid: false, message: "Player name must be 50 characters or less" };
    }

    if (event && event.length > 100) {
      return { valid: false, message: "Event name must be 100 characters or less" };
    }

    // Check reasonable length (e.g., max 10000 characters)
    if (list.length > 10000) {
      return { valid: false, message: "Decklist is too long" };
    }

    const lines = list.split("\n").filter(line => line.trim());
    
    // Check each non-empty line format
    for (const line of lines) {
      // Skip empty lines and "Reserve:" or "Tokens:" markers
      if (!line.trim() || line.trim() === "Reserve:" || line.trim() === "Tokens:") continue;
      
      // Each line should start with a number followed by whitespace and a card name
      const match = line.match(/^\d+[\t ]+.+/);
      if (!match) {
        return { 
          valid: false, 
          message: "Each line must start with a number, followed by spaces or a tab, then a card name" 
        };
      }
    }

    return { valid: true };
  };

  // A PDF or image made from a photo counts as that tray's hand-off: record what the player kept and changed, once per tray.
  const recordPhotoOutcomes = () => {
    const signature = outcomesSignature(photo.outcomes);
    if (signature === lastRecorded.current || Object.keys(photo.outcomes).length === 0) return;
    lastRecorded.current = signature;
    void recordScanOutcomesAction(photo.outcomes).catch(() => {
      lastRecorded.current = null;
    });
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);

    // The photo source sends its own text and never a saved deck's id; typed text loses the builder's extra columns.
    const { decklist, deckId: loadedDeckId } = effectiveDeck({ source, typed: typedDecklist, photoText: photo.text, loadedDeckId: typedDeckId });
    const validation = validateForm(decklist, name, event);
    if (!validation.valid) {
      setError(validation.message || "Invalid form data");
      return;
    }

    setLoading(true);
    try {
      const isLegal = await checkLegality(decklist, deckType, loadedDeckId);

      const response = await fetch("/api/v1/generate-decklist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          name,
          event,
          show_alignment: showAlignment,
          m_count: mCount,
          aod_count: aodCount,
          ...(loadedDeckId ? { deck_id: loadedDeckId } : {}),
          ...(isLegal != null ? { is_legal: isLegal } : {}),
        }),
      });

      const data = await response.json();

      if (data.status === "error") {
        throw new Error(data.message);
      }

      setSuccess({
        url: data.data.downloadUrl,
        message: data.message,
      });
      if (source === "photo") recordPhotoOutcomes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate decklist");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateScreenshot = async () => {
    const { decklist, deckId: loadedDeckId } = effectiveDeck({ source, typed: typedDecklist, photoText: photo.text, loadedDeckId: typedDeckId });
    const validation = validateForm(decklist);
    if (!validation.valid) {
      setError(validation.message || "Invalid decklist format");
      return;
    }

    setError(null);
    setScreenshotSuccess(null);
    setScreenshotLoading(true);

    try {
      const isLegal = await checkLegality(decklist, deckType, loadedDeckId);

      const response = await fetch("/api/v1/generate-decklist-image", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          decklist,
          decklist_type: deckType,
          n_card_columns: nCardColumns,
          m_count: mCount,
          aod_count: aodCount,
          ...(loadedDeckId ? { deck_id: loadedDeckId } : {}),
          ...(isLegal != null ? { is_legal: isLegal } : {}),
        }),
      });

      const result = await response.json();

      if (result.status === 'success') {
        setScreenshotSuccess({
          url: result.data.downloadUrl,
          message: "Screenshot generated successfully",
        });
        if (source === "photo") recordPhotoOutcomes();
      } else {
        setError('Failed to generate screenshot: ' + result.message);
      }
    } catch (error) {
      console.error('Error generating screenshot:', error);
      setError('Failed to generate screenshot. Please try again.');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const pdfTab = activeTab === "pdf";
  const photoMode = source === "photo";
  // Nothing to generate from: a photo still being read would be missing from the PDF.
  const noDeck = photoMode ? photo.reading || !photo.text : !typedDecklist.trim();

  const generate = (kind: "pdf" | "image") => {
    setConfirm(null);
    void (kind === "pdf" ? handleSubmit() : handleGenerateScreenshot());
  };
  // Cards the photo could not settle are left out of the PDF: say how many before making it.
  const requestGenerate = (kind: "pdf" | "image") => {
    if (photoMode && photo.leftOut > 0) setConfirm(kind);
    else generate(kind);
  };

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-4xl mx-auto p-4">
      <div className="w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-2">Decklist Generator</h1>
        <p className="text-muted-foreground mb-6">
          Generate a formatted PDF for tournament play or create a visual screenshot of your deck
        </p>

        {!photoMode && (
          <NewFeatureCallout
            onRead={() => {
              chooseSource("photo");
              pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}

        {/* Tab Navigation */}
        <div className="flex space-x-1 rounded-lg bg-muted p-1 mb-6">
          <button
            onClick={() => setActiveTab('pdf')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-2 px-4 text-sm font-medium transition-colors ${
              activeTab === 'pdf'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Tournament PDF
          </button>
          <button
            onClick={() => setActiveTab('screenshot')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-2 px-4 text-sm font-medium transition-colors ${
              activeTab === 'screenshot'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Camera className="h-4 w-4" aria-hidden />
            Visual Screenshot
          </button>
        </div>

        {/* One panel for both tabs, so the decklist source (and a photo being read) survives a tab change */}
        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-xl font-semibold">{pdfTab ? "Generate Tournament PDF" : "Generate Visual Screenshot"}</h3>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
              {pdfTab ? "Official Format" : "Visual Format"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            {pdfTab
              ? "Creates a properly formatted PDF suitable for tournament deck checks with player information and card alignments."
              : "Creates a visual screenshot of your deck list. No player information required - just your decklist!"}
          </p>

          <div className="space-y-6">
            {/* Player Information */}
            {pdfTab && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Player Name (optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-3 border rounded-lg bg-background focus:outline-none focus:border-ring"
                    placeholder="Enter your name"
                    maxLength={50}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Event Name (optional)
                  </label>
                  <input
                    type="text"
                    value={event}
                    onChange={(e) => setEvent(e.target.value)}
                    className="w-full p-3 border rounded-lg bg-background focus:outline-none focus:border-ring"
                    placeholder="Tournament or event name"
                    maxLength={100}
                  />
                </div>
              </div>
            )}

            {/* Deck Configuration */}
            <div className="space-y-4">
              <div className={pdfTab ? "max-w-xs" : "grid grid-cols-2 gap-4 max-w-md"}>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Deck Type
                  </label>
                  <select
                    value={deckType}
                    onChange={(e) => chooseDeckType(e.target.value)}
                    className="w-full p-3 border rounded-lg bg-background focus:outline-none focus:border-ring"
                  >
                    <option value="type_1">Type 1</option>
                    <option value="type_2">Type 2</option>
                    <option value="paragon">Paragon</option>
                  </select>
                </div>
                {!pdfTab && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Card Columns
                    </label>
                    <select
                      value={nCardColumns}
                      onChange={(e) => setNCardColumns(parseInt(e.target.value))}
                      className="w-full p-3 border rounded-lg bg-background focus:outline-none focus:border-ring"
                    >
                      <option value={6}>6 columns</option>
                      <option value={8}>8 columns</option>
                      <option value={10}>10 columns</option>
                      <option value={12}>12 columns</option>
                      <option value={15}>15 columns</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Options</label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {pdfTab && (
                    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={showAlignment} onChange={(e) => setShowAlignment(e.target.checked)} className="rounded border-border text-primary bg-transparent" />
                      Show card alignments
                    </label>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none" title="Average number of unique brigades when randomly drawing 8 non-lost soul cards from a deck">
                    <input type="checkbox" checked={mCount} onChange={(e) => setMCount(e.target.checked)} className="rounded border-border text-primary bg-transparent" />
                    Matthew count
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none" title="Average number of Daniel cards in the top 9 cards of a randomly shuffled deck">
                    <input type="checkbox" checked={aodCount} onChange={(e) => setAodCount(e.target.checked)} className="rounded border-border text-primary bg-transparent" />
                    AoD count
                  </label>
                </div>
              </div>
            </div>

            {/* Decklist Input */}
            <div ref={pickerRef} className="scroll-mt-24">
              <DeckSourcePicker
                value={typedDecklist}
                onChange={(val) => {
                  setDecklist(val);
                  if (loadedDeckName) setLoadedDeckName(null);
                }}
                onDeckSelected={handleDeckSelected}
                loadedDeckName={loadedDeckName}
                onClearLoaded={() => setLoadedDeckName(null)}
                textareaClassName="focus:outline-none focus:border-ring"
                source={source}
                onSourceChange={chooseSource}
                photoMounted={photoMounted}
                lockSource={photo.reading}
                photoSlot={(userId) => (
                  <PhotoSource userId={userId} active={photoMode} onChange={handlePhotoChange} />
                )}
              />
            </div>

            {photoMode && photo.leftOut > 0 && (
              <p className="text-sm text-amber-600 dark:text-amber-400">{fill(DECK_COPY.leftOut, { n: photo.leftOut })}</p>
            )}

            <Button
              type="button"
              onClick={() => requestGenerate(pdfTab ? "pdf" : "image")}
              disabled={(pdfTab ? loading : screenshotLoading) || noDeck}
              outline
              gradientDuoTone={pdfTab ? "greenToBlue" : "purpleToBlue"}
              className="w-full"
              size="lg"
            >
              {(pdfTab ? loading : screenshotLoading) ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {pdfTab ? "Generating PDF..." : "Generating Screenshot..."}
                </>
              ) : photoMode && photo.reading ? (
                DECK_COPY.reading
              ) : pdfTab ? (
                "Generate Tournament PDF"
              ) : (
                "Generate Deck Screenshot"
              )}
            </Button>
          </div>
        </div>

        {confirm && (
          <Dialog open onOpenChange={(o) => !o && setConfirm(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{fill(DECK_COPY.generateConfirm, { n: photo.cards })}</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <p className="text-sm text-muted-foreground">{fill(DECK_COPY.leftOut, { n: photo.leftOut })}</p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirm(null)}
                    className="min-h-11 rounded-lg px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => generate(confirm)}
                    className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none"
                  >
                    Generate
                  </button>
                </div>
              </DialogBody>
            </DialogContent>
          </Dialog>
        )}

        {/* Error Display */}
        {error && (
          <div className="mt-6">
            <ToastNotification
              message={error}
              type="error"
              show={!!error}
              onClose={() => setError(null)}
            />
          </div>
        )}

        {/* Success Messages */}
        {success && (
          <div className="mt-6" ref={successRef}>
            <div className="p-6 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-900 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-700 dark:text-green-400">
                    PDF Generated Successfully!
                  </h3>
                  <p className="text-sm text-green-600 dark:text-green-300">
                    Your tournament deck check PDF is ready for download
                  </p>
                </div>
              </div>
              <Button
                onClick={() => window.open(decklistPdfDownloadUrl(success.url, photoMode ? null : loadedDeckName), '_blank')}
                gradientDuoTone="greenToBlue"
                size="lg"
                className="font-semibold"
              >
                <FileText className="mr-2 h-4 w-4 self-center" aria-hidden />
                Download PDF
              </Button>
            </div>
          </div>
        )}

        {screenshotSuccess && (
          <div className="mt-6" ref={screenshotSuccessRef}>
            <div className="rounded-md bg-primary/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Screenshot Generated Successfully!
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Your deck screenshot is ready to view
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => window.open(screenshotSuccess.url, '_blank')}
                  gradientDuoTone="purpleToBlue"
                  size="lg"
                  className="font-semibold"
                >
                  <Camera className="mr-2 h-4 w-4 self-center" aria-hidden />
                  View Screenshot
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
