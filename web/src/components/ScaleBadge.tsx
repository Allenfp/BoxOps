// The scale number on a box or table row: underlined, and hovering it shows
// a short card: the sum, the scale in person-weeks/months/quarters, and the
// share of the department the box takes while it runs. Keyboard focus on
// the box it's in shows the card too. As WCAG 1.4.13 asks, the pointer can
// move onto the card without it going, Escape puts it away (and nothing
// else), and it stays until then or until the pointer or focus leaves. The
// card itself lets the pointer through (it covers the rows below: their
// cells, or the next lane's boxes), so where the pointer is is watched
// instead; a press or the wheel there reaches what's under it, and puts
// the card away.

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { amount, boxScale, percent, scaleStats } from "../model/scale";
import type { Box, Department } from "../model/types";
import { focusByPress } from "./useGridFocus";

const WIDTH = 300;
/** How far (px) the card is from the number. */
const GAP = 6;
/** How long (ms) the card waits after the pointer leaves the number, so it can reach the card. */
const GRACE_MS = 150;

interface Props {
  box: Box;
  departments: Department[];
  className?: string;
}

export function ScaleBadge({ box, departments, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  /** The box it's in has keyboard focus. */
  const [focused, setFocused] = useState(false);
  /** Put away with Escape (or another key, a press or the wheel), until the pointer or focus brings it back. */
  const [away, setAway] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Where the number is on screen, as of when the card was shown or the page last scrolled. */
  const [at, setAt] = useState<DOMRect | null>(null);
  const place = () => setAt(ref.current?.getBoundingClientRect() ?? null);
  const open = (hovered || focused) && !away;

  /** Where the pointer was last seen (an event's `x` and `y`); null once it's left the window. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** The pointer is on the number or the card, or in the gap between them. */
  const over = () => {
    const p = pointer.current;
    return [ref.current, card.current].some((el) => {
      const r = el?.getBoundingClientRect();
      return !!p && !!r && p.x > r.left - GAP && p.x < r.right + GAP && p.y > r.top - GAP && p.y < r.bottom + GAP;
    });
  };
  const stay = () => {
    clearTimeout(leaving.current);
    leaving.current = undefined;
  };
  /** In GRACE_MS, it goes, unless the pointer's back over it by then. */
  const leave = () => {
    leaving.current ??= setTimeout(() => {
      leaving.current = undefined;
      if (!over()) setHovered(false);
    }, GRACE_MS);
  };
  const enter = () => {
    stay();
    if (!open) place();
    setHovered(true);
    setAway(false);
  };

  // Keyboard focus on the box (or cell) it's in: shown while it lasts. Not focus from pressing
  // the box (to drag it, say), which browsers may well draw a ring for (:focus-visible) all the same.
  // Gone from the page, no grace period is left running either.
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-cell]");
    if (!host) return;
    const listening = new AbortController();
    const options = { signal: listening.signal };
    host.addEventListener(
      "focus",
      () => {
        if (focusByPress()) return;
        place();
        setFocused(true);
        setAway(false);
      },
      options,
    );
    host.addEventListener("blur", () => setFocused(false), options);
    return () => {
      listening.abort();
      clearTimeout(leaving.current);
    };
  }, []);

  // While it shows: Escape puts it away, and does nothing else; any other key (picking the box up
  // to move it, say), a press or the wheel puts it away too. It follows the number as the page
  // scrolls. Shown by the pointer, it stays while the pointer's over it, and goes once it's not.
  useEffect(() => {
    if (!open) return;
    const listening = new AbortController();
    const on = <K extends keyof WindowEventMap>(type: K, listener: (e: WindowEventMap[K]) => void, passive = false) =>
      window.addEventListener(type, listener, { capture: true, passive, signal: listening.signal });
    on("keydown", (e) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      setAway(true);
    });
    on("scroll", place);
    on("pointerdown", () => setAway(true));
    on("wheel", () => setAway(true), true);
    const watch = (e: PointerEvent) => {
      // Out to nothing: gone from the window, which no move says.
      pointer.current = e.type === "pointerout" && !e.relatedTarget ? null : e;
      if (over()) stay();
      else leave();
    };
    on("pointermove", watch);
    on("pointerout", watch);
    return () => listening.abort();
  }, [open]);

  const scale = boxScale(box);
  const stats = open && at ? scaleStats(box, departments) : null;
  let style: CSSProperties = {};
  if (stats && at) {
    const left = Math.min(Math.max(8, at.right - WIDTH), window.innerWidth - WIDTH - 8);
    style = at.bottom + 100 < window.innerHeight ? { left, top: at.bottom + GAP } : { left, bottom: window.innerHeight - at.top + GAP };
  }

  return (
    <>
      <span
        ref={ref}
        className={`scale-number${className ? ` ${className}` : ""}`}
        // An empty title keeps the box's own tooltip from covering the popup.
        title=""
        onMouseEnter={enter}
      >
        {/* Said as "Scale 30" where the number is read (a table cell): a name on a plain <span> isn't. */}
        <span className="sr-only">Scale </span>
        {scale}
      </span>
      {stats &&
        createPortal(
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
        )}
    </>
  );
}
