// What the timeline draws in a department, row by row, as plain data: the
// row each box is drawn in (layout.ts finds the room), and the order of its
// PTO blocks (components/Timeline.tsx).

import type { Box, Person, TimeOff } from "../model/types";
import { type DepartmentLayout, type Placed, laneAtSlot, slotsOf } from "./layout";
import { previewSlot } from "./drag";

/** The row of a department's extra area, below its lanes. */
export const OVERFLOW = "overflow";

/** A box, and where the layout draws it. */
export interface Drawn {
  box: Box;
  at: Placed;
}

/** One PTO entry: whose, which of theirs, and its dates (model/pto.ts's ptoEntries). */
export interface PtoEntry {
  person: Person;
  index: number;
  pto: TimeOff;
}

/**
 * Each box by the row it's drawn in: its lane's id (its own lane, or wherever
 * the layout found room), or OVERFLOW; in time order. A box being dragged to
 * another lane (`moving`, the box as it was and the lane it's over) is drawn
 * in that lane's row, at the top of the room there, and not in its own.
 */
export function boxRows(layout: DepartmentLayout, boxes: Box[], moving?: { box: Box; lane: string } | null): Map<string, Drawn[]> {
  const rows = new Map<string, Drawn[]>();
  const add = (row: string, box: Box, at: Placed) => rows.set(row, [...(rows.get(row) ?? []), { box, at }]);
  const away = moving && moving.lane !== moving.box.lane ? moving : null;
  for (const b of boxes) {
    const at = layout.boxes.get(b.id);
    if (!at || away?.box.id === b.id) continue;
    add(at.overflow ? OVERFLOW : (laneAtSlot(layout, at.slot) ?? OVERFLOW), b, at);
  }
  if (away && layout.lanes.has(away.lane)) {
    const need = slotsOf(away.box.fte);
    add(away.lane, away.box, { slot: previewSlot(layout, away.lane, need), slots: need, overflow: false });
  }
  for (const list of rows.values()) list.sort((a, b) => a.box.start - b.box.start || a.at.slot - b.at.slot);
  return rows;
}

/** PTO blocks in the order they're drawn: by start, then end. */
export const ptoOrder = (entries: PtoEntry[]): PtoEntry[] => entries.toSorted((a, b) => a.pto.start - b.pto.start || a.pto.end - b.pto.end);
