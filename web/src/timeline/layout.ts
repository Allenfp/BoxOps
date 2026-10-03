// Where boxes go inside a department, and whether it's over capacity.
//
// A department is a stack of capacity in half-FTE slots: a 1-FTE lane is two
// slots, a 0.5-FTE lane one. A box is as tall as its FTE.
//
// Over capacity is plain arithmetic: on some day, the FTE of the boxes running
// is more than the department's lanes add up to.
//
// Drawing is separate. A box goes in its own lane when there's room there;
// otherwise in the nearest free space in the department (boxes are FTE, not
// people, so any free lane is as good). Several placement orders are tried and
// the tidiest kept. Only when the department really is over capacity (or, very
// rarely, when free space is split up so a box can't sit in one piece) does a
// box go into the extra area below the lanes.

import type { Day } from "../model/dates";
import type { Box, Department } from "../model/types";

export interface Placed {
  /** First half-FTE slot from the top of the department. */
  slot: number;
  /** Height in half-FTE slots. */
  slots: number;
  /** Drawn in the extra area below the lanes. */
  overflow: boolean;
}

export interface DepartmentLayout {
  /** First slot of each lane, and its height in slots. */
  lanes: Map<string, { slot: number; slots: number }>;
  /** Slots of real capacity (the lanes). */
  capacity: number;
  /** Total slots drawn, including any extra area. */
  height: number;
  boxes: Map<string, Placed>;
  /** Some day has more FTE planned than the department's lanes hold. */
  overCapacity: boolean;
  /** Most FTE in use on any one day. */
  peakFte: number;
}

const slotsOf = (fte: number) => Math.max(1, Math.round(fte * 2));

/** Most half-FTE slots in use on any day (a sweep over start/end events). */
function peakSlots(boxes: Box[]): number {
  const events: [Day, number][] = [];
  for (const b of boxes) {
    events.push([b.start, slotsOf(b.fte)], [b.end + 1, -slotsOf(b.fte)]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts on the same day
  let load = 0;
  let peak = 0;
  for (const [, delta] of events) {
    load += delta;
    peak = Math.max(peak, load);
  }
  return peak;
}

interface Attempt {
  boxes: Map<string, Placed>;
  height: number;
  /** Lower is better: boxes in the extra area, then extra height, then boxes away from their lane. */
  score: [number, number, number];
}

function place(order: Box[], lanes: DepartmentLayout["lanes"], capacity: number): Attempt {
  const used: [Day, Day][][] = []; // per slot, the date ranges taken
  const free = (from: number, count: number, b: Box) => {
    for (let s = from; s < from + count; s++) {
      for (const [start, end] of used[s] ?? []) if (start <= b.end && b.start <= end) return false;
    }
    return true;
  };
  const take = (from: number, count: number, b: Box) => {
    for (let s = from; s < from + count; s++) (used[s] ??= []).push([b.start, b.end]);
  };

  const boxes = new Map<string, Placed>();
  let height = capacity;
  let overflowed = 0;
  let awayFromLane = 0;
  for (const b of order) {
    const lane = lanes.get(b.lane)!;
    const need = slotsOf(b.fte);
    const fits = (s: number) => s >= 0 && s + need <= capacity && free(s, need, b);
    let slot = -1;
    // Its own lane first (a half box can use either half)…
    for (let s = lane.slot; s < lane.slot + lane.slots && slot < 0; s++) if (fits(s)) slot = s;
    // …then the nearest free space anywhere in the department.
    for (let d = 1; slot < 0 && d <= capacity; d++) {
      if (fits(lane.slot - d)) slot = lane.slot - d;
      else if (fits(lane.slot + d)) slot = lane.slot + d;
    }
    if (slot >= 0 && (slot < lane.slot || slot >= lane.slot + lane.slots)) awayFromLane++;
    const overflow = slot < 0;
    if (overflow) {
      overflowed++;
      slot = capacity;
      while (!free(slot, need, b)) slot++;
    }
    take(slot, need, b);
    boxes.set(b.id, { slot, slots: need, overflow });
    height = Math.max(height, slot + need);
  }
  return { boxes, height, score: [overflowed, height - capacity, awayFromLane] };
}

const better = (a: Attempt, b: Attempt) => {
  for (let i = 0; i < 3; i++) if (a.score[i] !== b.score[i]) return a.score[i] < b.score[i];
  return false;
};

export function layoutDepartment(dept: Department, boxes: Box[]): DepartmentLayout {
  const lanes = new Map<string, { slot: number; slots: number }>();
  let capacity = 0;
  for (const lane of dept.lanes) {
    const slots = slotsOf(lane.fte);
    lanes.set(lane.id, { slot: capacity, slots });
    capacity += slots;
  }

  const mine = boxes.filter((b) => lanes.has(b.lane));
  const laneOrder = new Map(dept.lanes.map((l, i) => [l.id, i]));
  const byStart = (a: Box, b: Box) =>
    a.start - b.start || laneOrder.get(a.lane)! - laneOrder.get(b.lane)! || a.id.localeCompare(b.id);
  const orders = [
    [...mine].sort(byStart), // as things happen
    [...mine].sort((a, b) => b.fte - a.fte || byStart(a, b)), // big boxes claim space first
    [...mine].sort((a, b) => b.end - b.start - (a.end - a.start) || byStart(a, b)), // long boxes first
  ];
  let best = place(orders[0], lanes, capacity);
  for (const order of orders.slice(1)) {
    if (best.score[0] === 0 && best.score[2] === 0) break; // already perfect
    const attempt = place(order, lanes, capacity);
    if (better(attempt, best)) best = attempt;
  }

  const peak = peakSlots(mine);
  return {
    lanes,
    capacity,
    height: best.height,
    boxes: best.boxes,
    overCapacity: peak > capacity,
    peakFte: peak / 2,
  };
}

/** The lane under a slot, or undefined in the extra area. */
export function laneAtSlot(layout: DepartmentLayout, slot: number): string | undefined {
  for (const [id, l] of layout.lanes) if (slot >= l.slot && slot < l.slot + l.slots) return id;
  return undefined;
}
