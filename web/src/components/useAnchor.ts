import { type RefObject, useLayoutEffect, useState } from "react";

const GAP = 8;

/**
 * Where a popover of `width` goes next to the element matching `selector`:
 * below it, else above, else beside it, and following it while the page
 * scrolls. Centred on screen when the element isn't there.
 */
export function useAnchor(ref: RefObject<HTMLElement | null>, selector: string, width: number, deps: unknown[]) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const pop = ref.current;
      const anchor = document.querySelector(selector);
      if (!pop) return;
      const h = pop.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!anchor) {
        setPos({ top: Math.max(GAP, (vh - h) / 2), left: Math.max(GAP, (vw - width) / 2) });
        return;
      }
      const r = anchor.getBoundingClientRect();
      const clampTop = (t: number) => Math.min(Math.max(GAP, t), Math.max(GAP, vh - h - GAP));
      const clampLeft = (l: number) => Math.min(Math.max(GAP, l), vw - width - GAP);
      let top: number;
      let left: number;
      if (r.bottom + GAP + h <= vh - GAP) {
        top = r.bottom + GAP;
        left = clampLeft(r.left);
      } else if (r.top - GAP - h >= GAP) {
        top = r.top - GAP - h;
        left = clampLeft(r.left);
      } else {
        // No room above or below: sit beside it rather than on top of it.
        top = clampTop(r.top - 40);
        const right = Math.min(r.right, vw) + GAP;
        left = right + width <= vw - GAP ? right : clampLeft(Math.max(r.left, 0) - width - GAP);
      }
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return pos;
}
