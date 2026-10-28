'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareImage, PrepareError } from '../lib/prepareImage';
import { scanErrorView } from '../copy';
import type { TrayAction } from '../lib/trayReducer';
import type { ScanErrorBody, ScanResponse } from '../types';

const MAX_CONCURRENT = 2;
const MAX_BUSY_RETRIES = 2;
// Just past the route's maxDuration (90 s): a stalled upload becomes a Retry instead of an endless spinner.
const REQUEST_TIMEOUT_MS = 100_000;

interface Entry {
  file: File;
  blob?: Blob;
  url?: string;
  busyRetries: number;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export function useScanQueue(dispatch: React.Dispatch<TrayAction>) {
  const entries = useRef(new Map<string, Entry>());
  const waiting = useRef<string[]>([]);
  const active = useRef(0);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [online, setOnline] = useState(true);
  const pump = useRef<() => void>(() => {});
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const syncThumbs = useCallback(() => {
    const m = new Map<string, string>();
    for (const [id, e] of entries.current) if (e.url) m.set(id, e.url);
    setThumbs(m);
  }, []);

  const release = useCallback((id: string) => {
    const e = entries.current.get(id);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    if (e.url) URL.revokeObjectURL(e.url);
    entries.current.delete(id);
    waiting.current = waiting.current.filter(x => x !== id);
  }, []);

  const fail = useCallback((id: string, status: number, body: ScanErrorBody, retryAfter?: number) => {
    dispatchRef.current({ type: 'photoFailed', photoId: id, error: { status, body, retryAfter } });
  }, []);

  const run = useCallback(async (id: string) => {
    const e = entries.current.get(id);
    if (!e) return;
    e.running = true;
    active.current++;
    dispatchRef.current({ type: 'photoStarted', photoId: id, at: Date.now() });
    try {
      if (!e.blob) {
        try {
          e.blob = await prepareImage(e.file);
        } catch (err) {
          if (err instanceof PrepareError) {
            fail(id, err.kind === 'heif' ? 415 : 413, { code: err.kind });
            return;
          }
          throw err;
        }
        if (!entries.current.has(id)) return;
        e.url = URL.createObjectURL(e.blob);
        syncThumbs();
      }
      const fd = new FormData();
      fd.append('photo', e.blob, 'photo.jpg');
      let res: Response;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        res = await fetch('/api/scan', { method: 'POST', body: fd, signal: ctrl.signal });
      } catch {
        if (entries.current.has(id)) fail(id, 0, { code: ctrl.signal.aborted ? 'timeout' : 'network' });
        return;
      } finally {
        clearTimeout(timeout);
      }
      if (!entries.current.has(id)) return;
      if (res.ok) {
        dispatchRef.current({ type: 'photoDone', photoId: id, response: (await res.json()) as ScanResponse });
        return;
      }
      let body: ScanErrorBody = {};
      if ((res.headers.get('content-type') ?? '').includes('application/json')) {
        try {
          body = (await res.json()) as ScanErrorBody;
        } catch {
          /* keep empty body */
        }
      }
      const retryHeader = res.headers.get('retry-after');
      const view = scanErrorView(res.status, body, retryHeader, new Date());
      if (view.kind === 'busy' && e.busyRetries < MAX_BUSY_RETRIES) {
        e.busyRetries++;
        // Queued with the busy line until the timer re-queues it; photoStarted clears the flag.
        dispatchRef.current({ type: 'photoRetry', photoId: id, busy: true });
        e.timer = setTimeout(() => {
          e.timer = undefined;
          if (!entries.current.has(id)) return;
          waiting.current.push(id);
          pump.current();
        }, (view.autoRetryAfterSec ?? 30) * 1000);
        return;
      }
      const ra = retryHeader === null || retryHeader.trim() === '' ? undefined : Number(retryHeader);
      const retryAfter = Number.isFinite(ra) ? ra : undefined;
      fail(id, res.status, body, retryAfter);
      // Over a scan limit, every photo still waiting would upload only to be refused: hold them all
      // with the same message (each keeps its file, so Retry works once the window reopens).
      if (view.kind === 'cap_10m' || view.kind === 'cap_24h' || view.kind === 'cap_global' || view.kind === 'credit_out') {
        const held = waiting.current;
        waiting.current = [];
        for (const w of held) fail(w, res.status, body, retryAfter);
      }
    } catch {
      fail(id, 0, { code: 'internal' });
    } finally {
      e.running = false;
      active.current--;
      pump.current();
    }
  }, [fail, syncThumbs]);

  pump.current = () => {
    while (active.current < MAX_CONCURRENT && waiting.current.length > 0) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const id = waiting.current.shift()!;
      void run(id);
    }
  };

  // Leaving while a photo is uploading drops its result, though the read still counts toward the limit.
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (active.current === 0 && waiting.current.length === 0) return;
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) pump.current();
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const map = entries.current;
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      for (const id of [...map.keys()]) release(id);
    };
  }, [release]);

  const addFiles = useCallback((files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      entries.current.set(id, { file, busyRetries: 0, running: false });
      dispatchRef.current({ type: 'photoAdded', photoId: id });
      waiting.current.push(id);
    }
    pump.current();
  }, []);

  const retry = useCallback((id: string) => {
    const e = entries.current.get(id);
    // A pending busy auto-retry already owns this photo; a second upload would take another reserve slot.
    if (!e || e.running || e.timer || waiting.current.includes(id)) return;
    e.busyRetries = 0;
    dispatchRef.current({ type: 'photoRetry', photoId: id });
    waiting.current.push(id);
    pump.current();
  }, []);

  const remove = useCallback((id: string) => {
    release(id);
    syncThumbs();
    dispatchRef.current({ type: 'photoRemoved', photoId: id });
  }, [release, syncThumbs]);

  const hasFile = useCallback((id: string) => entries.current.has(id), []);

  /** Scan more: drop every photo, its object URL and any pending auto-retry. */
  const clear = useCallback(() => {
    for (const id of [...entries.current.keys()]) release(id);
    waiting.current = [];
    syncThumbs();
  }, [release, syncThumbs]);

  return { addFiles, retry, remove, clear, thumbs, online, hasFile };
}
