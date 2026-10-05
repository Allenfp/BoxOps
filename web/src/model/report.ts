// The roadmap as plain text, for a person or tool without the app (`npm run
// report`): each department's capacity, with where it's over capacity or
// full; engineers over 1 FTE; engineers booked on a box during their PTO;
// every engineer's bookings and PTO by date; boxes with nobody assigned; and
// broken rules. Over all time, past included, so it never depends on the day
// it's run and two reports can be compared with diff. (The app warns about
// over capacity and PTO from today on; it doesn't list overloaded engineers
// or unassigned boxes.) Also what the app and the timeline use to find a
// department's stretches over capacity.

import { type Day, dayOfWorkIndex, prettyDay, workIndex } from "./dates";
import { ptoClashes } from "./pto";
import { findViolations, fullCode } from "./relations";
import type { Box, Department, Lane, Roadmap, TimeOff } from "./types";

export interface Stretch {
  from: Day;
  to: Day;
  /** FTE in use on every working day of the stretch. */
  fte: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Working-day stretches where the FTE in use satisfies `when`, split wherever
 * the level changes, so each stretch has one level.
 */
export function levelStretches(items: { start: Day; end: Day; fte: number }[], when: (fte: number) => boolean): Stretch[] {
  const delta = new Map<number, number>();
  for (const it of items) {
    const s = workIndex(it.start);
    const e = workIndex(it.end + 1);
    if (e <= s) continue;
    delta.set(s, (delta.get(s) ?? 0) + it.fte);
    delta.set(e, (delta.get(e) ?? 0) - it.fte);
  }
  const points = [...delta.keys()].sort((a, b) => a - b);
  const out: Stretch[] = [];
  let load = 0;
  for (let i = 0; i < points.length - 1; i++) {
    load = round(load + delta.get(points[i])!);
    if (!when(load)) continue;
    const last = out[out.length - 1];
    if (last && last.fte === load && workIndex(last.to) + 1 === points[i]) {
      last.to = dayOfWorkIndex(points[i + 1] - 1); // same level carries on
    } else {
      out.push({ from: dayOfWorkIndex(points[i]), to: dayOfWorkIndex(points[i + 1] - 1), fte: load });
    }
  }
  return out;
}

/** Working-day stretches where the FTE in use is over `limit`, one per level. */
export const overStretches = (items: { start: Day; end: Day; fte: number }[], limit: number) =>
  levelStretches(items, (fte) => fte > limit);

export interface CapacityStretch extends Stretch {
  /** FTE of the lanes open on every working day of the stretch. */
  capacity: number;
}

/**
 * Working-day stretches where the boxes' FTE (`load`) and the open lanes' FTE
 * (`capacity`, which changes as dated lanes open and close) satisfy `when`;
 * split wherever either changes.
 */
export function capacityStretches(
  boxes: { start: Day; end: Day; fte: number }[],
  lanes: Lane[],
  when: (load: number, capacity: number) => boolean,
): CapacityStretch[] {
  const load = new Map<number, number>();
  const cap = new Map<number, number>();
  const add = (m: Map<number, number>, at: number, n: number) => m.set(at, (m.get(at) ?? 0) + n);
  for (const b of boxes) {
    const s = workIndex(b.start);
    const e = workIndex(b.end + 1);
    if (e <= s) continue;
    add(load, s, b.fte);
    add(load, e, -b.fte);
  }
  let capacity = 0;
  for (const l of lanes) {
    if (l.start === undefined) capacity += l.fte;
    else add(cap, workIndex(l.start), l.fte);
    if (l.end !== undefined) add(cap, workIndex(l.end + 1), -l.fte);
  }
  const points = [...new Set([...load.keys(), ...cap.keys()])].sort((a, b) => a - b);
  const out: CapacityStretch[] = [];
  let fte = 0;
  for (let i = 0; i < points.length - 1; i++) {
    fte = round(fte + (load.get(points[i]) ?? 0));
    capacity = round(capacity + (cap.get(points[i]) ?? 0));
    if (fte === 0 || !when(fte, capacity)) continue;
    const last = out[out.length - 1];
    if (last && last.fte === fte && last.capacity === capacity && workIndex(last.to) + 1 === points[i]) {
      last.to = dayOfWorkIndex(points[i + 1] - 1);
    } else {
      out.push({ from: dayOfWorkIndex(points[i]), to: dayOfWorkIndex(points[i + 1] - 1), fte, capacity });
    }
  }
  return out;
}

/** A department's stretches over capacity: where its boxes need more FTE than its lanes open then hold. */
export function overCapacity(dept: Department, boxes: Box[]): CapacityStretch[] {
  const laneIds = new Set(dept.lanes.map((l) => l.id));
  return capacityStretches(
    boxes.filter((b) => laneIds.has(b.lane)),
    dept.lanes,
    (load, cap) => load > cap,
  );
}

/** The worst of these stretches (at least one): the most FTE over what the lanes open then hold. */
export const worstStretch = (over: CapacityStretch[]): CapacityStretch =>
  over.reduce((a, b) => (b.fte - b.capacity > a.fte - a.capacity ? b : a));

/**
 * Stretches over capacity in words, by the worst one: "2 FTE planned against
 * 1.5, 2027-01-04 – 2027-01-29, and 1 more stretch". At least one stretch.
 */
export function overloadText(over: CapacityStretch[]): string {
  const worst = worstStretch(over);
  const more = over.length > 1 ? `, and ${over.length - 1} more stretch${over.length > 2 ? "es" : ""}` : "";
  return `${worst.fte} FTE planned against ${worst.capacity}, ${prettyDay(worst.from)} – ${prettyDay(worst.to)}${more}`;
}

/** One line of an engineer's calendar: a box they're on (with their share of it), or their PTO. */
export type Booking = { box: Box; code: string; fte: number } | { pto: TimeOff };

export interface Report {
  departments: { id: string; name: string; fte: number; boxes: number; over: CapacityStretch[]; full: CapacityStretch[] }[];
  /**
   * Every engineer's bookings and PTO, by date, and where they're over 1 FTE
   * (a box's FTE is split evenly across its engineers; PTO doesn't count).
   * `department` is the department's name (its id if there's no such department).
   */
  people: { id: string; name: string; department?: string; bookings: Booking[]; over: Stretch[] }[];
  /** Engineers on a box while they're on PTO. */
  onPto: { person: { id: string; name: string }; pto: TimeOff; box: Box; code: string }[];
  unassigned: { box: Box; code: string }[];
  /** Broken rules between boxes, in words. */
  ruleWarnings: string[];
}

const start = (b: Booking) => ("pto" in b ? b.pto.start : b.box.start);

export function buildReport(roadmap: Roadmap): Report {
  const deptOf = new Map(roadmap.departments.flatMap((d) => d.lanes.map((l) => [l.id, d.id] as const)));
  const deptName = new Map(roadmap.departments.map((d) => [d.id, d.name]));
  const code = (box: Box) => fullCode(box, roadmap.departments);
  return {
    departments: roadmap.departments.map((d) => {
      const boxes = roadmap.boxes.filter((b) => deptOf.get(b.lane) === d.id);
      const fte = d.lanes.reduce((n, l) => n + l.fte, 0);
      return {
        id: d.id,
        name: d.name,
        fte,
        boxes: boxes.length,
        over: capacityStretches(boxes, d.lanes, (load, cap) => load > cap),
        full: capacityStretches(boxes, d.lanes, (load, cap) => load === cap),
      };
    }),
    people: roadmap.people.map((p) => {
      const boxes = roadmap.boxes
        .filter((b) => b.engineers?.includes(p.id))
        .map((box) => ({ box, code: code(box), fte: round(box.fte / box.engineers!.length) }));
      const shares = boxes.map(({ box, fte }) => ({ start: box.start, end: box.end, fte }));
      // PTO first on a day both start: they're away from it.
      const bookings: Booking[] = [...(p.pto ?? []).map((pto) => ({ pto })), ...boxes].sort((a, b) => start(a) - start(b));
      const department = p.department === undefined ? undefined : (deptName.get(p.department) ?? p.department);
      return { id: p.id, name: p.name, department, bookings, over: overStretches(shares, 1) };
    }),
    onPto: ptoClashes(roadmap.boxes, roadmap.people)
      .map(({ person, pto, box }) => ({ person: { id: person.id, name: person.name }, pto, box, code: code(box) }))
      .sort((a, b) => a.pto.start - b.pto.start || a.person.name.localeCompare(b.person.name) || a.box.start - b.box.start),
    unassigned: roadmap.boxes
      .filter((b) => !b.engineers?.length)
      .sort((a, b) => a.start - b.start)
      .map((box) => ({ box, code: code(box) })),
    ruleWarnings: findViolations(roadmap.boxes, roadmap.departments).map((v) => v.message),
  };
}

const range = (s: Stretch) => `${prettyDay(s.from)} – ${prettyDay(s.to)}`;
const dates = (x: { start: Day; end: Day }) => `${prettyDay(x.start)} – ${prettyDay(x.end)}`;
const note = (pto: TimeOff) => (pto.note?.trim() ? ` (${pto.note.trim()})` : "");

export function formatReport(r: Report): string {
  const lines: string[] = ["Departments"];
  for (const d of r.departments) {
    lines.push(`  ${d.name} (${d.id}): ${d.fte} FTE of lanes, ${d.boxes} box${d.boxes === 1 ? "" : "es"}`);
    if (d.over.length === 0) lines.push("    within capacity");
    for (const s of d.over) lines.push(`    OVER CAPACITY ${range(s)}: ${s.fte} FTE planned of ${s.capacity}`);
    for (const s of d.full) lines.push(`    full (no spare FTE) ${range(s)}`);
  }
  const overloaded = r.people.filter((p) => p.over.length);
  lines.push("", "Engineers over 1 FTE");
  if (overloaded.length === 0) lines.push("  none");
  for (const p of overloaded) {
    for (const s of p.over) lines.push(`  ${p.name} (${p.id}): ${s.fte} FTE, ${range(s)}`);
  }
  lines.push("", "Engineers booked during PTO");
  if (r.onPto.length === 0) lines.push("  none");
  for (const c of r.onPto) {
    lines.push(`  ${c.person.name} (${c.person.id}): PTO ${dates(c.pto)}${note(c.pto)}, on ${c.box.title} (${c.code}), ${dates(c.box)}`);
  }
  lines.push("", "Engineer bookings and PTO, by date (FTE is their share of the box)");
  for (const p of r.people) {
    lines.push(`  ${p.name} (${p.id})${p.department ? `, ${p.department}` : ""}`);
    if (p.bookings.length === 0) lines.push("    no boxes");
    for (const b of p.bookings) {
      lines.push("pto" in b ? `    ${dates(b.pto)}  PTO${note(b.pto)}` : `    ${dates(b.box)}  ${b.fte} FTE  ${b.box.title} (${b.code})`);
    }
  }
  lines.push("", "Boxes with no engineer");
  if (r.unassigned.length === 0) lines.push("  none");
  for (const { box, code } of r.unassigned) lines.push(`  ${box.title} (${code}), ${dates(box)}`);
  lines.push("", "Broken rules between boxes");
  if (r.ruleWarnings.length === 0) lines.push("  none");
  for (const w of r.ruleWarnings) lines.push(`  ${w}`);
  return lines.join("\n");
}
