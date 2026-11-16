"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { curlAll, curlyFor, hasStraightQuotes } from "@/app/forge/lib/quotes";

/** Puts `text` over the selection the way typing would, so the caret, the browser's undo and
 *  React's onChange all follow. */
function insert(el: HTMLTextAreaElement, text: string) {
  if (document.execCommand("insertText", false, text)) return;
  el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// A card text box for text that is printed on the card. A typed straight quote goes in as the
// curly one print uses. Text that arrives another way (paste, import, an older card, a phone
// keyboard that composes) keeps its straight quotes, and one line under the box offers to
// convert them: in the box's small type the two kinds look alike.
export default function QuoteTextarea({
  value, ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Native listener: React's onBeforeInput is synthesized and carries no inputType.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertText" || e.isComposing || (e.data !== '"' && e.data !== "'")) return;
      e.preventDefault();
      insert(el, curlyFor(el.value.slice(0, el.selectionStart), e.data));
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  function makeCurly() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    insert(el, curlAll(el.value));
  }

  return (
    <>
      <textarea ref={ref} value={value} {...props} />
      {hasStraightQuotes(value) && (
        <p className="mt-1 text-xs text-muted-foreground [fieldset:disabled_&]:hidden">
          Has straight quotes ·{" "}
          <button type="button" onClick={makeCurly} className="underline underline-offset-2 hover:text-foreground">
            Make curly
          </button>
        </p>
      )}
    </>
  );
}
