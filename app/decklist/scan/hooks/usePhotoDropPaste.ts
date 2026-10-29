'use client';

import { useEffect, useRef, useState } from 'react';

const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes('Files');
const images = (list: FileList | null | undefined): File[] =>
  list ? Array.from(list).filter(f => f.type.startsWith('image/')) : [];

/** Page-wide drop of image files and document paste of copied images (Discord, screenshots). */
export function usePhotoDropPaste(addFiles: (f: File[]) => void, enabled: boolean): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const add = useRef(addFiles);
  add.current = addFiles;

  useEffect(() => {
    if (!enabled) {
      setDragging(false);
      return;
    }
    // dragenter/dragleave fire for every child; a depth counter keeps the overlay from flickering.
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault(); // required for drop to fire
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault(); // else the browser navigates to the dropped file
      depth = 0;
      setDragging(false);
      const files = images(e.dataTransfer?.files);
      if (files.length > 0) add.current(files);
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const files = images(e.clipboardData?.files);
      if (files.length > 0) {
        e.preventDefault();
        add.current(files);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('paste', onPaste);
      setDragging(false);
    };
  }, [enabled]);

  return { dragging };
}
