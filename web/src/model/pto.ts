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

/** The same dates and note. */
export const samePto = (a: TimeOff, b: TimeOff) => a.start === b.start && a.end === b.end && (a.note ?? "") === (b.note ?? "");

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

/**
 * What changed in one person's PTO, for the save summary. Entries are
 * counted, not just compared, so a second entry just like one already there
 * (or one of two alike removed) is a change too.
 */
export function ptoChanges(was: TimeOff[] = [], now: TimeOff[] = []): { added: TimeOff[]; removed: TimeOff[] } {
  const key = (t: TimeOff) => `${t.start}:${t.end}:${t.note?.trim() ?? ""}`;
  /** The entries of `list` that `other` has no match left for. */
  const surplus = (list: TimeOff[], other: TimeOff[]) => {
    const left = new Map<string, number>();
    for (const t of other) left.set(key(t), (left.get(key(t)) ?? 0) + 1);
    return list.filter((t) => {
      const n = left.get(key(t)) ?? 0;
      left.set(key(t), n - 1);
      return n <= 0;
    });
  };
  return { added: surplus(now, was), removed: surplus(was, now) };
}
