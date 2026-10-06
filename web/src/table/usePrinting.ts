import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Whether the page is being printed (⌘P, Ctrl+P, or print preview). The table
 * and People print every row, which on a big roadmap they don't draw on
 * screen, so they add a plain copy of them while this is true: drawn before
 * the browser lays the page out for paper (`beforeprint`, or the print media
 * query as it starts to match), and gone once it's done.
 */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(() => window.matchMedia("print").matches);
  useEffect(() => {
    const media = window.matchMedia("print");
    const set = (on: boolean) => (on ? flushSync(() => setPrinting(true)) : setPrinting(false));
    const before = () => set(true);
    const after = () => set(false);
    const change = (e: MediaQueryListEvent) => set(e.matches);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media.addEventListener("change", change);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media.removeEventListener("change", change);
    };
  }, []);
  return printing;
}
