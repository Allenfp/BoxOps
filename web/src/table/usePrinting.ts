import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/**
 * Whether the page is being printed (⌘P, Ctrl+P, or print preview). The table
 * and People print every row, which on a big roadmap they don't draw on
 * screen, so they add a plain copy of them while this is true: drawn before
 * the browser lays the page out for paper (`beforeprint`, or the print media
 * query as it starts to match), and gone once it's done. Looked at again as
 * a view starts listening: printing may have started as it was first drawn
 * (a view that had just loaded).
 */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, printing);
}

let media: MediaQueryList | null = null;
/** Between `beforeprint` and `afterprint`. */
let started = false;
const printing = () => started || (media ??= window.matchMedia("print")).matches;

function subscribe(changed: () => void): () => void {
  media ??= window.matchMedia("print");
  const update = () => (printing() ? flushSync(changed) : changed());
  const before = () => {
    started = true;
    update();
  };
  const after = () => {
    started = false;
    update();
  };
  window.addEventListener("beforeprint", before);
  window.addEventListener("afterprint", after);
  media.addEventListener("change", update);
  return () => {
    window.removeEventListener("beforeprint", before);
    window.removeEventListener("afterprint", after);
    media?.removeEventListener("change", update);
  };
}
