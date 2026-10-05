// The timeline from the keyboard, the parts that are plain arithmetic and
// words: where the arrow keys go between cells, what a box or PTO block is
// called, and the lanes a box moves through. Tested on their own; the focus
// handling is components/useGridFocus.ts, the keys components/Timeline.tsx.
//
// The timeline is a grid of rows (a department's heading, each lane, its
// extra area, its PTO) whose cells are the row's controls (labels) and then
// its boxes or PTO blocks in time order. Rows hold different numbers of
// cells, so up and down go by time, not by column.

import { type Day, prettyDay, workdays } from "../model/dates";
import type { Department, TimeOff } from "../model/types";

/** A cell, as navigation sees it: boxes and PTO blocks have dates, labels don't. */
export interface NavCell {
  start?: Day;
  end?: Day;
}
export interface NavRow {
  cells: NavCell[];
  /** A department's heading (Page Up and Page Down go between these). */
  heading: boolean;
}
export interface At {
  row: number;
  col: number;
}
export type NavKey = "left" | "right" | "up" | "down" | "home" | "end" | "first" | "last" | "pageUp" | "pageDown";

const timed = (c: NavCell | undefined) => c?.start !== undefined;

/** The index of the cell nearest `day` in time (one it falls in, else the least time away, the earlier on a tie); -1 with none dated. */
export function nearest(cells: NavCell[], day: Day): number {
  let best = -1;
  let gap = Infinity;
  cells.forEach((c, i) => {
    if (!timed(c)) return;
    const d = day < c.start! ? c.start! - day : day > c.end! ? day - c.end! : 0;
    if (d < gap) [best, gap] = [i, d];
  });
  return best;
}

/**
 * Where a navigation key goes from `at`, or null where there's nowhere to
 * go (no wrapping). Left and right go along the row, but from the labels
 * into the boxes they land on the one nearest `anchor` (what's on screen),
 * not the earliest. Up and down go to the next row with cells: from a box,
 * to the cell nearest `anchor` in time (the day being looked at, kept
 * through a run of ups and downs); from a label, to the label in the same
 * place. Page Up and Page Down go to the previous or next department heading.
 */
export function navigate(rows: NavRow[], at: At, key: NavKey, anchor: Day): At | null {
  const cells = rows[at.row]?.cells ?? [];
  const cur = cells[at.col];
  const labels = (r: NavRow) => r.cells.findIndex(timed) < 0 ? r.cells.length : r.cells.findIndex(timed);
  const step = (d: 1 | -1, ok: (r: NavRow) => boolean) => {
    for (let r = at.row + d; r >= 0 && r < rows.length; r += d) if (rows[r].cells.length && ok(rows[r])) return r;
    return -1;
  };
  switch (key) {
    case "left":
      return at.col > 0 ? { row: at.row, col: at.col - 1 } : null;
    case "right": {
      if (at.col >= cells.length - 1) return null;
      if (!timed(cur) && timed(cells[at.col + 1])) return { row: at.row, col: nearest(cells, anchor) };
      return { row: at.row, col: at.col + 1 };
    }
    case "home":
      return at.col > 0 ? { row: at.row, col: 0 } : null;
    case "end":
      return at.col < cells.length - 1 ? { row: at.row, col: cells.length - 1 } : null;
    case "first": {
      const r = rows.findIndex((row) => row.cells.length);
      return r < 0 || (r === at.row && at.col === 0) ? null : { row: r, col: 0 };
    }
    case "last": {
      const r = rows.findLastIndex((row) => row.cells.length);
      return r < 0 || (r === at.row && at.col === cells.length - 1) ? null : { row: r, col: rows[r].cells.length - 1 };
    }
    case "up":
    case "down": {
      const r = step(key === "up" ? -1 : 1, () => true);
      if (r < 0) return null;
      const target = rows[r];
      const n = labels(target);
      if (!timed(cur) && n > 0) return { row: r, col: Math.min(at.col, n - 1) };
      const i = nearest(target.cells, anchor);
      return { row: r, col: i < 0 ? 0 : i };
    }
    case "pageUp":
    case "pageDown": {
      const r = step(key === "pageUp" ? -1 : 1, (row) => row.heading);
      return r < 0 ? null : { row: r, col: 0 };
    }
  }
}

/** Dates as they're said: "2026-09-14 to 2026-10-23", or the one day. */
export const spokenRange = (start: Day, end: Day) => (start === end ? prettyDay(start) : `${prettyDay(start)} to ${prettyDay(end)}`);

export const workingDays = (start: Day, end: Day) => {
  const n = workdays(start, end);
  return `${n} working day${n === 1 ? "" : "s"}`;
};

export interface BoxNameParts {
  title: string;
  /** Its full code (DE-D9U), and its Jira key when it has one. */
  code: string;
  jira?: string;
  start: Day;
  end: Day;
  fte: number;
  engineers: string[];
  /** Its flag's name (At risk); none when it's on track. */
  flag?: string;
  /** Rules it breaks. */
  rules: number;
  /** Someone else also changed it (a clash to settle on saving). */
  clash: boolean;
  /** Someone else changed it since this tab opened. */
  updated: boolean;
}

/**
 * A box's accessible name: what it is, when, how big, who, and anything
 * that needs attention ("Dagster 2.x upgrade, DE-D9U, 2026-09-14 to
 * 2026-10-23, 1 FTE, Sam Lee, At risk, breaks a rule"). What needs
 * attention is in the name, not only the description, which a screen
 * reader may be set not to read.
 */
export function boxName(p: BoxNameParts): string {
  return [
    p.title || "Untitled",
    p.jira ? `${p.jira} (${p.code})` : p.code,
    spokenRange(p.start, p.end),
    `${p.fte} FTE`,
    p.engineers.length ? p.engineers.join(", ") : "no engineer assigned",
    p.flag,
    p.rules > 0 && `breaks ${p.rules === 1 ? "a rule" : `${p.rules} rules`}`,
    p.clash && "someone else also changed it",
    p.updated && !p.clash && "changed by someone else",
  ]
    .filter(Boolean)
    .join(", ");
}

/** A PTO block's accessible name: "PTO, Sam Lee, 2026-12-14 to 2026-12-25, 10 working days, Holiday". */
export const ptoName = (person: string, pto: TimeOff) =>
  ["PTO", person, spokenRange(pto.start, pto.end), workingDays(pto.start, pto.end), pto.note?.trim()].filter(Boolean).join(", ");

/** "Data Engineering / FTE 2": a lane as the app names it (by position when it has no name). */
export function laneName(departments: Department[], laneId: string): string {
  for (const d of departments) {
    const i = d.lanes.findIndex((l) => l.id === laneId);
    if (i >= 0) return `${d.name} / ${d.lanes[i].name ?? `FTE ${i + 1}`}`;
  }
  return laneId;
}

/** The lanes a box moves through with up and down, top to bottom: those of the departments that are open. */
export function laneSequence(departments: Department[], collapsed: ReadonlySet<string>): { lane: string; dept: string }[] {
  return departments.filter((d) => !collapsed.has(d.id)).flatMap((d) => d.lanes.map((l) => ({ lane: l.id, dept: d.id })));
}
