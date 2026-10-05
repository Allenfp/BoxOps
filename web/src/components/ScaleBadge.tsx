// The scale number on a box or table row: underlined, and hovering it shows
// a short card: the sum, the scale in person-weeks/months/quarters, and the
// share of the department the box takes while it runs. Keyboard focus on
// the box it's in shows the card too. As WCAG 1.4.13 asks, the pointer can
// move onto the card without it going, Escape puts it away (and nothing
// else), and it stays until then or until the pointer or focus leaves.

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { amount, boxScale, percent, scaleStats } from "../model/scale";
import type { Box, Department } from "../model/types";

const WIDTH = 300;
/** How long (ms) the card waits after the pointer leaves the number, so it can reach the card. */
const GRACE_MS = 150;

interface Props {
  box: Box;
  departments: Department[];
  className?: string;
}

export function ScaleBadge({ box, departments, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [hovered, setHovered] = useState(false);
  /** The box it's in has keyboard focus. */
  const [focused, setFocused] = useState(false);
  /** Put away with Escape (or another key), until the pointer or focus brings it back. */
  const [away, setAway] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Where the number is on screen, as of when the card was shown or the page last scrolled. */
  const [at, setAt] = useState<DOMRect | null>(null);
  const place = () => setAt(ref.current?.getBoundingClientRect() ?? null);
  const open = (hovered || focused) && !away;

  const enter = () => {
    clearTimeout(leaving.current);
    if (!open) place();
    setHovered(true);
    setAway(false);
  };
  const leave = () => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setHovered(false), GRACE_MS);
  };
  useEffect(() => () => clearTimeout(leaving.current), []);

  // Keyboard focus on the box (or cell) it's in: shown while it lasts.
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-cell]");
    if (!host) return;
    const onIn = (e: FocusEvent) => {
      if (e.target !== host || !host.matches(":focus-visible")) return;
      place();
      setFocused(true);
      setAway(false);
    };
    const onOut = (e: FocusEvent) => e.target === host && setFocused(false);
    host.addEventListener("focusin", onIn);
    host.addEventListener("focusout", onOut);
    return () => {
      host.removeEventListener("focusin", onIn);
      host.removeEventListener("focusout", onOut);
    };
  }, []);

  // While it shows: Escape puts it away, and does nothing else; any other key (picking the box up
  // to move it, say) puts it away too. It follows the number as the page scrolls.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      setAway(true);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const scale = boxScale(box);
  const stats = open && at ? scaleStats(box, departments) : null;
  let style: CSSProperties = {};
  if (stats && at) {
    const left = Math.min(Math.max(8, at.right - WIDTH), window.innerWidth - WIDTH - 8);
    style = at.bottom + 100 < window.innerHeight ? { left, top: at.bottom + 6 } : { left, bottom: window.innerHeight - at.top + 6 };
  }

  return (
    <>
      <span
        ref={ref}
        className={`scale-number${className ? ` ${className}` : ""}`}
        // An empty title keeps the box's own tooltip from covering the popup.
        title=""
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        {/* Said as "Scale 30" where the number is read (a table cell): a name on a plain <span> isn't. */}
        <span className="sr-only">Scale </span>
        {scale}
      </span>
      {stats &&
        createPortal(
          <div id={id} className="scale-pop" role="tooltip" style={{ ...style, width: WIDTH }} onMouseEnter={enter} onMouseLeave={leave}>
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
