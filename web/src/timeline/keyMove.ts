// Moving a box or PTO block from the keyboard (components/Timeline.tsx).
// Space picks it up; the arrow keys move what's drawn (a preview, as a
// pointer drag does: nothing is laid out again, nothing else moves); Enter
// or Space drops it, one change; Escape or ⌘Z puts it back. Tab, a click
// anywhere, ⌘S, another view or going read-only drop it too (Timeline.tsx).
// Each step says the dates, and what they'd do (consequences.ts). While it
// lasts, others' saves wait (App's polling). The timeline fetches this once
// it's drawn, so a move hardly ever waits for it.

import { announce } from "../a11y/announce";
import { APPLE, letter, undoHint } from "../a11y/keys";
import { type Day, prettyDay } from "../model/dates";
import { closedRanges } from "../model/lanes";
import type { PtoRef } from "../model/pto";
import type { Box, Department, Roadmap, TimeOff } from "../model/types";
import { type Facts, boxFacts, consequences, ptoFacts } from "./consequences";
import { movedDates } from "./drag";
import { laneName, spokenRange, workingDays } from "./keyboard";
import { type DepartmentLayout, slotsOf } from "./layout";

type Placement = Pick<Box, "lane" | "start" | "end">;

/** A keyboard move under way: what's moving, from where, to where now, and what's been said about it. */
export type Move = (
  | { kind: "box"; id: string; from: Placement; at: Placement }
  | { kind: "pto"; ref: PtoRef; key: string; from: { start: Day; end: Day }; at: { start: Day; end: Day } }
) & {
  /** What held as last read out, and the message on its way (with what held then). */
  said: Facts;
  pending?: { facts: Facts; takeBack(): boolean };
  /** The end that moved last, kept on screen. */
  edge: "start" | "end";
};

/** What a move needs of the timeline, as it is when each key comes. */
export interface MoveHost {
  latest(): {
    roadmap: Roadmap;
    /** Every box, finished ones too, for capacity (`roadmap` may leave some out). */
    allBoxes?: Box[];
    collapsed: ReadonlySet<string>;
    layouts: Map<string, DepartmentLayout>;
    onPlaceBox(id: string, placement: Placement): void;
    onPlacePto?(ref: PtoRef, dates: Pick<TimeOff, "start" | "end">): void;
  };
  /** The move under way, if any. */
  current(): Move | null;
  /** It starts: what moves is drawn where it's going from now on, and others' saves wait. */
  start(m: Move): void;
  /** Draw it where it's got to. */
  show(m: Move): void;
  /** It's over (dropped or put back): nothing is drawn moving any more. Returns the move that was under way. */
  end(): Move | null;
}

/** The keys of a keyboard move are said the first time one starts, not every time. */
let toldMoveKeys = false;
const ALT_KEY = APPLE ? "Option" : "Alt";
const say = (text: string) => void announce(text);

/** The roadmap as it would be with the move dropped where it is now, and what holds for what's moved then. */
function factsNow(host: MoveHost, m: Move): Facts {
  const p = host.latest();
  const all = p.allBoxes ?? p.roadmap.boxes;
  if (m.kind === "pto") {
    const person = p.roadmap.people.find((x) => x.id === m.ref.personId)!;
    return ptoFacts(all, person, { ...person.pto![m.ref.index], ...m.at });
  }
  const box = { ...all.find((b) => b.id === m.id)!, ...m.at };
  const deptOf = (lane: string) => p.roadmap.departments.find((d) => d.lanes.some((l) => l.id === lane))?.id ?? "";
  const state = { boxes: all.map((b) => (b.id === m.id ? box : b)), departments: p.roadmap.departments, people: p.roadmap.people };
  return boxFacts(state, box, [deptOf(m.from.lane), deptOf(m.at.lane)]);
}

/**
 * Say where it's got to (`lead`) and what changed since what was last said. A message not
 * yet read is taken back (a key held down says only where it ends up), so what changed is
 * counted from what was read.
 */
function step(host: MoveHost, m: Move, lead: string) {
  if (m.pending && !m.pending.takeBack()) m.said = m.pending.facts;
  const facts = factsNow(host, m);
  m.pending = { facts, takeBack: announce([lead, ...consequences(m.said, facts)].join(" ")) };
}

