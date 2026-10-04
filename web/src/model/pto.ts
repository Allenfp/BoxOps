// Paid time off (PTO): stretches when an engineer is away. It lives on the
// person in people.yaml and is drawn as blocks in their department.

import { prettyDay } from "./dates";
import type { Box, Person, TimeOff } from "./types";

export const ptoRange = (t: TimeOff) =>
  t.start === t.end ? prettyDay(t.start) : `${prettyDay(t.start)} – ${prettyDay(t.end)}`;

/** One PTO entry: whose it is and where it sits in their list. */
export interface PtoRef {
  personId: string;
  index: number;
}

export const ptoKey = (ref: PtoRef) => `${ref.personId}#${ref.index}`;

/** Every PTO entry of these people, with its owner. */
export function ptoEntries(people: Person[]) {
  return people.flatMap((person) => (person.pto ?? []).map((pto, index) => ({ person, index, pto })));
}

/**
 * Stack entries into as few rows as possible without overlaps (earliest
 * first). Returns each entry's row and the number of rows.
 */
export function packRows<T extends { pto: TimeOff }>(entries: T[]): { rows: Map<T, number>; count: number } {
  const ends: number[] = [];
  const rows = new Map<T, number>();
  for (const e of [...entries].sort((a, b) => a.pto.start - b.pto.start || a.pto.end - b.pto.end)) {
    let row = ends.findIndex((end) => end < e.pto.start);
    if (row < 0) row = ends.length;
    ends[row] = e.pto.end;
    rows.set(e, row);
  }
  return { rows, count: ends.length };
}

export interface PtoClash {
  box: Box;
  person: Person;
  pto: TimeOff;
}

/** Engineers assigned to a box while they're on PTO. */
export function ptoClashes(boxes: Box[], people: Person[]): PtoClash[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: PtoClash[] = [];
  for (const box of boxes) {
    for (const id of box.engineers ?? []) {
      const person = byId.get(id);
      for (const pto of person?.pto ?? []) {
        if (pto.start <= box.end && box.start <= pto.end) out.push({ box, person: person!, pto });
      }
    }
  }
  return out;
}

/** What changed in one person's PTO, for the save summary. */
export function ptoChanges(was: TimeOff[] = [], now: TimeOff[] = []): { added: TimeOff[]; removed: TimeOff[] } {
  const key = (t: TimeOff) => `${t.start}:${t.end}:${t.note?.trim() ?? ""}`;
  const wasKeys = new Set(was.map(key));
  const nowKeys = new Set(now.map(key));
  return { added: now.filter((t) => !wasKeys.has(key(t))), removed: was.filter((t) => !nowKeys.has(key(t))) };
}
