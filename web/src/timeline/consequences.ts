// What moving a box or PTO block from the keyboard would do, in words, as
// it moves: a department going over capacity (or back within it), a rule
// broken (or kept again), an engineer booked during their PTO (or no
// longer). Worked out over the roadmap as it would be, nothing changed yet,
// and compared step to step, so only what changed is said.

import { ptoClashes } from "../model/pto";
import { findViolations } from "../model/relations";
import { overCapacity, worstStretch } from "../model/report";
import type { Box, Department, Person, TimeOff } from "../model/types";
import { spokenRange } from "./keyboard";

/** One thing that holds: said (`on`) when it starts to, or when its `level` changes; `off` when it stops. */
export interface Fact {
  level: string;
  on: string;
  off: string;
}
export type Facts = Map<string, Fact>;

interface State {
  boxes: Box[];
  departments: Department[];
  people: Person[];
}

/**
 * What holds for `box` (already in `state.boxes`, where it would be): each
 * of the departments `depts` over capacity while it runs (where it was and
 * where it's going), the rules it breaks, and its engineers' PTO it overlaps.
 */
export function boxFacts(state: State, box: Box, depts: string[]): Facts {
  const facts: Facts = new Map();
  for (const dept of state.departments.filter((d) => depts.includes(d.id))) {
    const over = overCapacity(dept, state.boxes).filter((s) => s.from <= box.end && s.to >= box.start);
    if (!over.length) continue;
    const w = worstStretch(over);
    facts.set(`over:${dept.id}`, {
      level: `${w.fte}/${w.capacity}`,
      on: `${dept.name} is over capacity then: ${w.fte} FTE against ${w.capacity}, ${spokenRange(w.from, w.to)}.`,
      off: `${dept.name} is within capacity again.`,
    });
  }
  for (const v of findViolations(state.boxes, state.departments)) {
    if (v.from.id !== box.id && v.to.id !== box.id) continue;
    facts.set(`rule:${v.from.code}:${v.type}:${v.to.code}`, {
      level: "",
      on: `Breaks a rule: ${v.message}`,
      off: `Keeps the rule again: ${v.message.split(", but ")[0]}.`,
    });
  }
  for (const c of ptoClashes([box], state.people)) {
    facts.set(`pto:${c.person.id}:${c.pto.start}:${c.pto.end}`, {
      level: "",
      on: `${c.person.name} is on PTO ${spokenRange(c.pto.start, c.pto.end)} then.`,
      off: `No longer during ${c.person.name}’s PTO.`,
    });
  }
  return facts;
}

/** What holds for a PTO entry of `person` (with it where it would be): the boxes of theirs it overlaps. */
export function ptoFacts(boxes: Box[], person: Person, pto: TimeOff): Facts {
  const facts: Facts = new Map();
  for (const c of ptoClashes(boxes, [{ ...person, pto: [pto] }])) {
    facts.set(`box:${c.box.id}`, {
      level: "",
      on: `${person.name} is booked on ${c.box.title} then.`,
      off: `No longer during ${c.box.title}.`,
    });
  }
  return facts;
}

/** What to say about going from `before` to `after`: what started to hold, or changed, then what stopped. */
export function consequences(before: Facts, after: Facts): string[] {
  const out: string[] = [];
  for (const [key, f] of after) if (before.get(key)?.level !== f.level) out.push(f.on);
  for (const [key, f] of before) if (!after.has(key)) out.push(f.off);
  return out;
}
