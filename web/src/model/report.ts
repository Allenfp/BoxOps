// Plain-text checks a person or tool can run without the app: where a
// department has more FTE planned than its lanes, who is over 1 FTE, and which
// boxes have nobody assigned. Mirrors the warnings the app shows.

import { type Day, dayOfWorkIndex, prettyDay, workIndex } from "./dates";
import { findViolations } from "./relations";
import type { Box, Lane, Roadmap } from "./types";

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

export interface Report {
  departments: { id: string; name: string; fte: number; boxes: number; over: CapacityStretch[]; full: CapacityStretch[] }[];
  /** Every engineer's bookings, and where they're over 1 FTE (a box's FTE is split evenly across its engineers). */
  people: { id: string; name: string; department?: string; bookings: { box: Box; fte: number }[]; over: Stretch[] }[];
  unassigned: Box[];
  /** Broken rules between boxes, in words. */
  ruleWarnings: string[];
}

export function buildReport(roadmap: Roadmap): Report {
  const deptOf = new Map(roadmap.departments.flatMap((d) => d.lanes.map((l) => [l.id, d.id] as const)));
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
      const bookings = roadmap.boxes
        .filter((b) => b.engineers?.includes(p.id))
        .sort((a, b) => a.start - b.start)
        .map((box) => ({ box, fte: round(box.fte / box.engineers!.length) }));
      const shares = bookings.map(({ box, fte }) => ({ start: box.start, end: box.end, fte }));
      return { id: p.id, name: p.name, department: p.department, bookings, over: overStretches(shares, 1) };
    }),
    unassigned: roadmap.boxes.filter((b) => !b.engineers?.length).sort((a, b) => a.start - b.start),
    ruleWarnings: findViolations(roadmap.boxes, roadmap.departments).map((v) => v.message),
  };
}

const range = (s: Stretch) => `${prettyDay(s.from)} – ${prettyDay(s.to)}`;

export function formatReport(r: Report): string {
  const lines: string[] = ["Departments"];
  for (const d of r.departments) {
    lines.push(`  ${d.name} (${d.id}): ${d.fte} FTE of lanes, ${d.boxes} boxes`);
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
  lines.push("", "Engineer bookings (FTE is their share of the box)");
  for (const p of r.people) {
    lines.push(`  ${p.name} (${p.id})${p.department ? `, ${p.department}` : ""}`);
    if (p.bookings.length === 0) lines.push("    no boxes");
    for (const { box, fte } of p.bookings) {
      lines.push(`    ${prettyDay(box.start)} – ${prettyDay(box.end)}  ${fte} FTE  ${box.title} (${box.code})`);
    }
  }
  lines.push("", "Boxes with no engineer");
  if (r.unassigned.length === 0) lines.push("  none");
  for (const b of r.unassigned) lines.push(`  ${b.title} (${b.code}), ${prettyDay(b.start)} – ${prettyDay(b.end)}`);
  lines.push("", "Broken rules between boxes");
  if (r.ruleWarnings.length === 0) lines.push("  none");
  for (const w of r.ruleWarnings) lines.push(`  ${w}`);
  return lines.join("\n");
}
