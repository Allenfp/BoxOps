// The browser's part of drawing only some of a long table's rows
// (windowMath.ts has the arithmetic): where the table is scrolled to, how
// tall the rows drawn are, and keeping what's on screen in place when rows
// above it change.
//
// Rows are measured as they're drawn (a ResizeObserver: its first report
// comes with the next frame, so drawing a row never makes the browser lay
// the page out early). A row not drawn is as tall as rows of its kind
// usually are, by those drawn now, or by those drawn last if none are (until
// the density changes: then by its kind's default till one's drawn). Rows
// of a kind are all as tall as one another unless one's being edited or
// says why a cell won't do: the table and People keep descriptions and
// notes to two lines, and long PTO lists to two entries.
//
// Safari doesn't keep the view in place when what's above it changes height
// (CSS scroll anchoring), so that's done here, the same in every browser
// (the scroller has `overflow-anchor: none`): after each change drawn, the
// row that was at the top of the view stays there, unless the change sorted
// it elsewhere: then the first after it that it didn't (a calendar or the
// Engineers list open in the table moves with its button). Not across a
// new sort: the table stays scrolled as far as it was, rather than
// following that row to wherever it's sorted. A new search or new dates
// show their rows from the top, drawn whole or not (on a big table, the
// search stands in for the browser's Find). Anything else that changes
// which rows are shown (Hide finished, someone else's save) keeps the row
// at the top, or the first after it that's still shown, in place.

import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePrefs } from "../prefs";
import { anchorRow, heightLearner, layout, type Range, type Run, runs, windowRows } from "./windowMath";

/**
 * A table with more rows than this (boxes, PTO, engineers, headings) draws
 * only those near the screen, and what has focus: up to it, all of them, so
 * the browser's Find and a screen reader's browse mode reach every row.
 * Drawing them all costs about 1 ms a row: measured in WebKit on an M1
 * (the production build at 1440 × 900, generated roadmaps), the table opens
 * in about 250 ms at 250 rows, 310 at 330 and 500 at 490; drawing only
 * what's near the screen, in about 50 ms at any size.
 */
export const DRAW_ALL_UP_TO = 200;

/** How far past the screen's top and bottom rows are drawn (px). */
const OVERSCAN = 400;
/** The view is worked out in steps of this (px): the rows drawn change once a scroll has gone this far. */
const STEP = 200;

export interface WindowedRows {
  /** For the scroller's ref: what scrolls. */
  scroller: RefObject<HTMLDivElement | null>;
  /** For the table's sticky <thead>'s ref: the rows start below it. */
  head: RefObject<HTMLTableSectionElement | null>;
  /** Whether only some rows are drawn. */
  windowed: boolean;
  /** The rows drawn, by index. */
  ranges: readonly Range[];
  /** Rows `start` to `end` (a department's) as what to draw: rows, and spacers as tall as the rest. */
  runs(start: number, end: number): Run[];
  /** For a row's <tr ref>: measures it while it's drawn (only some are). The same function every time for one key. */
  measure(key: string): (el: HTMLElement | null) => void;
  /** Scroll the row with this key into view (`center`: to the middle), drawing what's there at once. False if there's no such row. */
  scrollTo(key: string, align?: "nearest" | "center"): boolean;
}

const none = () => {};

