// Lanes with dates: a lane can open on a `start` day (a new hire) and close
// after an `end` day (a contractor leaving). Outside those days it holds no
// capacity, and boxes aren't drawn in it.

import { type Day, prettyDay } from "./dates";
import type { Department, Lane } from "./types";

/** Before any roadmap date / after any roadmap date. */
export const NEVER_BEFORE = -1e7;
export const NEVER_AFTER = 1e7;

export const laneOpen = (lane: Lane, day: Day) =>
  (lane.start === undefined || day >= lane.start) && (lane.end === undefined || day <= lane.end);

/** The day ranges (inclusive) when a lane is closed. */
export function closedRanges(lane: Lane): [Day, Day][] {
  const out: [Day, Day][] = [];
  if (lane.start !== undefined) out.push([NEVER_BEFORE, lane.start - 1]);
  if (lane.end !== undefined) out.push([lane.end + 1, NEVER_AFTER]);
  return out;
}

/** FTE of the department's lanes open on a day. */
export const capacityOn = (dept: Department, day: Day) =>
  dept.lanes.reduce((n, l) => n + (laneOpen(l, day) ? l.fte : 0), 0);

export const hasDates = (lane: Lane) => lane.start !== undefined || lane.end !== undefined;

/** "from 2027-01-04", "until 2027-03-31", "2027-01-04 – 2027-03-31", or "" when undated. */
export function laneDates(lane: Pick<Lane, "start" | "end">): string {
  if (lane.start !== undefined && lane.end !== undefined) return `${prettyDay(lane.start)} – ${prettyDay(lane.end)}`;
  if (lane.start !== undefined) return `from ${prettyDay(lane.start)}`;
  if (lane.end !== undefined) return `until ${prettyDay(lane.end)}`;
  return "";
}

