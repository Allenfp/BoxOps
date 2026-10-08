// Time ↔ pixel mapping and header bands for each zoom level. The x axis counts
// working days only: weekends take no space at any zoom.

import {
  type Day,
  addMonths,
  dayParts,
  dayOfWorkIndex,
  isWeekend,
  monthName,
  nextWorkday,
  quarterLabel,
  quarterName,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  workIndex,
} from "../model/dates";
import type { Box, ZoomLevel } from "../model/types";

/** Pixels per working day (a week is five of these). */
export const PX_PER_DAY: Record<ZoomLevel, number> = {
  weeks: 40,
  months: 14.7,
  quarters: 4.5,
};

export interface Segment {
  start: Day;
  /** Exclusive. */
  end: Day;
  label: string;
  /** A month's or quarter's name without its year ("Aug", "Q3"), for where its label doesn't fit (labelsCut). */
  short?: string;
}

export interface Scale {
  zoom: ZoomLevel;
  /** First visible day. */
  start: Day;
  /** Exclusive. */
  end: Day;
  /** Pixels per working day. */
  pxPerDay: number;
  width: number;
  /** Left edge of `day` (a weekend day sits at the following Monday's edge). */
  x(day: Day): number;
  /** Width of the working days from `start` to `end`, inclusive. */
  span(start: Day, end: Day): number;
  /** The working day under `x`. */
  dayAt(x: number): Day;
}

export function makeScale(start: Day, end: Day, zoom: ZoomLevel): Scale {
  const pxPerDay = PX_PER_DAY[zoom];
  const origin = workIndex(start);
  return {
    zoom,
    start,
    end,
    pxPerDay,
    width: (workIndex(end) - origin) * pxPerDay,
    x: (day) => (workIndex(day) - origin) * pxPerDay,
    span: (s, e) => (workIndex(e + 1) - workIndex(s)) * pxPerDay,
    dayAt: (x) => dayOfWorkIndex(origin + Math.floor(x / pxPerDay)),
  };
}

/**
 * The visible date range: every box plus today, with breathing room, snapped to
 * whole (fiscal) quarters so every zoom level starts on a clean boundary.
 */
export function timelineRange(boxes: Box[], todayDay: Day, fyStartMonth: number): [Day, Day] {
  let min = todayDay;
  let max = todayDay;
  for (const b of boxes) {
    min = Math.min(min, b.start);
    max = Math.max(max, b.end);
  }
  const start = startOfQuarter(min - 45, fyStartMonth);
  const end = addMonths(startOfQuarter(max + 90, fyStartMonth), 3);
  return [start, end];
}

/** Split [start, end) at each boundary returned by `next`. */
function segments(start: Day, end: Day, first: Day, next: (d: Day) => Day, label: (d: Day) => string, short?: (d: Day) => string): Segment[] {
  const out: Segment[] = [];
  for (let s = first; s < end; s = next(s)) {
    const e = next(s);
    out.push({ start: Math.max(s, start), end: Math.min(e, end), label: label(s), ...(short && { short: short(s) }) });
  }
  return out;
}

const months = (start: Day, end: Day, label: (d: Day) => string, short?: (d: Day) => string) =>
  segments(start, end, startOfMonth(start), (d) => addMonths(d, 1), label, short);
const month = (d: Day) => monthName(dayParts(d).month);
const monthAndYear = (d: Day) => `${month(d)} ${dayParts(d).year}`;

const nextWeekday = (d: Day): Day => {
  let n = d + 1;
  while (isWeekend(n)) n++;
  return n;
};

/** Two header bands, coarse on top and fine below; the fine band also draws the grid. */
export function headerBands(scale: Scale, fyStartMonth: number): [Segment[], Segment[]] {
  const { start, end } = scale;
  switch (scale.zoom) {
    case "weeks":
      return [months(start, end, monthAndYear, month), segments(start, end, nextWorkday(start), nextWeekday, (d) => String(dayParts(d).day))];
    case "months":
      return [months(start, end, monthAndYear, month), segments(start, end, startOfWeek(start), (d) => d + 7, (d) => String(dayParts(d).day))];
    case "quarters":
      return [
        segments(
          start,
          end,
          startOfQuarter(start, fyStartMonth),
          (d) => addMonths(d, 3),
          (d) => quarterLabel(d, fyStartMonth),
          (d) => quarterName(d, fyStartMonth),
        ),
        months(start, end, month),
      ];
  }
}

/** How a label along the top is cut short: to its short form ("Aug", "Q3"), or to nothing. */
export type LabelCut = "short" | "none";

/**
 * The top band's labels that don't fit whole on screen, by their cells' start: each stays at the
 * label column's edge while its cell's days scroll by (the stylesheet's sticky), so it has from
 * there, or from its cell's start, to the next cell's start or the screen's edge. Too little room
 * for its label, it's short, else nothing (none never shows cut off). `left` and `right`: the
 * band's pixels on screen; `width`: a label's as drawn, with the room it keeps either side.
 */
export function labelsCut(cells: Segment[], scale: Scale, left: number, right: number, width: (label: string) => number): Map<Day, LabelCut> {
  const cut = new Map<Day, LabelCut>();
  for (const cell of cells) {
    const room = Math.min(scale.x(cell.end), right) - Math.max(scale.x(cell.start), left);
    if (width(cell.label) <= room) continue;
    cut.set(cell.start, cell.short !== undefined && width(cell.short) <= room ? "short" : "none");
  }
  return cut;
}
