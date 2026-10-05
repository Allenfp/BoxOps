// Keyboard focus in the timeline, an APG layout grid: the whole grid is one
// Tab stop (its active cell, the one that last had focus), and the arrow
// keys, Home, End, Page Up and Page Down move between cells
// (timeline/keyboard.ts). Cells are the elements with `data-cell` (a key
// that stays the same across re-renders: `box:<id>`), boxes and PTO blocks
// with their dates in `data-start` and `data-end`.
//
// React renders every cell with tabIndex -1 and never changes it; the active
// one's is set to 0 here, on the DOM, so moving focus renders nothing.
// A cell that moves rows re-mounts (a box dropped in another lane, a
// department moved, undo), which drops focus on the page (WebKit says
// nothing; Chromium fires a blur), so after each render focus that was in
// the grid goes back to the same cell, or else its neighbour. And focus is
// never left under the sticky header or label column (WCAG 2.4.11), nor
// under the broken-rule popup: the timeline scrolls to show it.

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { focusLost } from "../a11y/focus";
import type { Day } from "../model/dates";
import { type NavKey, navigate } from "../timeline/keyboard";

/** The cell that last had focus, kept across view switches: coming back to the timeline, Tab goes to it again. */
let remembered: string | null = null;

/** Room (px) kept around a cell scrolled into view. */
const MARGIN = 8;

export const cellOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>("[data-cell]") : null);

/** The navigation a key press asks for, if any (⌘ or Ctrl with an arrow: to the end of the row or grid, as Mac keyboards lack Home and End). */
export function navKey(e: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "metaKey" | "ctrlKey">): NavKey | null {
  if (e.altKey || e.shiftKey) return null;
  const mod = e.metaKey || e.ctrlKey;
  switch (e.key) {
    case "ArrowLeft":
      return mod ? "home" : "left";
    case "ArrowRight":
      return mod ? "end" : "right";
    case "ArrowUp":
      return mod ? "first" : "up";
    case "ArrowDown":
      return mod ? "last" : "down";
    case "Home":
      return mod ? "first" : "home";
    case "End":
      return mod ? "last" : "end";
    case "PageUp":
      return mod ? null : "pageUp";
    case "PageDown":
      return mod ? null : "pageDown";
  }
  return null;
}

export interface GridFocus {
  /** Focus a cell (its description written first, so it's read with it), and show it. */
  focus(cell: HTMLElement): void;
  /** The cell focus goes back to should what has it go (a deleted box's neighbour). */
  setActive(key: string): void;
  /** After the next render, focus goes back to this cell if it was lost, even with what had it still on the page (moved, which loses focus too). */
  keep(key: string): void;
  /** A navigation key pressed on a cell: moves focus, and returns true, if it's one. */
  onKey(e: KeyboardEvent): boolean;
  /** The key of the cell after `cell` in its row, else the one before, else the row's first, else the nearest in the row above: where focus goes once it's deleted. */
  neighbour(cell: HTMLElement): string | null;
  /** Write what's said about `cell` beyond its name again, as it's changed (a box being moved). */
  describe(cell: HTMLElement): void;
  /** Scroll the timeline so `cell` isn't hidden; for a box wider than the view, its start (or its end) shows. */
  reveal(cell: HTMLElement, edge?: "start" | "end"): void;
}