export function useWindowedRows(o: {
  /** Every row's key, in order, drawn or not. */
  keys: readonly string[];
  /** Every row's kind (rows of a kind are measured as one). */
  kinds: readonly string[];
  /** How tall a row of each kind is until one's been measured. */
  defaults: Readonly<Record<string, number>>;
  /** Rows drawn wherever they are, with a row either side: what's focused, what's about to be. */
  pinned: readonly string[];
  /** False: every row is drawn, and nothing here does anything but go to the top for a new search. */
  enabled: boolean;
  /** The rows' sort, if they can be sorted another way: a new one isn't kept in place. */
  sort?: string;
  /** The search, and dates if there are any: a new one is shown from the top. */
  search: string;
}): WindowedRows {
  const { keys, kinds, defaults, pinned, enabled, sort, search } = o;
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);

  // What's in view: the rows' pixels from `top`, as tall as `height`, in steps of STEP.
  const [view, setView] = useState(() => ({ top: 0, height: window.innerHeight }));
  // Rows drawn now, by key: how tall each measured. Kept in a ref as the observer reports, and copied
  // into state (so a change draws again) when any differs.
  const sizes = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());

  const index = useMemo(() => new Map(keys.map((k, i) => [k, i])), [keys]);
  // A kind's usual height, by the rows of it drawn now or, if none are, those drawn last (only the rows drawn now
  // are measured), in this density.
  const { density } = usePrefs();
  const [learner] = useState(heightLearner);
  const tops = useMemo(
    () => (enabled ? learner({ keys, kinds, index, measured, defaults, density }) : layout(0, () => 0)),
    [enabled, learner, keys, kinds, index, measured, defaults, density],
  );

  const ranges = useMemo<Range[]>(() => {
    if (!enabled) return keys.length ? [[0, keys.length]] : [];
    const pins = pinned.map((k) => index.get(k) ?? -1);
    return windowRows(tops, view.top - OVERSCAN, view.top + view.height + STEP + OVERSCAN, pins);
  }, [enabled, keys.length, pinned, index, tops, view]);

  /** Where the scroller is now, in steps; the same object if nothing's changed. */
  const latestView = useRef(view);
  // The layout last drawn: how tall each row was taken to be.
  const drawnLayout = useRef({ index, tops });
  useLayoutEffect(() => {
    latestView.current = view;
    drawnLayout.current = { index, tops };
  });
  const where = useCallback(() => {
    const el = scroller.current;
    if (!el) return latestView.current;
    const headH = head.current?.offsetHeight ?? 0;
    const top = Math.floor(el.scrollTop / STEP) * STEP;
    const height = Math.max(0, el.clientHeight - headH);
    const v = latestView.current;
    return v.top === top && v.height === height ? v : { top, height };
  }, []);

  // The layout last drawn, and where the table was scrolled to then (or since).
  const before = useRef<{ tops: Float64Array; keys: readonly string[]; top: number; sort: string | undefined; search: string } | null>(null);

  // Follow scrolling (a frame at a time) and size changes, drawing in the same frame.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = where();
      if (next !== latestView.current) flushSync(() => setView(next));
    };
    const onScroll = () => {
      if (before.current) before.current.top = el.scrollTop;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resized = new ResizeObserver(update);
    resized.observe(el);
    if (head.current) resized.observe(head.current);
    el.addEventListener("scroll", onScroll, { passive: true });
    const next = where();
    if (next !== latestView.current) setView(next);
    return () => {
      resized.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled, where]);

  // Rows report their height as they're drawn, and when it changes; a change is drawn in the next frame, before
  // it's painted (drawn at once, rows that come into view would be observed too late for this frame: the browser
  // reports that as an error), and the view kept in place then (below).
  const observer = useRef<ResizeObserver | null>(null);
  const measuring = useRef(0);
  const observe = useCallback((el: HTMLElement) => {
    observer.current ??= new ResizeObserver((entries) => {
      // Drawn again only if a row isn't as tall as it was taken to be.
      const { index, tops } = drawnLayout.current;
      let changed = false;
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.rowKey;
        const h = e.borderBoxSize?.[0]?.blockSize ?? e.target.getBoundingClientRect().height;
        if (!key || !e.target.isConnected || sizes.current.get(key) === h) continue;
        sizes.current.set(key, h);
        const i = index.get(key);
        if (i === undefined || i + 1 >= tops.length || tops[i + 1] - tops[i] !== h) changed = true;
      }
      if (changed && !measuring.current) {
        measuring.current = requestAnimationFrame(() => {
          measuring.current = 0;
          flushSync(() => setMeasured(new Map(sizes.current)));
        });
      }
    });
    observer.current.observe(el);
  }, []);
  useLayoutEffect(
    () => () => {
      observer.current?.disconnect();
      cancelAnimationFrame(measuring.current);
    },
    [],
  );
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const measure = useCallback(
    (key: string) => {
      // Every row drawn, nothing to measure.
      if (!enabled) return none;
      let ref = refs.current.get(key);
      if (!ref) {
        let drawnAs: HTMLElement | null = null;
        const self: (el: HTMLElement | null) => void = (el) => {
          if (drawnAs) observer.current?.unobserve(drawnAs);
          drawnAs = el;
          if (el) {
            refs.current.set(key, self); // drawn again in a new place: the same function still
            observe(el);
          } else {
            sizes.current.delete(key);
            refs.current.delete(key);
          }
        };
        ref = self;
        refs.current.set(key, ref);
      }
      return ref;
    },
    [enabled, observe],
  );

  // A new search or new dates: their rows from the top, drawn there at once (kept in place below, the view would
  // stay among rows that happened to be where it was, with matches above it and nothing to say so).
  const searched = useRef(search);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (searched.current === search) return;
    searched.current = search;
    if (!el || el.scrollTop === 0) return;
    el.scrollTop = 0;
    const next = enabled ? where() : latestView.current;
    if (next !== latestView.current) setView(next);
  }, [search, enabled, where]);

  // Keep the view in place: the row at its top before this change is where it was. Rows above it that were
  // measured, added or removed (someone else's save), or that changed kind's usual height, would push it. Not if
  // the change scrolled the table itself (focus put back in a row that moved, say): that's where it's meant to be.
  // Nor if it's a new sort, search or dates: the rows are put in a new order, or start from the top (above).
  useLayoutEffect(() => {
    const el = scroller.current;
    const was = before.current;
    const now = enabled && el ? { tops, keys, top: el.scrollTop, sort, search } : null;
    before.current = now;
    if (!el || !was || !now || (was.tops === tops && was.keys === keys) || was.sort !== sort || was.search !== search) return;
    const s = now.top;
    if (s !== was.top) return;
    // The row there, or the first after it that's still there and not sorted elsewhere by the change (windowMath.ts).
    const at = anchorRow(was.keys, was.tops, s, index);
    if (!at) return;
    const moved = tops[at.is] - was.tops[at.was];
    if (Math.abs(moved) >= 1) now.top = el.scrollTop = s + moved;
  });

  const scrollTo = useCallback(
    (key: string, align: "nearest" | "center" = "nearest") => {
      const el = scroller.current;
      const i = index.get(key);
      if (!el || i === undefined) return false;
      if (!enabled) return true;
      const height = Math.max(0, el.clientHeight - (head.current?.offsetHeight ?? 0));
      const [top, bottom] = [tops[i], tops[i + 1]];
      let s = el.scrollTop;
      if (align === "center") s = top - Math.max(0, height - (bottom - top)) / 2;
      else if (top < s) s = top;
      else if (bottom > s + height) s = bottom - height;
      el.scrollTop = Math.max(0, s);
      before.current = { tops, keys, top: el.scrollTop, sort, search }; // where it is now is where it's meant to be
      const next = where();
      if (next !== latestView.current) setView(next);
      return true;
    },
    [index, enabled, tops, keys, sort, search, where],
  );

  return {
    scroller,
    head,
    windowed: enabled,
    ranges,
    runs: (start, end) => runs(tops, start, end, ranges),
    measure,
    scrollTo,
  };
}
