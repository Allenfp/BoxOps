// Changing the shape of the roadmap: departments and their lanes. Plain
// functions over the draft, so each is easy to test and becomes one undo step.
//
// Nothing here ever drops work: removing a lane or department that still has
// boxes requires saying which lane they move to.

import { slugify } from "./draft";
import type { DraftState } from "./draft";
import { WINDOWS_RESERVED } from "./load";
import { deriveDeptCode } from "./relations";
import type { Department, Lane, ReservedDepartments } from "./types";

/** Colours for new departments, in the order they're handed out. */
export const DEPARTMENT_COLORS = ["#4f7cff", "#21a67a", "#a35cf0", "#e8913a", "#0d9488", "#d6457a", "#c2a100", "#8a94a6"];
/** Their names, as the colour picker says them (not "#4f7cff"). */
export const COLOR_NAMES: Record<string, string> = {
  "#4f7cff": "Blue",
  "#21a67a": "Green",
  "#a35cf0": "Purple",
  "#e8913a": "Orange",
  "#0d9488": "Teal",
  "#d6457a": "Pink",
  "#c2a100": "Gold",
  "#8a94a6": "Grey",
};

const allLaneIds = (s: DraftState) => new Set(s.departments.flatMap((d) => d.lanes.map((l) => l.id)));

/**
 * A new lane id, unique across all departments and not `reserved` (lane ids
 * in files the loader couldn't fully read). Follows the department's
 * existing pattern when there is one (`de-1`, `de-2` → `de-3`), else
 * `<department id>-<n>`.
 */