/** What's moving, in words: its title, or whose PTO. */
function movingName(host: MoveHost, m: Move): string {
  const { roadmap } = host.latest();
  if (m.kind === "box") return roadmap.boxes.find((b) => b.id === m.id)?.title || "Untitled";
  return `PTO for ${roadmap.people.find((x) => x.id === m.ref.personId)?.name ?? "an engineer"}`;
}

/** Pick up the box or PTO block (`kind`, `id`: its cell's key's parts) to move it. */
export function pickUp(host: MoveHost, kind: string, id: string): void {
  const { roadmap, collapsed } = host.latest();
  let m: Move;
  if (kind === "box") {
    const b = roadmap.boxes.find((x) => x.id === id);
    const dept = b && roadmap.departments.find((d) => d.lanes.some((l) => l.id === b.lane));
    if (!b || !dept) return;
    if (collapsed.has(dept.id)) return say(`Expand ${dept.name} to move its boxes.`);
    const from = { lane: b.lane, start: b.start, end: b.end };
    m = { kind: "box", id, from, at: from, said: new Map(), edge: "start" };
  } else {
    const ref = { personId: id.slice(0, id.lastIndexOf("#")), index: Number(id.slice(id.lastIndexOf("#") + 1)) };
    const pto = roadmap.people.find((x) => x.id === ref.personId)?.pto?.[ref.index];
    if (!pto) return;
    const from = { start: pto.start, end: pto.end };
    m = { kind: "pto", ref, key: id, from, at: from, said: new Map(), edge: "start" };
  }
  m.said = factsNow(host, m);
  host.start(m);
  const lanes = m.kind === "box" ? " Up and Down change the lane." : "";
  say(
    toldMoveKeys
      ? `Moving ${movingName(host, m)}.`
      : `Moving ${movingName(host, m)}, ${spokenRange(m.from.start, m.from.end)}. Left and Right move it a working day, Shift for a week. ${ALT_KEY} with Left or Right changes the end date.${lanes} Enter to drop, Escape to cancel.`,
  );
  toldMoveKeys = true;
}

/** Drop it where it's got to: one change. */
export function drop(host: MoveHost): void {
  const m = host.end();
  if (!m) return;
  const p = host.latest();
  const changed = m.at.start !== m.from.start || m.at.end !== m.from.end || (m.kind === "box" && m.at.lane !== m.from.lane);
  if (!changed) return say(`Dropped where it was: ${movingName(host, m)}.`);
  if (m.kind === "box") {
    p.onPlaceBox(m.id, m.at);
    say(`Dropped: ${movingName(host, m)}, ${spokenRange(m.at.start, m.at.end)}, ${laneName(p.roadmap.departments, m.at.lane)}. ${undoHint()}`);
  } else {
    p.onPlacePto?.(m.ref, m.at);
    say(`Dropped: ${movingName(host, m)}, ${spokenRange(m.at.start, m.at.end)}. ${undoHint()}`);
  }
}

function cancel(host: MoveHost): void {
  const m = host.end();
  if (m) say(`Move cancelled: ${movingName(host, m)} is back at ${spokenRange(m.from.start, m.from.end)}.`);
}

/** ← → (a day; Shift, a week), and with Alt the end date only. */
function stepDates(host: MoveHost, m: Move, mode: "move" | "end", delta: number) {
  const at = { ...m.at, ...movedDates(m.at, mode, delta) };
  if (at.start === m.at.start && at.end === m.at.end) return say("It can’t end before it starts.");
  m.at = at as typeof m.at;
  m.edge = mode === "end" ? "end" : "start";
  host.show(m);
  step(host, m, mode === "end" ? `Ends ${prettyDay(at.end)}, ${workingDays(at.start, at.end)}.` : `${spokenRange(at.start, at.end)}.`);
}

