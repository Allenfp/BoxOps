// Time ↔ pixel mapping and header bands for each zoom level.

import {
  type Day,
  addMonths,
  dayParts,
  monthName,
  quarterLabel,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "../model/dates";
import type { Box, ZoomLevel } from "../model/types";

export const PX_PER_DAY: Record<ZoomLevel, number> = {
  weeks: 36,
  months: 7,
  quarters: 2.2,
};

export interface Segment {
  start: Day;
  /** Exclusive. */
  end: Day;
  label: string;
}

export interface Scale {
  zoom: ZoomLevel;
  /** First visible day. */
  start: Day;
  /** Exclusive. */
  end: Day;
  pxPerDay: number;
  width: number;
  x(day: Day): number;
  dayAt(x: number): Day;
}

export function makeScale(start: Day, end: Day, zoom: ZoomLevel): Scale {
  const pxPerDay = PX_PER_DAY[zoom];
  return {
    zoom,
    start,
    end,
    pxPerDay,
    width: (end - start) * pxPerDay,
    x: (day) => (day - start) * pxPerDay,
    dayAt: (x) => start + Math.floor(x / pxPerDay),
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
function segments(start: Day, end: Day, first: Day, next: (d: Day) => Day, label: (d: Day) => string): Segment[] {
  const out: Segment[] = [];
  for (let s = first; s < end; s = next(s)) {
    const e = next(s);
    out.push({ start: Math.max(s, start), end: Math.min(e, end), label: label(s) });
  }
  return out;
}

const months = (start: Day, end: Day, label: (d: Day) => string) =>
  segments(start, end, startOfMonth(start), (d) => addMonths(d, 1), label);

/** Two header bands, coarse on top and fine below; the fine band also draws the grid. */
export function headerBands(scale: Scale, fyStartMonth: number): [Segment[], Segment[]] {
  const { start, end } = scale;
  switch (scale.zoom) {
    case "weeks":
      return [
        months(start, end, (d) => `${monthName(dayParts(d).month)} ${dayParts(d).year}`),
        segments(start, end, start, (d) => d + 1, (d) => String(dayParts(d).day)),
      ];
    case "months":
      return [
        months(start, end, (d) => `${monthName(dayParts(d).month)} ${dayParts(d).year}`),
        segments(start, end, startOfWeek(start), (d) => d + 7, (d) => String(dayParts(d).day)),
      ];
    case "quarters":
      return [
        segments(
          start,
          end,
          startOfQuarter(start, fyStartMonth),
          (d) => addMonths(d, 3),
          (d) => quarterLabel(d, fyStartMonth),
        ),
        months(start, end, (d) => monthName(dayParts(d).month)),
      ];
  }
}

/**
 * Assign overlapping boxes in one lane to stacked rows (first row that is free).
 * More than one row means the lane is over-allocated somewhere.
 */
export function packRows(boxes: Box[]): { row: Map<string, number>; rows: number } {
  const sorted = [...boxes].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const rowEnds: Day[] = [];
  const row = new Map<string, number>();
  for (const b of sorted) {
    let r = rowEnds.findIndex((end) => end < b.start);
    if (r === -1) r = rowEnds.length;
    rowEnds[r] = b.end;
    row.set(b.id, r);
  }
  return { row, rows: Math.max(1, rowEnds.length) };
}
