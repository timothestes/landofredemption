'use client';

import { useEffect, useRef, useState } from 'react';
import { turnedSize, type Turn } from '../lib/titleCrop';
import type { DeckPhoto } from '../types';

/** Decode a photo once into a canvas already turned the way the scan read it, so its boxes apply directly. */
async function decodeTurned(url: string, turn: Turn): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const { w, h } = turnedSize({ w: bitmap.width, h: bitmap.height }, turn);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.translate(w / 2, h / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * One turned canvas per read photo still in memory, keyed by photo id. Row strips and the photo viewer are cut
 * from these; a photo with no thumb (after a reload) or one that will not decode is simply absent.
 */
export function useTurnedPhotos(thumbs: Map<string, string>, photos: DeckPhoto[]): Map<string, HTMLCanvasElement> {
  const [canvases, setCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map());
  // photoId → the object URL its decode was started from.
  const started = useRef(new Map<string, string>());

  useEffect(() => {
    const gone: string[] = [];
    for (const [id, url] of started.current) {
      const p = photos.find(x => x.photoId === id);
      // A retried photo may come back turned differently: decode it again when it is done.
      if (!p || p.status !== 'done' || thumbs.get(id) !== url) gone.push(id);
    }
    if (gone.length > 0) {
      for (const id of gone) started.current.delete(id);
      setCanvases(m => {
        const next = new Map(m);
        for (const id of gone) next.delete(id);
        return next;
      });
    }
    for (const p of photos) {
      const url = thumbs.get(p.photoId);
      if (p.status !== 'done' || !url || started.current.has(p.photoId)) continue;
      started.current.set(p.photoId, url);
      decodeTurned(url, p.rotation ?? 0).then(
        canvas => {
          if (started.current.get(p.photoId) !== url) return;
          setCanvases(m => new Map(m).set(p.photoId, canvas));
        },
        // No strips for this photo: the rows still read on their own.
        () => {},
      );
    }
  }, [thumbs, photos]);

  return canvases;
}