export function newLaneId(dept: Department, state: DraftState, reserved: ReadonlySet<string> = new Set()): string {
  const taken = new Set([...allLaneIds(state), ...reserved]);
  const pattern = dept.lanes.map((l) => /^(.*)-(\d+)$/.exec(l.id)).filter((m): m is RegExpExecArray => !!m);
  const prefix = pattern.length && pattern.every((m) => m[1] === pattern[0][1]) ? pattern[0][1] : dept.id;
  let n = Math.max(0, ...pattern.filter((m) => m[1] === prefix).map((m) => Number(m[2]))) + 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/**
 * Departments sorted by their `order`, renumbered 1, 2, 3…: only for a
 * reorder the user asked for. Ties keep their place in the list, which is the
 * order the views show (by name when loaded; a rename doesn't move one on
 * screen). Adding or removing one leaves the others' files alone (only the
 * order matters, so gaps and repeats are fine).
 */
function renumber(departments: Department[]): Department[] {
  return [...departments].sort((a, b) => a.order - b.order).map((d, i) => (d.order === i + 1 ? d : { ...d, order: i + 1 }));
}

const NOTHING_RESERVED: ReservedDepartments = { ids: new Set(), codes: new Set(), lanes: new Set() };

/** A new department; `reserved`: ids, codes and lane ids in files the loader couldn't fully read, which it mustn't take. */
export function addDepartment(
  state: DraftState,
  name: string,
  color?: string,
  code?: string,
  reserved: ReservedDepartments = NOTHING_RESERVED,
): { state: DraftState; id: string } {
  const taken = new Set([...state.departments.map((d) => d.id), ...reserved.ids]);
  // The id names the file, which Windows wouldn't allow for "aux", "con" and the like.
  const slug = slugify(name).replace(/^box$/, "department").replace(WINDOWS_RESERVED, "$&-dept");
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  const used = new Set(state.departments.map((d) => d.color));
  const dept: Department = {
    id,
    code: code ?? deriveDeptCode(name, new Set([...state.departments.map((d) => d.code), ...reserved.codes])),
    name: name.trim(),
    color: color ?? DEPARTMENT_COLORS.find((c) => !used.has(c)) ?? DEPARTMENT_COLORS[0],
    order: Math.max(0, ...state.departments.map((d) => d.order)) + 1,
    collapsed: false,
    lanes: [],
  };
  dept.lanes = [{ id: newLaneId(dept, state, reserved.lanes), fte: 1 }];
  return { state: { ...state, departments: [...state.departments, dept] }, id };
}

export function updateDepartment(
  state: DraftState,
  id: string,
  patch: Partial<Pick<Department, "name" | "color" | "code">>,
): DraftState {
  return { ...state, departments: state.departments.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

/** Swap a department with its neighbour above (-1) or below (+1). */
export function moveDepartment(state: DraftState, id: string, dir: -1 | 1): DraftState {
  const i = renumber(state.departments).findIndex((d) => d.id === id);
  return i < 0 ? state : placeDepartment(state, id, i + dir);
}

/** Put a department at `index` in the order (0 = first); the rest keep their order. */
export function placeDepartment(state: DraftState, id: string, index: number): DraftState {
  const sorted = renumber(state.departments);
  const i = sorted.findIndex((d) => d.id === id);
  if (i < 0 || index < 0 || index >= sorted.length || index === i) return state;
  const [dept] = sorted.splice(i, 1);
  sorted.splice(index, 0, dept!);
  return { ...state, departments: sorted.map((d, k) => (d.order === k + 1 ? d : { ...d, order: k + 1 })) };
}

/** A new lane at the end of a department; `reserved`: lane ids in files the loader couldn't fully read. */
export function addLane(state: DraftState, deptId: string, fte = 1, reserved?: ReadonlySet<string>): { state: DraftState; laneId: string } {
  const dept = state.departments.find((d) => d.id === deptId);
  if (!dept) return { state, laneId: "" };
  const lane: Lane = { id: newLaneId(dept, state, reserved), fte };
  return {
    state: { ...state, departments: state.departments.map((d) => (d.id === deptId ? { ...d, lanes: [...d.lanes, lane] } : d)) },
    laneId: lane.id,
  };
}

/** Move a lane up (-1) or down (+1) within its department. */
export function moveLane(state: DraftState, laneId: string, dir: -1 | 1): DraftState {
  return {
    ...state,
    departments: state.departments.map((d) => {
      const i = d.lanes.findIndex((l) => l.id === laneId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.lanes.length) return d;
      const lanes = [...d.lanes];
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
      return { ...d, lanes };
    }),
  };
}

/** Boxes in these lanes. */
export const boxesIn = (state: DraftState, laneIds: string[]) => state.boxes.filter((b) => laneIds.includes(b.lane));

/** Remove a lane; its boxes move to `moveTo` (required if it has any). */
export function removeLane(state: DraftState, laneId: string, moveTo?: string): DraftState {
  if (boxesIn(state, [laneId]).length && (!moveTo || moveTo === laneId)) {
    throw new Error("This lane has boxes: choose a lane to move them to.");
  }
  return {
    ...state,
    boxes: state.boxes.map((b) => (b.lane === laneId ? { ...b, lane: moveTo! } : b)),
    departments: state.departments.map((d) => ({ ...d, lanes: d.lanes.filter((l) => l.id !== laneId) })),
  };
}

/**
 * Remove a department. Its boxes move to `moveTo` (a lane in another
 * department; required if it has any). Its engineers keep their place on the
 * roster with no department.
 */
export function removeDepartment(state: DraftState, id: string, moveTo?: string): DraftState {
  const dept = state.departments.find((d) => d.id === id);
  if (!dept) return state;
  const laneIds = dept.lanes.map((l) => l.id);
  if (boxesIn(state, laneIds).length && (!moveTo || laneIds.includes(moveTo))) {
    throw new Error("This department has boxes: choose a lane in another department to move them to.");
  }
  return {
    ...state,
    boxes: state.boxes.map((b) => (laneIds.includes(b.lane) ? { ...b, lane: moveTo! } : b)),
    departments: state.departments.filter((d) => d.id !== id),
    people: state.people.map((p) => (p.department === id ? { ...p, department: undefined } : p)),
  };
}
