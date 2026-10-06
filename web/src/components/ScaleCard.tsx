// A box's scale card: the sum, the scale in person-weeks/months/quarters,
// and the share of the department the box takes while it runs. Shown by
// hovering the scale number (ScaleBadge.tsx), or with I on a box that has
// keyboard focus (Timeline.tsx); fetched the first time it's shown. As WCAG
// 1.4.13 asks, the pointer can move onto it without it going, Escape puts
// it away (and does nothing else), and it stays until then, or until the
// pointer leaves (shown by the pointer) or focus does (shown by I). It lets
// the pointer through (it covers the rows below: their cells, or the next
// lane's boxes), so where the pointer is is watched instead; a press or the
// wheel there reaches what's under it, and puts the card away, as does any
// other key (picking the box up to move it, say; I is the timeline's own).

import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { letter } from "../a11y/keys";
import { amount, percent, scaleStats } from "../model/scale";
import type { Box, Department } from "../model/types";

const WIDTH = 300;
/** How far (px) the card is from what it's for. */
const GAP = 6;
/** How long (ms) the card waits after the pointer leaves the number, so it can reach the card. */
const GRACE_MS = 150;

export interface ScaleCardProps {
  box: Box;
  departments: Department[];
  /** What it's shown for: placed under it, at its right (above it without room below), following it as the page scrolls. */
  anchor: RefObject<HTMLElement | null>;
  /** Shown by the pointer (over `anchor`): it stays while the pointer's over either, and goes once it isn't. Else by the keyboard: it goes when `anchor` loses focus. */
  hover: boolean;
  onClose(): void;
}

export function ScaleCard({ box, departments, anchor, hover, onClose }: ScaleCardProps) {
  const card = useRef<HTMLDivElement>(null);
  /** Where the anchor is on screen, as of when the card was shown or the page last scrolled. */
  const [at, setAt] = useState<DOMRect | null>(() => anchor.current?.getBoundingClientRect() ?? null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    const listening = new AbortController();
    const on = <K extends keyof WindowEventMap>(type: K, listener: (e: WindowEventMap[K]) => void, passive = false) =>
      window.addEventListener(type, listener, { capture: true, passive, signal: listening.signal });
    const away = () => close.current();
    on("keydown", (e) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      } else if (letter(e) === "i" && !e.metaKey && !e.ctrlKey && !e.altKey && (e.target as Element).closest?.("[data-cell]")) {
        return; // the timeline's: it shows or hides the focused box's card
      }
      away();
    });
    // Gone from the page (its box deleted, say): so is the card.
    on("scroll", () => (el.isConnected ? setAt(el.getBoundingClientRect()) : away()));
    on("pointerdown", away);
    on("wheel", away, true);
    if (hover) {
      let leaving: ReturnType<typeof setTimeout> | undefined;
      /** Where the pointer was last seen; null once it's left the window. */
      let pointer: { x: number; y: number } | null = null;
      /** The pointer is on what it's for or the card, or in the gap between them. */
      const over = () =>
        [el, card.current].some((e) => {
          const r = e?.getBoundingClientRect();
          return !!pointer && !!r && pointer.x > r.left - GAP && pointer.x < r.right + GAP && pointer.y > r.top - GAP && pointer.y < r.bottom + GAP;
        });
      const watch = (e: PointerEvent) => {
        // Out to nothing: gone from the window, which no move says.
        pointer = e.type === "pointerout" && !e.relatedTarget ? null : e;
        if (over()) {
          clearTimeout(leaving);
          leaving = undefined;
        } else {
          // In GRACE_MS, it goes, unless the pointer's back over it by then.
          leaving ??= setTimeout(() => {
            leaving = undefined;
            if (!over()) away();
          }, GRACE_MS);
        }
      };
      on("pointermove", watch);
      on("pointerout", watch);
      listening.signal.addEventListener("abort", () => clearTimeout(leaving));
    } else {
      el.addEventListener("blur", away, { signal: listening.signal });
    }
    return () => listening.abort();
  }, [anchor, hover]);

  if (!at) return null;
  const stats = scaleStats(box, departments);
  const left = Math.min(Math.max(8, at.right - WIDTH), window.innerWidth - WIDTH - 8);
  const style: CSSProperties = at.bottom + 100 < window.innerHeight ? { left, top: at.bottom + GAP } : { left, bottom: window.innerHeight - at.top + GAP };
  return createPortal(
    <div ref={card} className="scale-pop" role="tooltip" style={{ ...style, width: WIDTH }}>
      <strong>Scale {stats.scale}</strong>
      <span className="hint">
        {" "}
        = {box.fte} FTE × {stats.days} working day{stats.days === 1 ? "" : "s"}
      </span>
      <div>
        ≈ {amount(stats.in.week)} weeks · {amount(stats.in.month)} months · {amount(stats.in.quarter)} quarters
      </div>
      {stats.dept && (
        <div>
          {percent(stats.dept.share)} of {stats.dept.name} while it runs
        </div>
      )}
      <div className="hint">FTE per Month = ~20</div>
    </div>,
    document.body,
  );
}