/** ↑ ↓: the lane above or below, into the next open department; it says when the lane is busy then. */
function stepLane(host: MoveHost, m: Move, dir: -1 | 1) {
  if (m.kind === "pto") return say("PTO moves only in time; change whose it is in its editor.");
  const p = host.latest();
  const lanes = laneSequence(p.roadmap.departments, p.collapsed);
  const i = lanes.findIndex((x) => x.lane === m.at.lane) + dir;
  if (i < 0 || i >= lanes.length) return say(dir < 0 ? "It’s in the top lane." : "It’s in the bottom lane.");
  const was = lanes[i - dir]?.dept;
  const { lane, dept: deptId } = lanes[i];
  m.at = { ...m.at, lane };
  host.show(m);
  const dept = p.roadmap.departments.find((d) => d.id === deptId)!;
  const box = { ...p.roadmap.boxes.find((b) => b.id === m.id)!, ...m.at };
  const fits = fitsInLane(dept, p.layouts.get(deptId)!, p.allBoxes ?? p.roadmap.boxes, box, lane);
  step(
    host,
    m,
    [`${laneName(p.roadmap.departments, lane)}.`, deptId !== was && `Code now ${dept.code}-${box.code}.`, !fits && "Busy then: it will be drawn in the nearest free space."]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * A key while a move is under way (heard before anything else on the page). The move's own keys
 * go nowhere else; others pass, and ⌘S saves it dropped.
 */
export function onMoveKey(host: MoveHost, e: KeyboardEvent, dropAtOnce: () => void): void {
  const m = host.current();
  if (!m) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = letter(e);
  // ⌘S saves it dropped: the drop reaches the draft before the app's own ⌘S reads it.
  if (mod && key === "s") return dropAtOnce();
  // Tab drops it, and goes on.
  if (e.key === "Tab") return drop(host);
  const arrow = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key] as -1 | 1 | undefined;
  const ours =
    (mod && (key === "z" || key === "y")) ||
    (mod && !e.altKey && (arrow !== undefined || e.key === "Home" || e.key === "End")) ||
    (!mod && (arrow !== undefined || ["Escape", "Enter", " ", "Delete", "Backspace", "Home", "End", "PageUp", "PageDown"].includes(e.key) || key === "n"));
  if (!ours) return;
  // Nothing behind the move acts on these: not the app's undo, nor the grid's keys, nor the
  // browser's Back and Forward (Alt+← on Windows, ⌘← on a Mac in Chrome and Firefox).
  e.preventDefault();
  e.stopPropagation();
  if (e.isComposing) return;
  if (e.key === "Escape" || (mod && key === "z" && !e.shiftKey)) cancel(host);
  else if ((e.key === "Enter" || e.key === " ") && !e.repeat) drop(host);
  else if (arrow && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod) stepDates(host, m, e.altKey ? "end" : "move", arrow * (e.shiftKey ? 5 : 1));
  else if (arrow && !mod && !e.altKey && !e.shiftKey) stepLane(host, m, arrow);
  // Any other key (⌘←, Home, Delete…) does nothing: it says what does.
  else if (!e.repeat) say(`Moving ${movingName(host, m)}: Enter to drop, Escape to cancel.`);
}

/** The lanes a box moves through with up and down, top to bottom: those of the departments that are open. */
export function laneSequence(departments: Department[], collapsed: ReadonlySet<string>): { lane: string; dept: string }[] {
  return departments.filter((d) => !collapsed.has(d.id)).flatMap((d) => d.lanes.map((l) => ({ lane: l.id, dept: d.id })));
}

/**
 * Whether `box` would be drawn in `laneId` for its dates: some slot of the
 * lane starts room enough for it, clear of the other boxes as they're drawn
 * and of closed lanes. If not, the layout draws it in the nearest free space
 * (or the extra area), which a move says.
 */
export function fitsInLane(dept: Department, layout: DepartmentLayout, boxes: Box[], box: Pick<Box, "id" | "start" | "end" | "fte">, laneId: string): boolean {
  const lane = layout.lanes.get(laneId);
  if (!lane) return false;
  const overlaps = (start: Day, end: Day) => start <= box.end && box.start <= end;
  const taken = (s: number) =>
    dept.lanes.some((l) => {
      const at = layout.lanes.get(l.id)!;
      return s >= at.slot && s < at.slot + at.slots && closedRanges(l).some(([a, b]) => overlaps(a, b));
    }) ||
    boxes.some((b) => {
      const p = b.id !== box.id && overlaps(b.start, b.end) ? layout.boxes.get(b.id) : undefined;
      return p !== undefined && !p.overflow && s >= p.slot && s < p.slot + p.slots;
    });
  const need = slotsOf(box.fte);
  for (let s = lane.slot; s < lane.slot + lane.slots; s++) {
    if (s + need > layout.capacity) continue;
    let free = true;
    for (let k = s; k < s + need && free; k++) free = !taken(k);
    if (free) return true;
  }
  return false;
}
