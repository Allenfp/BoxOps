// Rules relating boxes in time ("finishes before", "happens during", …) and
// the warnings when they're broken. Broken rules never block anything; they're
// shown like over capacity is.

import { type Day, prettyDay, workdays } from "./dates";
import type { Box, Department, Relation, RelationType } from "./types";

interface RuleKind {
  /** How the rule reads from the box that has it: "<this> finishes before <other> starts". */
  label: string;
  /** How it reads from the other box. */
  inverse: string;
  /** For warnings: "<this> should finish before <other> starts". */
  should: string;
  /** Short form for lists, e.g. "finishes before". */
  short: string;
  holds(a: Box, b: Box): boolean;
}

const span = (from: Day, to: Day) => Math.max(0, workdays(from, to));

export const RELATION_TYPES: Record<RelationType, RuleKind> = {
  before: {
    label: "finishes before {other} starts",
    inverse: "starts after {other} finishes",
    should: "finish before {other} starts",
    short: "finishes before",
    holds: (a, b) => a.end < b.start,
  },
  after: {
    label: "starts after {other} finishes",
    inverse: "finishes before {other} starts",
    should: "start after {other} finishes",
    short: "starts after",
    holds: (a, b) => a.start > b.end,
  },
  during: {
    label: "happens during {other}",
    inverse: "has {other} happening during it",
    should: "happen during {other}",
    short: "happens during",
    holds: (a, b) => a.start >= b.start && a.end <= b.end,
  },
  starts_with: {
    label: "starts when {other} starts",
    inverse: "starts when {other} starts",
    should: "start when {other} starts",
    short: "starts when",
    holds: (a, b) => a.start === b.start,
  },
  ends_with: {
    label: "ends when {other} ends",
    inverse: "ends when {other} ends",
    should: "end when {other} ends",
    short: "ends when",
    holds: (a, b) => a.end === b.end,
  },
  overlaps: {
    label: "runs at the same time as {other}",
    inverse: "runs at the same time as {other}",
    should: "run at the same time as {other}",
    short: "runs at the same time as",
    holds: (a, b) => a.start <= b.end && b.start <= a.end,
  },
  apart: {
    label: "doesn't overlap {other}",
    inverse: "doesn't overlap {other}",
    should: "not overlap {other}",
    short: "doesn't overlap",
    holds: (a, b) => a.end < b.start || b.end < a.start,
  },
};

export const RELATION_ORDER = Object.keys(RELATION_TYPES) as RelationType[];

/** "DE-A1F": the box's department code and its own code. */
export function fullCode(box: Box, departments: Department[]): string {
  const dept = departments.find((d) => d.lanes.some((l) => l.id === box.lane));
  return `${dept?.code ?? "?"}-${box.code}`;
}

/** Accepts "A1F" or "DE-A1F" (any case); returns the 3-character code. */
export function parseCodeRef(text: string): string {
  return text.trim().toUpperCase().replace(/^[A-Z0-9]+-(?=[A-Z0-9]{3}$)/, "");
}

export interface Violation {
  /** The box that has the rule. */
  from: Box;
  /** The box the rule points at. */
  to: Box;
  type: RelationType;
  /** Plain-English explanation with dates. */
  message: string;
}

const days = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

/** Why a rule doesn't hold, in words with dates: "it ends Feb 26, 2027 and the other starts Feb 22, 2027". */
function explain(type: RelationType, a: Box, b: Box): string {
  switch (type) {
    case "before":
      return `it ends ${prettyDay(a.end)} and the other starts ${prettyDay(b.start)}`;
    case "after":
      return `it starts ${prettyDay(a.start)} and the other ends ${prettyDay(b.end)}`;
    case "during": {
      const parts: string[] = [];
      if (a.start < b.start) parts.push(`starts ${days(span(a.start, b.start - 1))} early`);
      if (a.end > b.end) parts.push(`ends ${days(span(b.end + 1, a.end))} late`);
      return `it ${parts.join(" and ")} (the other runs ${prettyDay(b.start)} – ${prettyDay(b.end)})`;
    }
    case "starts_with":
      return `it starts ${prettyDay(a.start)}, the other ${prettyDay(b.start)}`;
    case "ends_with":
      return `it ends ${prettyDay(a.end)}, the other ${prettyDay(b.end)}`;
    case "overlaps":
      return `they don't share any days`;
    case "apart":
      return `they share ${days(span(Math.max(a.start, b.start), Math.min(a.end, b.end)))}`;
  }
}

/** Every broken rule in the roadmap. Rules pointing at a missing box are skipped (the validator reports those). */
export function findViolations(boxes: Box[], departments: Department[]): Violation[] {
  const byCode = new Map(boxes.map((b) => [b.code, b]));
  const out: Violation[] = [];
  for (const a of boxes) {
    for (const r of a.relations ?? []) {
      const b = byCode.get(r.box);
      const kind = RELATION_TYPES[r.type];
      if (!b || !kind || b === a || kind.holds(a, b)) continue;
      const rule = kind.should.replace("{other}", `${fullCode(b, departments)} ${b.title}`);
      out.push({
        from: a,
        to: b,
        type: r.type,
        message: `${fullCode(a, departments)} ${a.title} should ${rule}, but ${explain(r.type, a, b)}.`,
      });
    }
  }
  return out;
}

/** Rules that point at `code` from other boxes, for showing (and removing) from that box. */
export function incoming(boxes: Box[], code: string): { box: Box; relation: Relation }[] {
  return boxes.flatMap((box) => (box.relations ?? []).filter((r) => r.box === code).map((relation) => ({ box, relation })));
}

/** Letters and digits that can't be mistaken for each other (no 0/O, 1/I). */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Codes that read as words, including ones that mean something else here. */
const AVOID = new Set(["FTE", "WIP", "TBD", "ASS", "SEX", "FUK", "FUC", "KKK", "NAZ", "XXX"]);

/** A fresh 3-character code no box uses, easy to read aloud and type. */
export function newBoxCode(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    const code = Array.from({ length: 3 }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join("");
    if (!taken.has(code) && !AVOID.has(code)) return code;
  }
}

/** A department code from its name: initials of the words, or the first two letters of one word. */
export function deriveDeptCode(name: string, taken: Set<string>): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4) : (words[0] ?? "D").slice(0, 2);
  if (base.length < 2) base = (base + "X").slice(0, 2);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const code = `${base.slice(0, 3)}${n}`;
    if (!taken.has(code)) return code;
  }
}
