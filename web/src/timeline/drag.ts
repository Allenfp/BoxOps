// The arithmetic of moving things on the timeline, by pointer or by keyboard:
// how many working days a drag of so many pixels is, the dates that gives a
// box or PTO block, and where a box being dragged lands. Pure, so it's tested
// on its own; the pointer and key handling is in components/Timeline.tsx.

import { type Day, dayOfWorkIndex, nextWorkday, workIndex } from "../model/dates";
import type { ZoomLevel } from "../model/types";
import { type DepartmentLayout, laneAtSlot } from "./layout";

/** What a drag moves: the whole thing, or one end. */
export type DragMode = "move" | "start" | "end";

/** Drags move in whole multiples of this many working days. */
export const SNAP_DAYS: Record<ZoomLevel, number> = { weeks: 1, months: 1, quarters: 5 };

/** The working days a drag of `dx` pixels moves at this zoom: a whole number of its snap. */
export function dragDays(dx: number, pxPerDay: number, zoom: ZoomLevel): number {
  const snap = SNAP_DAYS[zoom];
  return Math.round(dx / pxPerDay / snap) * snap || 0; // never -0
}

/**
 * Dates `delta` working days on. A move keeps the number of working days;
 * moving one end keeps at least one working day, the other end staying put.
 */
export function movedDates(dates: { start: Day; end: Day }, mode: DragMode, delta: number): { start: Day; end: Day } {
  const first = workIndex(nextWorkday(dates.start));
  const last = Math.max(first, workIndex(dates.end + 1) - 1);
  if (mode === "move") return { start: dayOfWorkIndex(first + delta), end: dayOfWorkIndex(last + delta) };
  if (mode === "start") return { start: dayOfWorkIndex(Math.min(first + delta, last)), end: dates.end };
  return { start: dates.start, end: dayOfWorkIndex(Math.max(last + delta, first)) };
}

/**
 * The slot the top of a box being dragged lands on: the slot under the
 * pointer less the one it was held by (a tall box held by its lower half),
 * kept inside the department's lanes, so a 2-FTE box over the last lane
 * stays in the department.
 */
export function dropSlot(pointerSlot: number, grabSlot: number, need: number, capacity: number): number {
  return Math.max(0, Math.min(pointerSlot - grabSlot, capacity - need));
}

/**
 * The lane a box being dragged goes to, with the pointer `slot` slots from
 * the top of the department under it (`layout`) and `dy` pixels above (−)
 * or below where it was pressed, slots being `slotH` pixels tall. Within
 * half a slot up or down it's the box's `own` lane, whichever part of the
 * box was held and wherever the layout drew it: a sideways drag never
 * changes a box's lane. Undefined: the pointer is outside the department's
 * lanes, and the lane stays as it was.
 */
export function dropLane(
  layout: DepartmentLayout,
  pointer: { slot: number; dy: number },
  grab: { slot: number; need: number; own: string },
  slotH: number,
): string | undefined {
  if (Math.abs(pointer.dy) <= slotH / 2) return grab.own;
  if (pointer.slot < 0 || pointer.slot >= layout.capacity) return undefined;
  return laneAtSlot(layout, dropSlot(pointer.slot, grab.slot, grab.need, layout.capacity));
}

/** Where a box in `lane` is drawn while it's dragged there: the lane's first slot, or higher if it would run past the last lane. */
export function previewSlot(layout: DepartmentLayout, lane: string, need: number): number {
  const at = layout.lanes.get(lane)?.slot ?? 0;
  return Math.max(0, Math.min(at, layout.capacity - need));
}
