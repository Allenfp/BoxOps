// The table's and People's rows as plain data, in the order they're shown:
// each department's heading, then its rows. The views draw only some of
// them on a big roadmap (useWindowedRows.ts), so every row has a key and an
// index of its own, drawn or not, and each department's rows are one run of
// indexes (its <tbody>).

import type { Box, Department, Person } from "../model/types";
import type { PtoEntry } from "../timeline/rows";

/** A row of the table, of one kind or another. A department heading's key starts with "g:". */
export type TableRow =
  | { kind: "group"; key: string; dept: Department }
  | { kind: "box"; key: string; box: Box; held: boolean }
  | { kind: "empty"; key: string; dept: Department }
  | { kind: "pto"; key: string; entry: PtoEntry; held: boolean }
  | { kind: "add-pto"; key: string; dept: Department }
  | { kind: "add-dept"; key: string };

/** A <tbody>: a department's rows (`start` to `end`), or the last one, with Add department. */
export interface Group {
  id: string;
  start: number;
  end: number;
}

export interface Rows<R> {
  rows: R[];
  groups: Group[];
  keys: string[];
  kinds: string[];
}

function rowsOf<R extends { kind: string; key: string }>(rows: R[], groups: Group[]): Rows<R> {
  return { rows, groups, keys: rows.map((r) => r.key), kinds: rows.map((r) => r.kind) };
}

/**
 * The table's rows: each department's heading; unless it's collapsed, its
 * boxes (or a row saying it has none), its PTO and Add PTO; and Add
 * department last. While searching (or filtering by date), a department with
 * nothing that matches isn't shown, and nothing is added from the table.
 */
export function tableRows(o: {
  departments: readonly Department[];
  /** Each department's boxes as shown (filtered and sorted), by its id, with their keys. */
  boxes: ReadonlyMap<string, readonly { box: Box; key: string; held: boolean }[]>;
  /** Each department's PTO rows as shown. */
  pto: ReadonlyMap<string, readonly { entry: PtoEntry; key: string; held: boolean }[]>;
  collapsed: ReadonlySet<string>;
  searching: boolean;
  /** Which departments have Add PTO. */
  addPto(dept: Department): boolean;
  addDepartment: boolean;
}): Rows<TableRow> {
  const rows: TableRow[] = [];
  const groups: Group[] = [];
  for (const dept of o.departments) {
    const boxes = o.boxes.get(dept.id) ?? [];
    const pto = o.pto.get(dept.id) ?? [];
    if (o.searching && boxes.length === 0 && pto.length === 0) continue;
    const start = rows.length;
    rows.push({ kind: "group", key: `g:${dept.id}`, dept });
    if (!o.collapsed.has(dept.id) || o.searching) {
      if (boxes.length === 0) rows.push({ kind: "empty", key: `e:${dept.id}`, dept });
      for (const b of boxes) rows.push({ kind: "box", ...b });
      for (const p of pto) rows.push({ kind: "pto", ...p });
      if (!o.searching && o.addPto(dept)) rows.push({ kind: "add-pto", key: `a:${dept.id}`, dept });
    }
    groups.push({ id: dept.id, start, end: rows.length });
  }
  if (o.addDepartment && !o.searching) {
    groups.push({ id: "add-dept", start: rows.length, end: rows.length + 1 });
    rows.push({ kind: "add-dept", key: "add-dept" });
  }
  return rowsOf(rows, groups);
}

/**
 * Whether a person's row in People takes two lines: their notes (two lines,
 * … for more, until focused), or PTO past one entry (two lines at most: both
 * entries, or the next and "+N more"). Every other row takes one.
 */
export const twoLines = (p: Person): boolean => !!p.notes?.trim() || (p.pto?.length ?? 0) > 1;

/** A row of People. */
export type PeopleRow =
  | { kind: "group"; key: string; id: string; name: string; color: string; shown: number; total: number }
  | { kind: "person"; key: string; person: Person; held: boolean }
  | { kind: "empty"; key: string; id: string; name: string }
  | { kind: "add-dept"; key: string };

/**
 * People's rows: each department's heading (and No department's, if anyone
 * has none), then its engineers unless it's collapsed (or a row saying it has
 * none); Add department last. While searching, a department with nobody who
 * matches isn't shown, nor Add department. A person's row is of the kind
 * "person", or "person-2" when it takes two lines (twoLines): rows of a kind
 * are one height, for drawing only some of them.
 */
export function peopleRows(o: {
  groups: readonly { id: string; name: string; color: string; total: number; people: readonly { person: Person; key: string; held: boolean }[] }[];
  collapsed: ReadonlySet<string>;
  searching: boolean;
  addDepartment: boolean;
}): Rows<PeopleRow> {
  const rows: PeopleRow[] = [];
  const groups: Group[] = [];
  for (const g of o.groups) {
    if (o.searching && g.people.length === 0) continue;
    const start = rows.length;
    rows.push({ kind: "group", key: `g:${g.id}`, id: g.id, name: g.name, color: g.color, shown: g.people.length, total: g.total });
    if (!o.collapsed.has(g.id) || o.searching) {
      if (g.people.length === 0) rows.push({ kind: "empty", key: `e:${g.id}`, id: g.id, name: g.name });
      for (const p of g.people) rows.push({ kind: "person", ...p });
    }
    groups.push({ id: g.id, start, end: rows.length });
  }
  if (o.addDepartment && !o.searching) {
    groups.push({ id: "add-dept", start: rows.length, end: rows.length + 1 });
    rows.push({ kind: "add-dept", key: "add-dept" });
  }
  const r = rowsOf(rows, groups);
  return { ...r, kinds: rows.map((row) => (row.kind === "person" && twoLines(row.person) ? "person-2" : row.kind)) };
}

/**
 * `list` with the item `key` (if it's there) kept where it was in `before`, the
 * order last shown: just after the item that came before it then and is still
 * there, or first. A row stays put while it's being edited, though a change to
 * it would sort it elsewhere.
 */
export function keepPlace<T>(list: readonly T[], keyOf: (item: T) => string, before: readonly string[], key: string | null): T[] {
  const i = key === null ? -1 : list.findIndex((item) => keyOf(item) === key);
  const was = key === null ? -1 : before.indexOf(key);
  if (i < 0 || was < 0) return [...list];
  const rest = list.filter((_, j) => j !== i);
  const there = new Set(rest.map(keyOf));
  let after = -1;
  for (let k = was - 1; k >= 0; k--) {
    if (!there.has(before[k])) continue;
    after = rest.findIndex((item) => keyOf(item) === before[k]);
    break;
  }
  rest.splice(after + 1, 0, list[i]);
  return rest;
}
