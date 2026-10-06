// Drag to reorder a vertical list of rows (departments on the timeline and in
// the table). Press on a row's handle and move a few pixels to start; a line
// shows where it will land; release to drop. A press that doesn't move stays
// an ordinary click; Escape, or losing the pointer, cancels the drag
// (followPointer.ts). Rows are found by `data-reorder-id`, in document order,
// inside the container. From the keyboard, Alt+↑ and Alt+↓ on a heading move
// it a place at a time (reorderByKey).

import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { announce } from "../a11y/announce";
import { followPointer, swallowNextClick } from "./followPointer";

const THRESHOLD = 4;
/** Distance (px) from the scroller's top or bottom edge that scrolls it. */
const EDGE = 40;

export interface Reorder {
  /** The row being dragged, once the drag has started. */
  draggingId: string | null;
  /** Where the drop line goes, in viewport coordinates; null when the drop would change nothing. */
  line: { top: number; left: number; width: number } | null;
  /** Put on the handle's onPointerDown. */
  start(e: ReactPointerEvent, id: string): void;
}

export function useReorder(
  container: RefObject<HTMLElement | null>,
  onMove: (id: string, index: number) => void,
  opts: { disabled?: boolean; scroller?: RefObject<HTMLElement | null> } = {},
): Reorder {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [line, setLine] = useState<Reorder["line"]>(null);
  const press = useRef<{ id: string; x: number; y: number; active: boolean; target: number | null } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  /** The line as last drawn: drawn again only when it moves, not at every pixel the pointer does. */
  const drawn = useRef<Reorder["line"]>(null);
  const showLine = (next: Reorder["line"]) => {
    const was = drawn.current;
    if (was === next || (was && next && was.top === next.top && was.left === next.left && was.width === next.width)) return;
    drawn.current = next;
    setLine(next);
  };

  useEffect(() => () => cleanup.current?.(), []);

  const rows = () => [...(container.current?.querySelectorAll<HTMLElement>("[data-reorder-id]") ?? [])];

  /** Work out the drop position under the pointer and the line to draw there. */
  const track = (clientY: number) => {
    const p = press.current;
    const box = container.current?.getBoundingClientRect();
    if (!p || !box) return;
    const all = rows();
    const from = all.findIndex((r) => r.dataset.reorderId === p.id);
    const rects = all.map((r) => r.getBoundingClientRect());
    // The gap before row `gap` (0 … n) is the one nearest the pointer.
    const gap = rects.filter((r) => r.top + r.height / 2 < clientY).length;
    const index = gap > from ? gap - 1 : gap;
    p.target = index === from ? null : index;
    if (p.target === null) return showLine(null);
    const top = gap < rects.length ? rects[gap]!.top : rects[rects.length - 1]!.bottom;
    // Only as wide as the part of the list that's on screen.
    const view = opts.scroller?.current?.getBoundingClientRect();
    const left = Math.max(box.left, view?.left ?? box.left);
    const right = Math.min(box.right, view?.right ?? box.right);
    showLine({ top, left, width: Math.max(0, right - left) });
  };

  const start = useCallback(
    (e: ReactPointerEvent, id: string) => {
      if (opts.disabled || e.button !== 0 || cleanup.current) return;
      press.current = { id, x: e.clientX, y: e.clientY, active: false, target: null };
      let lastY = e.clientY;
      let frame = 0;

      // Near the scroller's top or bottom edge, keep scrolling while the pointer rests there.
      const autoScroll = () => {
        const el = opts.scroller?.current;
        frame = 0;
        if (!el || !press.current?.active) return;
        const r = el.getBoundingClientRect();
        const dy = lastY < r.top + EDGE ? -12 : lastY > r.bottom - EDGE ? 12 : 0;
        if (!dy) return;
        el.scrollTop += dy;
        track(lastY);
        frame = requestAnimationFrame(autoScroll);
      };

      cleanup.current = followPointer(e, opts.scroller?.current ?? null, {
        move: (ev) => {
          const p = press.current;
          if (!p) return false;
          lastY = ev.clientY;
          if (!p.active) {
            if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < THRESHOLD) return false;
            p.active = true;
            setDraggingId(p.id);
            document.body.classList.add("reordering");
          }
          ev.preventDefault();
          window.getSelection()?.removeAllRanges(); // the press may have started selecting text
          track(ev.clientY);
          if (!frame) frame = requestAnimationFrame(autoScroll);
          return true;
        },
        end: (released) => {
          const p = press.current;
          document.body.classList.remove("reordering");
          if (frame) cancelAnimationFrame(frame);
          press.current = null;
          cleanup.current = null;
          setDraggingId(null);
          showLine(null);
          if (!p?.active) return;
          // The release would also click whatever is under it (e.g. collapse the department): swallow that.
          swallowNextClick();
          if (released && p.target !== null) onMoveRef.current(p.id, p.target);
        },
      });
    },
    // track and opts.scroller only reach the DOM through refs, so an older render's copies
    // behave the same, and start stays the same function between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    [opts.disabled],
  );

  return { draggingId, line, start };
}

/**
 * Alt+↑ or Alt+↓ (Option on a Mac) on a department's heading moves it one
 * place up or down, the keyboard's way to drag it, and says where it is now
 * ("Analytics moved up, 1 of 3"). `move` is undefined when it can't be
 * reordered now; `why` says so. Returns the new place, or null if the key
 * wasn't one of these or nothing moved.
 */
export function reorderByKey(
  e: Pick<KeyboardEvent, "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "preventDefault">,
  order: { id: string; name: string }[],
  id: string,
  move: ((id: string, index: number) => void) | undefined,
  why: string,
): number | null {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return null;
  e.preventDefault();
  const i = order.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const up = e.key === "ArrowUp";
  const j = i + (up ? -1 : 1);
  const name = order[i].name;
  const stays = !move ? why : j < 0 || j >= order.length ? `${name} is already ${up ? "first" : "last"}.` : null;
  if (stays) {
    announce(stays);
    return null;
  }
  move!(id, j);
  announce(`${name} moved ${up ? "up" : "down"}, ${j + 1} of ${order.length}.`);
  return j;
}
