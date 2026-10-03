// Where boxes go inside a department. A department is a stack of capacity in
// half-FTE slots: a 1-FTE lane is two slots, a 0.5-FTE lane one. A box sits in
// its own lane and is as tall as its FTE, so a 2-FTE box also covers the lane
// below and two 0.5 boxes can share a lane. A box that can't fit (its lane, or
// a lane it would extend into, is taken at that time) goes into an "over
// capacity" area under the lanes.

import type { Day } from "../model/dates";
import type { Box, Department } from "../model/types";

export interface Placed {
  /** First half-FTE slot from the top of the department. */
  slot: number;
  /** Height in half-FTE slots. */
  slots: number;
  overflow: boolean;
}

export interface DepartmentLayout {
  /** First slot of each lane, and its height in slots. */
  lanes: Map<string, { slot: number; slots: number }>;
  /** Slots of real capacity (the lanes). */
  capacity: number;
  /** Total slots drawn, including any over-capacity area. */
  height: number;
  boxes: Map<string, Placed>;
}

const slotsOf = (fte: number) => Math.max(1, Math.round(fte * 2));

export function layoutDepartment(dept: Department, boxes: Box[]): DepartmentLayout {
  const lanes = new Map<string, { slot: number; slots: number }>();
  let capacity = 0;
  for (const lane of dept.lanes) {
    const slots = slotsOf(lane.fte);
    lanes.set(lane.id, { slot: capacity, slots });
    capacity += slots;
  }

  // Greedy in start order: a slot is free for a box if whatever was last put
  // there ended before the box starts.
  const lastEnd: Day[] = [];
  const free = (from: number, count: number, start: Day) => {
    for (let s = from; s < from + count; s++) if ((lastEnd[s] ?? -Infinity) >= start) return false;
    return true;
  };
  const take = (from: number, count: number, end: Day) => {
    for (let s = from; s < from + count; s++) lastEnd[s] = end;
  };

  const laneOrder = new Map(dept.lanes.map((l, i) => [l.id, i]));
  const sorted = boxes
    .filter((b) => lanes.has(b.lane))
    .sort((a, b) => a.start - b.start || laneOrder.get(a.lane)! - laneOrder.get(b.lane)! || a.id.localeCompare(b.id));

  const placed = new Map<string, Placed>();
  let height = capacity;
  for (const b of sorted) {
    const lane = lanes.get(b.lane)!;
    const need = slotsOf(b.fte);
    let slot = -1;
    // Anywhere that starts inside its own lane (a half box can use either half)…
    for (let s = lane.slot; s < lane.slot + lane.slots && slot < 0; s++) {
      if (s + need <= capacity && free(s, need, b.start)) slot = s;
    }
    // …otherwise the first free spot in the over-capacity area.
    const overflow = slot < 0;
    if (overflow) {
      slot = capacity;
      while (!free(slot, need, b.start)) slot++;
    }
    take(slot, need, b.end);
    placed.set(b.id, { slot, slots: need, overflow });
    height = Math.max(height, slot + need);
  }
  return { lanes, capacity, height, boxes: placed };
}

/** The lane under a slot, or undefined in the over-capacity area. */
export function laneAtSlot(layout: DepartmentLayout, slot: number): string | undefined {
  for (const [id, l] of layout.lanes) if (slot >= l.slot && slot < l.slot + l.slots) return id;
  return undefined;
}