export function useGridFocus(
  grid: RefObject<HTMLElement | null>,
  opts: {
    scroller: RefObject<HTMLElement | null>;
    /** The sticky label column's width. */
    labelWidth: number;
    /** The days on screen: where the arrow keys land among boxes. */
    visible(): { from: Day; to: Day };
    /** What's said about a cell beyond its name, once it has focus (the box's details); "" for nothing. */
    describe(cell: HTMLElement): string;
    /** The id of the hidden element that holds it. */
    describedBy: string;
  },
): GridFocus {
  const o = useRef(opts);
  useLayoutEffect(() => {
    o.current = opts;
  });
  /** The active cell's key: the Tab stop, and where focus goes back to. */
  const active = useRef<string | null>(remembered);
  /** The element with tabindex 0. */
  const stop = useRef<HTMLElement | null>(null);
  /** Focus is (or was, until the element that had it went) in the grid. */
  const owns = useRef(false);
  /** What had focus in the grid last: once it's off the page with focus lost, a re-render took it. */
  const last = useRef<HTMLElement | null>(null);
  /** Where focus goes when the active cell has gone: the cells beside it, then its row's first. */
  const fallbacks = useRef<string[]>([]);
  /** The day up and down keep to, set by moving along a row. */
  const anchor = useRef<Day | null>(null);
  /** The focus move under way is up or down: the anchor stays. */
  const vertical = useRef(false);
  /** Focus comes from a press (on a box about to be dragged, say): it's where the pointer is, so nothing scrolls. */
  const pressed = useRef(false);
  /** A cell to put focus back on after the next render (keep). */
  const kept = useRef<string | null>(null);

  const find = (key: string | null) => (key ? (grid.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key)}"]`) ?? null) : null);

  const makeStop = (el: HTMLElement | null) => {
    if (stop.current !== el && stop.current?.isConnected) stop.current.tabIndex = -1;
    stop.current = el;
    if (el && el.tabIndex !== 0) el.tabIndex = 0;
  };

  const describe = (el: HTMLElement) => {
    const text = o.current.describe(el);
    const node = document.getElementById(o.current.describedBy);
    if (node) node.textContent = text;
    if (text) el.setAttribute("aria-describedby", o.current.describedBy);
  };

  const rowCells = (row: Element | null) => [...(row?.querySelectorAll<HTMLElement>("[data-cell]") ?? [])];
  /** A row as navigation sees it: its cells, and those with dates. */
  const navRow = (row: Element) => {
    const els = rowCells(row);
    return {
      els,
      heading: row.classList.contains("dept-row"),
      cells: els.map((c) => (c.dataset.start === undefined ? {} : { start: Number(c.dataset.start), end: Number(c.dataset.end) })),
    };
  };
  /** The day a cell is looked at by: a box's start, or the first day on screen while it runs; the middle of the screen for a label. */
  const dayOf = (el: HTMLElement) => {
    const { from, to } = o.current.visible();
    return el.dataset.start === undefined ? Math.round((from + to) / 2) : Math.max(Number(el.dataset.start), Math.min(from, Number(el.dataset.end)));
  };
  /**
   * Where focus goes if `el` goes: the cell after it in its row, else the one before, else the
   * row's first. Alone in its row (a box in a department's extra area), the cell nearest it in
   * the row above, which is in the same department: never the grid's first cell.
   */
  const keysBeside = (el: HTMLElement) => {
    const row = el.closest('[role="row"]');
    const cells = rowCells(row);
    const i = cells.indexOf(el);
    const beside = [cells[i + 1], cells[i - 1], cells[0]].filter((c) => c && c !== el).map((c) => c!.dataset.cell!);
    const rows = beside.length || !row ? [] : [...(grid.current?.querySelectorAll('[role="row"]') ?? [])];
    for (let r = rows.indexOf(row!) - 1; r >= 0; r--) {
      const above = navRow(rows[r]);
      if (!above.els.length) continue;
      const at = navigate([above, navRow(row!)], { row: 1, col: i }, "up", dayOf(el));
      return at ? [above.els[at.col].dataset.cell!] : [];
    }
    return beside;
  };

  const reveal = (el: HTMLElement, edge: "start" | "end" = "start") => {
    const sc = o.current.scroller.current;
    if (!sc) return;
    const view = sc.getBoundingClientRect();
    const head = sc.querySelector(".tl-head")?.getBoundingClientRect().height ?? 0;
    const r = el.getBoundingClientRect();
    const top = view.top + head;
    let bottom = view.top + sc.clientHeight;
    const left = view.left + o.current.labelWidth;
    const right = view.left + sc.clientWidth;
    let dx = 0;
    // Labels stay in the sticky column, and a collapsed department's chart is as wide as the timeline: only up and down for them.
    if (!el.closest(".label") && !el.classList.contains("use-cell")) {
      const width = right - left - 2 * MARGIN;
      if (edge === "end" && r.width > width) dx = r.right - right + MARGIN;
      else if (r.left < left + MARGIN) dx = r.left - left - MARGIN;
      else if (r.right > right - MARGIN) dx = Math.min(r.right - right + MARGIN, r.left - left - MARGIN);
    }
    // The broken-rule popup sits over the bottom right corner: above it, where the cell will be once scrolled across.
    const toast = document.querySelector(".toast")?.getBoundingClientRect();
    if (toast && toast.left < r.right - dx && toast.right > r.left - dx && toast.top < bottom) bottom = toast.top;
    let dy = 0;
    if (r.top < top + MARGIN) dy = r.top - top - MARGIN;
    else if (r.bottom > bottom - MARGIN) dy = Math.min(r.bottom - bottom + MARGIN, r.top - top - MARGIN);
    if (dx || dy) sc.scrollBy(dx, dy);
  };

  const focus = (el: HTMLElement) => {
    describe(el);
    el.focus({ preventScroll: true }); // focusin (below) shows it
  };

  useEffect(() => {
    const g = grid.current;
    if (!g) return;
    const onIn = (e: FocusEvent) => {
      owns.current = true;
      last.current = e.target as HTMLElement;
      const el = cellOf(e.target);
      if (!el) return;
      active.current = remembered = el.dataset.cell!;
      makeStop(el);
      fallbacks.current = keysBeside(el);
      // Focused by Tab or a click: said with its details too.
      if (!el.hasAttribute("aria-describedby")) describe(el);
      if (el.dataset.start !== undefined && !vertical.current) anchor.current = dayOf(el);
      if (!pressed.current) reveal(el);
    };
    const onOut = (e: FocusEvent) => {
      const from = e.target as HTMLElement;
      if (from.getAttribute("aria-describedby") === o.current.describedBy) from.removeAttribute("aria-describedby");
      const to = e.relatedTarget as Node | null;
      // Somewhere else on the page; going nowhere is told apart after the next render (below).
      if (to && !g.contains(to)) owns.current = false;
    };
    const onPress = () => (pressed.current = true);
    const onKey = () => (pressed.current = false);
    g.addEventListener("focusin", onIn);
    g.addEventListener("focusout", onOut);
    g.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      g.removeEventListener("focusin", onIn);
      g.removeEventListener("focusout", onOut);
      g.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // The grid element is there for the timeline's life; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);

  // After every render: focus a re-render took from the grid goes back, and the active cell
  // (else the one Tab last went to, else the first) is the Tab stop.
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const keep = find(kept.current);
    kept.current = null;
    if (keep && focusLost()) return focus(keep);
    if (owns.current && focusLost()) {
      // Focus went with what had it: back to the same cell, else beside it, else the first. Not
      // from a field (a lane's name being typed), whose own code puts it back after its key's
      // events: now, Enter's keypress would press the button it's put on.
      if (last.current && !last.current.isConnected && !(last.current instanceof HTMLInputElement)) {
        const el = [active.current, ...fallbacks.current].map(find).find(Boolean) ?? g.querySelector<HTMLElement>("[data-cell]");
        if (el) return focus(el);
      }
      owns.current = false; // a click on nothing that takes focus
    }
    makeStop(find(active.current) ?? (stop.current?.isConnected ? stop.current : g.querySelector<HTMLElement>("[data-cell]")));
  });

  return {
    focus,
    setActive: (key) => {
      active.current = remembered = key;
    },
    keep: (key) => {
      kept.current = key;
    },
    neighbour: (el) => keysBeside(el)[0] ?? null,
    describe,
    reveal,
    onKey: (e) => {
      const key = navKey(e);
      const g = grid.current;
      const el = cellOf(e.target);
      if (!key || !g || !el) return false;
      e.preventDefault();
      const rowEls = [...g.querySelectorAll('[role="row"]')];
      const rows = rowEls.map(navRow);
      const row = rowEls.indexOf(el.closest('[role="row"]')!);
      if (row < 0) return true;
      const { from, to } = o.current.visible();
      const centre = Math.round((from + to) / 2);
      // Into the boxes from the labels: those on screen. Otherwise the day kept to.
      const day = (key === "right" && el.dataset.start === undefined) || anchor.current === null ? centre : anchor.current;
      const at = navigate(rows, { row, col: rows[row].els.indexOf(el) }, key, day);
      if (!at) return true;
      vertical.current = key === "up" || key === "down";
      if (vertical.current && anchor.current === null) anchor.current = day;
      try {
        focus(rows[at.row].els[at.col]);
      } finally {
        vertical.current = false;
      }
      return true;
    },
  };
}
