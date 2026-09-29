"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "flowbite-react";
import ToastNotification from "../../../components/ui/toast-notification";
import DeckSourcePicker from "./DeckSourcePicker";
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

export default function GenerateDeckList() {
  const [decklist, setDecklist] = useState("");
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
  const [loadedDeckId, setLoadedDeckId] = useState<string | null>(null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate decklist");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateScreenshot = async () => {
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

  return (
    <div className="flex-1 w-full flex flex-col gap-6 max-w-4xl mx-auto p-4">
      <div className="w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-2">Decklist Generator</h1>
        <p className="text-muted-foreground mb-6">
          Generate a formatted PDF for tournament play or create a visual screenshot of your deck
        </p>

        {/* Tab Navigation */}
        <div className="flex space-x-1 rounded-lg bg-muted p-1 mb-6">
          <button
            onClick={() => setActiveTab('pdf')}
            className={`flex-1 rounded-md py-2 px-4 text-sm font-medium transition-colors ${
              activeTab === 'pdf'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            📄 Tournament PDF
          </button>
          <button
            onClick={() => setActiveTab('screenshot')}
            className={`flex-1 rounded-md py-2 px-4 text-sm font-medium transition-colors ${
              activeTab === 'screenshot'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            📸 Visual Screenshot
          </button>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'pdf' ? (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xl font-semibold">Generate Tournament PDF</h3>
              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                Official Format
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Creates a properly formatted PDF suitable for tournament deck checks with player information and card alignments.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Player Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Player Name (optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-3 border rounded-lg bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
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
                    className="w-full p-3 border rounded-lg bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                    placeholder="Tournament or event name"
                    maxLength={100}
                  />
                </div>
              </div>

              {/* Deck Configuration */}
              <div className="space-y-4">
                <div className="max-w-xs">
                  <label className="block text-sm font-medium mb-2">
                    Deck Type
                  </label>
                  <select
                    value={deckType}
                    onChange={(e) => setDeckType(e.target.value)}
                    className="w-full p-3 border rounded-lg bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
                  >
                    <option value="type_1">Type 1</option>
                    <option value="type_2">Type 2</option>
                    <option value="paragon">Paragon</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Options</label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input type="checkbox" checked={showAlignment} onChange={(e) => setShowAlignment(e.target.checked)} className="rounded border-border text-primary bg-transparent" />
                      Show card alignments
                    </label>
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
              <DeckSourcePicker
                value={decklist}
                onChange={(val) => {
                  setDecklist(val);
                  if (loadedDeckName) setLoadedDeckName(null);
                }}
                onDeckSelected={handleDeckSelected}
                loadedDeckName={loadedDeckName}
                onClearLoaded={() => setLoadedDeckName(null)}
                textareaClassName="focus:ring-2 focus:ring-ring focus:border-transparent"
              />

              <Button
                type="submit"
                disabled={loading || !decklist.trim()}
                outline
                gradientDuoTone="greenToBlue"
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating PDF...
                  </>
                ) : (
                  "Generate Tournament PDF"
                )}
              </Button>
            </form>
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xl font-semibold">Generate Visual Screenshot</h3>
              <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-1 rounded-full">
                Visual Format
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Creates a visual screenshot of your deck list. No player information required - just your decklist!
            </p>

            <div className="space-y-6">
              {/* Screenshot Configuration */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Deck Type
                    </label>
                    <select
                      value={deckType}
                      onChange={(e) => setDeckType(e.target.value)}
                      className="w-full p-3 border rounded-lg bg-background focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="type_1">Type 1</option>
                      <option value="type_2">Type 2</option>
                      <option value="paragon">Paragon</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Card Columns
                    </label>
                    <select
                      value={nCardColumns}
                      onChange={(e) => setNCardColumns(parseInt(e.target.value))}
                      className="w-full p-3 border rounded-lg bg-background focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value={6}>6 columns</option>
                      <option value={8}>8 columns</option>
                      <option value={10}>10 columns</option>
                      <option value={12}>12 columns</option>
                      <option value={15}>15 columns</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Options</label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
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
              <DeckSourcePicker
                value={decklist}
                onChange={(val) => {
                  setDecklist(val);
                  if (loadedDeckName) setLoadedDeckName(null);
                }}
                onDeckSelected={handleDeckSelected}
                loadedDeckName={loadedDeckName}
                onClearLoaded={() => setLoadedDeckName(null)}
                textareaClassName="focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />

              <Button
                type="button"
                onClick={handleGenerateScreenshot}
                disabled={screenshotLoading || !decklist.trim()}
                outline
                gradientDuoTone="purpleToBlue"
                className="w-full"
                size="lg"
              >
                {screenshotLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating Screenshot...
                  </>
                ) : (
                  "Generate Deck Screenshot"
                )}
              </Button>
            </div>
          </div>
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
                onClick={() => window.open(decklistPdfDownloadUrl(success.url, loadedDeckName), '_blank')}
                gradientDuoTone="greenToBlue"
                size="lg"
                className="font-semibold"
              >
                📄 Download PDF
              </Button>
            </div>
          </div>
        )}

        {screenshotSuccess && (
          <div className="mt-6" ref={screenshotSuccessRef}>
            <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-900 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-blue-700 dark:text-blue-400">
                    Screenshot Generated Successfully!
                  </h3>
                  <p className="text-sm text-blue-600 dark:text-blue-300">
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
                  📸 View Screenshot
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
