"use client";

import { useEffect, useRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { curlAll, curlyFor, hasStraightQuotes } from "@/app/forge/lib/quotes";

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Puts `text` over the selection the way typing would, so the caret, the browser's undo and
 *  React's onChange all follow. */
function insert(el: Field, text: string) {
  if (document.execCommand("insertText", false, text)) return;
  el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Card text boxes for text that is printed on the card. A typed straight quote goes in as the
// curly one print uses. Text that arrives another way (paste, import, an older card, a phone
// keyboard that composes) keeps its straight quotes, and one line under the box offers to
// convert them: in the box's small type the two kinds look alike.
function useCurlyQuotes<T extends Field>() {
  const ref = useRef<T>(null);

  // Native listener: React's onBeforeInput is synthesized and carries no inputType.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onBeforeInput = (e: Event) => {
      const { inputType, isComposing, data } = e as InputEvent;
      if (inputType !== "insertText" || isComposing || (data !== '"' && data !== "'")) return;
      e.preventDefault();
      insert(el, curlyFor(el.value.slice(0, el.selectionStart ?? 0), data));
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

  return { ref, makeCurly };
}

function StraightQuotesLine({ value, onMakeCurly }: { value: string; onMakeCurly: () => void }) {
  if (!hasStraightQuotes(value)) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground [fieldset:disabled_&]:hidden">
      Has straight quotes ·{" "}
      <button type="button" onClick={onMakeCurly} className="underline underline-offset-2 hover:text-foreground">
        Make curly
      </button>
    </p>
  );
}

export default function QuoteTextarea({
  value, ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & { value: string }) {
  const { ref, makeCurly } = useCurlyQuotes<HTMLTextAreaElement>();
  return (
    <>
      <textarea ref={ref} value={value} {...props} />
      <StraightQuotesLine value={value} onMakeCurly={makeCurly} />
    </>
  );
}

/** The single-line version, for the card's name and identifiers. */
export function QuoteInput({
  value, ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & { value: string }) {
  const { ref, makeCurly } = useCurlyQuotes<HTMLInputElement>();
  return (
    <>
      <input ref={ref} value={value} {...props} />
      <StraightQuotesLine value={value} onMakeCurly={makeCurly} />
    </>
  );
}
