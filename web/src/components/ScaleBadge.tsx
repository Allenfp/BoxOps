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

  /** Where the pointer was last seen; null once it's left the window. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** The pointer is on the number, on the card, or straight between them. */
  const over = () => {
    const p = pointer.current;
    const n = ref.current?.getBoundingClientRect();
    if (!p || !n) return false;
    const inside = (r: { left: number; right: number; top: number; bottom: number }) =>
      p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    const c = card.current?.getBoundingClientRect();
    return inside(n) || (!!c && (inside(c) || inside({ left: n.left, right: n.right, top: Math.min(n.bottom, c.bottom), bottom: Math.max(n.top, c.top) })));
  };
  const seen = (e: { clientX: number; clientY: number }) => (pointer.current = { x: e.clientX, y: e.clientY });
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
  const enter = (e: { clientX: number; clientY: number }) => {
    seen(e);
    stay();
    if (!open) place();
    setHovered(true);
    setAway(false);
  };
  useEffect(() => () => clearTimeout(leaving.current), []);

  // Keyboard focus on the box (or cell) it's in: shown while it lasts. Not focus from pressing
  // the box (to drag it, say), which browsers may well draw a ring for (:focus-visible) all the same.
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-cell]");
    if (!host) return;
    const onIn = (e: FocusEvent) => {
      if (e.target !== host || focusByPress()) return;
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
  // to move it, say), a press or the wheel puts it away too. It follows the number as the page
  // scrolls. Shown by the pointer, it stays while the pointer's over it, and goes once it's not.
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
    const putAway = () => {
      stay();
      setHovered(false);
      setAway(true);
    };
    const onMove = (e: PointerEvent) => {
      seen(e);
      if (over()) stay();
      else leave();
    };
    // Gone from the window: no move says so.
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget) return;
      pointer.current = null;
      leave();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("pointerdown", putAway, true);
    window.addEventListener("wheel", putAway, { capture: true, passive: true });
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("pointerout", onOut, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("pointerdown", putAway, true);
      window.removeEventListener("wheel", putAway, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerout", onOut, true);
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
        onMouseLeave={(e) => {
          seen(e);
          leave();
        }}
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
