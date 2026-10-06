// What the timeline draws in a department, row by row, as plain data: the
// row each box is drawn in (layout.ts finds the room), and every row's cells
// in the order the keyboard goes through them (useGridFocus.ts), drawn or
// not. And which part of a big roadmap is near enough the screen to draw:
// the timeline draws only that, plus whatever has focus or is being moved
// (components/Timeline.tsx).

import type { Day } from "../model/dates";
import type { Box, Department, Person, TimeOff } from "../model/types";
import { ptoKey } from "../model/pto";
import { type DepartmentLayout, type Placed, laneAtSlot, slotsOf } from "./layout";
import { previewSlot } from "./drag";
import type { NavCell, NavRow } from "./keyboard";

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

/** A cell as the keyboard sees it: its key (`data-cell`), and its dates if it's a box or PTO block. */
export interface GridCell extends NavCell {
  key: string;
}
export interface GridRow extends NavRow {
  cells: GridCell[];
}

const boxCell = (b: Box): GridCell => ({ key: `box:${b.id}`, start: b.start, end: b.end });

/**
 * A department's rows of the grid, and their cells, as the timeline draws them
 * when nothing is left out: its heading (with a collapsed department's chart,
 * or its boxes), then each lane (its name, its +, its boxes), the extra area
 * if it has one, and its PTO row (`pto`, null for none: the + if `addPto`,
 * then the blocks).
 */
export function deptGridRows(
  dept: Department,
  o: {
    layout: DepartmentLayout;
    rows: Map<string, Drawn[]>;
    boxes: Box[];
    collapsed: boolean;
    /** A collapsed department shows its capacity chart, not its boxes. */
    chart: boolean;
    /** Its heading has an ✎. */
    editable: boolean;
    pto: PtoEntry[] | null;
    addPto: boolean;
  },
): GridRow[] {
  const heading: GridCell[] = [{ key: `dept:${dept.id}` }, ...(o.editable ? [{ key: `dept-edit:${dept.id}` }] : [])];
  if (o.collapsed) {
    const inside = o.chart ? [{ key: `chart:${dept.id}` }] : o.boxes.toSorted((a, b) => a.start - b.start).map(boxCell);
    return [{ heading: true, cells: [...heading, ...inside] }];
  }
  const drawn = (row: string) => (o.rows.get(row) ?? []).map((d) => boxCell(d.box));
  return [
    { heading: true, cells: heading },
    ...dept.lanes.map((l) => ({ heading: false, cells: [{ key: `lane:${l.id}` }, { key: `lane-add:${l.id}` }, ...drawn(l.id)] })),
    ...(o.layout.height > o.layout.capacity ? [{ heading: false, cells: drawn(OVERFLOW) }] : []),
    ...(o.pto
      ? [
          {
            heading: false,
            cells: [
              ...(o.addPto ? [{ key: `pto-add:${dept.id}` }] : []),
              ...ptoOrder(o.pto).map((e) => ({ key: `pto:${ptoKey({ personId: e.person.id, index: e.index })}`, start: e.pto.start, end: e.pto.end })),
            ],
          },
        ]
      : []),
  ];
}

/**
 * The stretch of the timeline (pixels along the scroller: down from the top
 * of the rows, or across from the start of the dates) to draw, for `size`
 * pixels on screen from `scroll`: what's on screen and about half as much
 * again or more on each side, in steps of half a screen. Scrolling within a
 * step changes nothing, so nothing is drawn again until a new step comes near.
 */
export function drawRange(scroll: number, size: number): [number, number] {
  const step = Math.max(200, Math.round(size / 2));
  return [Math.floor(scroll / step) * step - step, Math.ceil((scroll + size) / step) * step + step];
}

/** The days a box or block runs overlap [from, to]. */
export const overlaps = (start: Day, end: Day, from: Day, to: Day): boolean => start <= to && end >= from;
