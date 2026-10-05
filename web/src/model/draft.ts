// The editing draft: boxes and departments as the user has changed them, with
// undo/redo, a diff against what was loaded, and a copy in localStorage (one
// per tab, draftStore.ts) so a refresh never loses work. Nothing here touches
// git; committing is a later step.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFT_PREFIX,
  type DeltaItem,
  DraftWriter,
  type FoundDraft,
  HEARTBEAT_MS,
  RECORD,
  type Store,
  type StoredDraft,
  type Stores,
  asRecord,
  browserStores,
  isLeft,
  leftBehind,
  newTabKey,
  openTab,
  otherTabs,
  pageOf,
  readValue,
  removeDraft,
  savedAtOf,
  wasReloaded,
} from "./draftStore";
import { FORMAT } from "./format";
import { newBoxCode } from "./relations";
import * as structure from "./structure";
import { describeChanges } from "./summary";
import type { Box, Department, Lane, Person, Reserved, Settings } from "./types";

export interface DraftState {
  boxes: Box[];
  departments: Department[];
  people: Person[];
  /** Team settings (settings.yaml): box types, flags, fiscal year, default zoom. */
  settings: Settings;
}

export interface Changes {
  added: Box[];
  modified: Box[];
  removed: Box[];
  /** Departments added, or whose settings or lanes changed. */
  departments: Department[];
  /** Departments deleted. */
  removedDepartments: Department[];
  /** Engineers added, renamed or removed. */
  people: { added: Person[]; changed: Person[]; removed: Person[] };
  /** Team settings changed (one item, however many fields). */
  settings: boolean;
  count: number;
}

export function diffBoxes(base: Box[], current: Box[]) {
  const baseById = new Map(base.map((b) => [b.id, b]));
  const currentIds = new Set(current.map((b) => b.id));
  const added: Box[] = [];
  const modified: Box[] = [];
  for (const b of current) {
    const was = baseById.get(b.id);
    if (!was) added.push(b);
    else if (!same(was, b)) modified.push(b);
  }
  const removed = base.filter((b) => !currentIds.has(b.id));
  return { added, modified, removed, count: added.length + modified.length + removed.length };
}

/** Departments in the order they're shown (and loaded): by `order`, then by name. */
export function departmentOrder(departments: Department[]): Department[] {
  return [...departments].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Whether the departments both lists have stand in a different order. Only
 * the order matters, not the numbers: a department added or deleted, or ones
 * renumbered without moving, isn't a reorder.
 */
export function departmentsReordered(base: Department[], current: Department[]): boolean {
  const ids = (list: Department[], keep: Set<string>) =>
    departmentOrder(list)
      .filter((d) => keep.has(d.id))
      .map((d) => d.id)
      .join("\n");
  return ids(base, new Set(current.map((d) => d.id))) !== ids(current, new Set(base.map((d) => d.id)));
}

export function diffDraft(base: DraftState, current: DraftState): Changes {
  const boxes = diffBoxes(base.boxes, current.boxes);
  const baseDepts = new Map(base.departments.map((d) => [d.id, d]));
  const reordered = departmentsReordered(base.departments, current.departments);
  /** A department whose only change is its `order` number. */
  const orderOnly = (d: Department) => {
    const was = baseDepts.get(d.id);
    return !!was && was.order !== d.order && same({ ...was, order: d.order }, d);
  };
  // A new `order` that leaves every department where it was is no change.
  const departments = current.departments.filter((d) => {
    const was = baseDepts.get(d.id);
    return !was || (!same(was, d) && (reordered || !orderOnly(d)));
  });
  const currentDepts = new Set(current.departments.map((d) => d.id));
  const removedDepartments = base.departments.filter((d) => !currentDepts.has(d.id));
  const basePeople = new Map(base.people.map((p) => [p.id, p]));
  const currentPeople = new Set(current.people.map((p) => p.id));
  const people = {
    added: current.people.filter((p) => !basePeople.has(p.id)),
    changed: current.people.filter((p) => basePeople.has(p.id) && !same(basePeople.get(p.id)!, p)),
    removed: base.people.filter((p) => !currentPeople.has(p.id)),
  };
  const peopleCount = people.added.length + people.changed.length + people.removed.length;
  const settings = !same(base.settings, current.settings);
  // Departments whose only change is their place in the order count as one change together ("Reordered departments").
  const moved = departments.filter(orderOnly).length;
  const deptCount = departments.length - moved + (reordered ? 1 : 0);
  return {
    ...boxes,
    departments,
    removedDepartments,
    people,
    settings,
    count: boxes.count + deptCount + removedDepartments.length + peopleCount + (settings ? 1 : 0),
  };
}

/** Whether two items are the same. Most of a draft is the loaded roadmap's own objects, untouched: those are the same at a glance. */
function same<T extends object>(a: T, b: T): boolean {
  return a === b || JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * Canonical form for comparing: empty optional fields dropped (so "" and
 * undefined compare equal), text without spaces at either end (saving trims
 * it) and keys sorted (a box built in the app lists its fields in a different
 * order than one read from a file).
 */
export function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const value = typeof x === "string" ? x.trim() : x;
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    out[k] = normalize(value);
  }
  return out;
}

const sameOrBothMissing = <T extends object>(a: T | undefined, b: T | undefined) =>
  a === undefined || b === undefined ? a === b : same(a, b);

function mergeById<T extends { id: string }>(
  oldBase: T[],
  draft: T[],
  newBase: T[],
  kind: string,
  conflicts: string[],
): T[] {
  const o = new Map(oldBase.map((x) => [x.id, x]));
  const d = new Map(draft.map((x) => [x.id, x]));
  const n = new Map(newBase.map((x) => [x.id, x]));
  const ids = [...new Set([...newBase.map((x) => x.id), ...draft.map((x) => x.id)])];
  const out: T[] = [];
  for (const id of ids) {
    const ours = !sameOrBothMissing(o.get(id), d.get(id));
    const theirs = !sameOrBothMissing(o.get(id), n.get(id));
    if (ours && theirs && !sameOrBothMissing(d.get(id), n.get(id))) conflicts.push(`${kind}:${id}`);
    const value = ours ? d.get(id) : n.get(id);
    if (value) out.push(value);
  }
  return out;
}

/**
 * Move a draft onto a newer roadmap (someone else saved). Their changes come in
 * for everything we haven't touched; our edits stay. Items both of us changed
 * keep our version and are reported, so the user decides before saving. Then
 * what the merge left pointing at nothing is put right (see repair).
 */
export function rebaseDraft(oldBase: DraftState, draft: DraftState, newBase: DraftState) {
  const conflicts: string[] = [];
  // Settings are one item: ours if we changed them, else theirs.
  const oursSettings = !same(oldBase.settings, draft.settings);
  const theirsSettings = !same(oldBase.settings, newBase.settings);
  if (oursSettings && theirsSettings && !same(draft.settings, newBase.settings)) conflicts.push(SETTINGS_KEY);
  const merged = {
    boxes: mergeById(oldBase.boxes, draft.boxes, newBase.boxes, "box", conflicts),
    // In the order they're shown: ours may have moved one their list has where it was.
    departments: departmentOrder(mergeById(oldBase.departments, draft.departments, newBase.departments, "dept", conflicts)),
    people: mergeById(oldBase.people, draft.people, newBase.people, "person", conflicts),
    settings: oursSettings ? draft.settings : newBase.settings,
  };
  return { draft: repair(merged, [oldBase, draft, newBase], draft, oldBase, newBase, conflicts), conflicts };
}

/**
 * What a merge can leave pointing at nothing, when one side deleted what the
 * other still used, put right in `merged`:
 * - an engineer no longer on the roster comes off their boxes, and a rule
 *   about a box that's gone is dropped: the deletion stands;
 * - a box whose lane is gone moves to where that lane's other boxes went, else
 *   to the first lane of its department, else to the first lane there is, and
 *   clashes (added to `conflicts`), so the user sees it and can choose;
 * - a box this tab added that has the same code as a new box of theirs takes
 *   a fresh code, and this tab's own rules follow it (nobody else can know
 *   the code of a box that was never saved).
 * Only what one of `versions` had counts as gone: a reference that pointed at
 * nothing in all of them is the files' own problem, left as it is.
 */
function repair(merged: DraftState, versions: DraftState[], draft: DraftState, oldBase: DraftState, newBase: DraftState, conflicts: string[]): DraftState {
  const all = <T>(pick: (s: DraftState) => T[]) => versions.flatMap(pick);
  const knownPeople = new Set(all((s) => s.people.map((p) => p.id)));
  const people = new Set(merged.people.map((p) => p.id));
  const knownLanes = new Set(all((s) => s.departments.flatMap((d) => d.lanes.map((l) => l.id))));
  const lanes = new Set(merged.departments.flatMap((d) => d.lanes.map((l) => l.id)));

  // Codes: a box nobody has saved yet gives way to a saved one with its code.
  const saved = new Set([...oldBase.boxes, ...newBase.boxes].map((b) => b.id));
  const theirs = new Map(newBase.boxes.map((b) => [b.code, b.id]));
  const taken = new Set([...merged.boxes, ...newBase.boxes].map((b) => b.code));
  const recoded = new Map<string, string>();
  for (const b of merged.boxes) {
    if (saved.has(b.id) || theirs.get(b.code) === undefined || theirs.get(b.code) === b.id) continue;
    const code = newBoxCode(taken);
    taken.add(code);
    recoded.set(b.code, code);
  }
  // Our boxes: new, or changed from what we loaded.
  const before = new Map(oldBase.boxes.map((b) => [b.id, b]));
  const ours = new Set(draft.boxes.filter((b) => !sameOrBothMissing(before.get(b.id), b)).map((b) => b.id));
  const knownCodes = new Set([...all((s) => s.boxes.map((b) => b.code)), ...recoded.values()]);
  const codes = new Set(merged.boxes.map((b) => (saved.has(b.id) ? b.code : (recoded.get(b.code) ?? b.code))));

  /** Where a box whose lane is gone goes. */
  const laneFor = (b: Box): string | undefined => {
    const went = new Set(
      all((s) => s.boxes.filter((x) => x.lane === b.lane && x.id !== b.id).map((x) => x.id)).flatMap((id) => {
        const lane = merged.boxes.find((x) => x.id === id)?.lane;
        return lane !== undefined && lanes.has(lane) ? [lane] : [];
      }),
    );
    if (went.size === 1) return [...went][0];
    const deptId = versions.flatMap((s) => s.departments).find((d) => d.lanes.some((l) => l.id === b.lane))?.id;
    const dept = merged.departments.find((d) => d.id === deptId && d.lanes.length);
    return (dept ?? departmentOrder(merged.departments).find((d) => d.lanes.length))?.lanes[0]?.id;
  };

  let changed = false;
  const boxes = merged.boxes.map((b) => {
    let next = b;
    if (!saved.has(b.id) && recoded.has(b.code)) next = { ...next, code: recoded.get(b.code)! };
    // (Only lists: a stored draft from another build may hold anything, and isn't this pass's to judge.)
    const engineers = Array.isArray(next.engineers) ? next.engineers : [];
    if (engineers.some((e) => knownPeople.has(e) && !people.has(e))) {
      next = { ...next, engineers: engineers.filter((e) => !knownPeople.has(e) || people.has(e)) };
    }
    const rules = Array.isArray(next.relations)
      ? next.relations.map((r) => (ours.has(b.id) && recoded.has(r.box) ? { ...r, box: recoded.get(r.box)! } : r))
      : undefined;
    if (rules && rules.some((r, i) => r !== next.relations![i] || (knownCodes.has(r.box) && !codes.has(r.box)))) {
      next = { ...next, relations: rules.filter((r) => !knownCodes.has(r.box) || codes.has(r.box)) };
    }
    if (knownLanes.has(b.lane) && !lanes.has(b.lane)) {
      const lane = laneFor(b);
      if (lane !== undefined) {
        next = { ...next, lane };
        conflicts.push(`box:${b.id}`);
      }
    }
    if (next !== b) changed = true;
    return next;
  });
  return changed ? { ...merged, boxes } : merged;
}

/** The conflict key for team settings. */
export const SETTINGS_KEY = "settings:settings";

const entityOf = (state: DraftState, key: string) => {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "box") return state.boxes.find((b) => b.id === id);
  if (kind === "person") return state.people.find((p) => p.id === id);
  if (kind === "settings") return state.settings;
  return state.departments.find((d) => d.id === id);
};

/**
 * `draft` with these items put back to how they are in `base` (taking
 * "theirs"), each where it stands in its list: people.yaml is written in list
 * order, so moving someone would be a change of its own. What that leaves
 * pointing at nothing is put right as after a merge (see repair): their box
 * in a lane we removed moves to a lane there is, their department without a
 * lane we added takes our boxes in it elsewhere. The choice settles it: no
 * new clash.
 */
export function revertItems(draft: DraftState, base: DraftState, keys: string[]): DraftState {
  const revert = <T extends { id: string }>(items: T[], baseItems: T[], kind: string) => {
    const keyed = new Set(keys.filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1)));
    if (!keyed.size) return items;
    const baseById = new Map(baseItems.map((x) => [x.id, x]));
    const out = items.flatMap((x) => (!keyed.has(x.id) ? [x] : baseById.has(x.id) ? [baseById.get(x.id)!] : []));
    // One we deleted and they kept comes back after the item before it in theirs.
    const placed = new Set(out.map((x) => x.id));
    baseItems.forEach((x, i) => {
      if (!keyed.has(x.id) || placed.has(x.id)) return;
      const before = baseItems.slice(0, i).findLast((y) => placed.has(y.id));
      out.splice(before ? out.findIndex((y) => y.id === before.id) + 1 : 0, 0, x);
      placed.add(x.id);
    });
    return out;
  };
  const reverted = {
    boxes: revert(draft.boxes, base.boxes, "box"),
    departments: revert(draft.departments, base.departments, "dept"),
    people: revert(draft.people, base.people, "person"),
    settings: keys.includes(SETTINGS_KEY) ? base.settings : draft.settings,
  };
  return repair(reverted, [draft, base], draft, base, base, []);
}

/** One undo step: the draft and its clashes as they were. */
interface Step {
  draft: DraftState;
  conflicts: string[];
}

/** The draft with its undo history and clashes; changed only by reduceHistory. */
export interface History {
  /** The loaded roadmap this draft is relative to. */
  base: DraftState;
  past: Step[];
  present: DraftState;
  future: Step[];
  /** Consecutive edits with the same key (typing in one field) form one undo step. */
  lastKey?: string;
  /**
   * Items (`box:<id>`, `dept:<id>`, `person:<id>`, SETTINGS_KEY) someone else
   * changed while we were editing them too, and that still differ from `base`:
   * a clash is over once the item matches the saved version.
   */
  conflicts: string[];
  /** What a save of ours just wrote: the roadmap that comes back is rebased from this, not from `base`. */
  saved?: DraftState;
}

export type HistoryAction =
  /** A newer roadmap arrived: our own save, or someone else's. */
  | { type: "rebase"; base: DraftState }
  /** An edit; consecutive ones with the same `key` form one undo step. */
  | { type: "edit"; update(draft: DraftState): DraftState; key?: string }
  | { type: "undo" }
  | { type: "redo" }
  /** Ends typing coalescing, e.g. when the editor closes. */
  | { type: "checkpoint" }
  /** The user chose whose version to keep for these clashes, and only these (the ones they were shown). */
  | { type: "resolve"; keys: string[]; keep: "mine" | "theirs" }
  /** Our save went through, writing `draft`. */
  | { type: "saved"; draft: DraftState }
  /** Items restored from a draft another tab left (by key; undefined: removed), and its clashes. */
  | { type: "adopt"; values: ReadonlyMap<string, unknown>; conflicts: string[] };

const UNDO_STEPS = 200;

/** The clashes among `keys` that still matter: the item differs from the latest saved version. */
export function liveConflicts(keys: string[], base: DraftState, draft: DraftState): string[] {
  return [...new Set(keys)].filter((k) => !sameOrBothMissing(entityOf(base, k), entityOf(draft, k)));
}

/** A draft of `base`: unchanged, or one restored from storage. */
export function startHistory(base: DraftState, restored?: { draft: DraftState; conflicts: string[] }): History {
  const present = restored?.draft ?? base;
  return { base, past: [], present, future: [], conflicts: liveConflicts(restored?.conflicts ?? [], base, present) };
}

export function reduceHistory(h: History, a: HistoryAction): History {
  const step = (): Step => ({ draft: h.present, conflicts: h.conflicts });
  switch (a.type) {
    case "rebase": {
      if (a.base === h.base) return h;
      // Undo history refers to the old roadmap, so it starts fresh. After our
      // own save, the old version is what it wrote: an edit made while it ran
      // is ours, not a clash with our own commit, and an undo made then stays.
      const r = rebaseDraft(h.saved ?? h.base, h.present, a.base);
      return { base: a.base, past: [], present: r.draft, future: [], conflicts: liveConflicts([...h.conflicts, ...r.conflicts], a.base, r.draft) };
    }
    case "edit": {
      const next = a.update(h.present);
      if (next === h.present) return h;
      const coalesce = a.key !== undefined && a.key === h.lastKey;
      return {
        ...h,
        past: coalesce ? h.past : [...h.past, step()].slice(-UNDO_STEPS),
        present: next,
        future: [],
        lastKey: a.key,
        conflicts: liveConflicts(h.conflicts, h.base, next),
      };
    }
    case "undo": {
      const prev = h.past.at(-1);
      if (!prev) return h;
      return { ...h, past: h.past.slice(0, -1), present: prev.draft, conflicts: prev.conflicts, future: [step(), ...h.future] };
    }
    case "redo": {
      const next = h.future[0];
      if (!next) return h;
      return { ...h, past: [...h.past, step()], present: next.draft, conflicts: next.conflicts, future: h.future.slice(1) };
    }
    case "checkpoint":
      return h.lastKey ? { ...h, lastKey: undefined } : h;
    case "resolve": {
      // Only clashes still open: an item that has stopped clashing since is never reverted.
      const keys = new Set(a.keys.filter((k) => h.conflicts.includes(k)));
      if (!keys.size) return h;
      const settle = (conflicts: string[]) => conflicts.filter((k) => !keys.has(k));
      if (a.keep === "theirs") {
        // An edit like any other: undoing it brings back our version, and the clash.
        const next = revertItems(h.present, h.base, [...keys]);
        return {
          ...h,
          past: [...h.past, step()].slice(-UNDO_STEPS),
          present: next,
          future: [],
          lastKey: undefined,
          conflicts: settle(liveConflicts(h.conflicts, h.base, next)),
        };
      }
      // Ours stands. Settled for good: undo doesn't bring the clash back.
      const steps = (s: Step[]) => s.map((x) => ({ ...x, conflicts: settle(x.conflicts) }));
      return { ...h, past: steps(h.past), future: steps(h.future), conflicts: settle(h.conflicts) };
    }
    case "saved":
      return { ...h, saved: a.draft };
    case "adopt": {
      const next = setItems(h.present, a.values);
      return {
        ...h,
        past: [...h.past, step()].slice(-UNDO_STEPS),
        present: next,
        future: [],
        lastKey: undefined,
        conflicts: liveConflicts([...h.conflicts, ...a.conflicts], h.base, next),
      };
    }
  }
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "box"
  );
}

export function randomTag(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/**
 * Box ids look like `bx-a1f0-warehouse-migration` and name the file. A box that
 * isn't in git yet follows its title; once committed, its id never changes.
 */
export function boxId(tag: string, title: string): string {
  return `bx-${tag}-${slugify(title)}`;
}

/** The random part of a box id. */
const TAG = /^bx-([0-9a-f]{4})-/;

function tagOf(id: string): string {
  return TAG.exec(id)?.[1] ?? randomTag();
}

const NOTHING_RESERVED: Reserved = { codes: new Set(), ids: new Set() };

// Storing a draft (draftStore.ts keeps it): only the changed items, each with
// the version it was changed from, so it can be rebuilt on whatever roadmap
// is loaded then and rebased like any newer save.

/** The items `present` changes from `base` (`changes` is diffDraft's), with their versions in `base`. */
export function changedItems(base: DraftState, present: DraftState, changes: Changes): Record<string, DeltaItem> {
  const items: Record<string, DeltaItem> = {};
  const was = <T extends { id: string }>(list: T[]) => {
    const byId = new Map(list.map((x) => [x.id, x]));
    return (id: string) => byId.get(id);
  };
  const box = was(base.boxes);
  for (const b of changes.added) items[`box:${b.id}`] = { now: b };
  for (const b of changes.modified) items[`box:${b.id}`] = { old: box(b.id), now: b };
  for (const b of changes.removed) items[`box:${b.id}`] = { old: b };
  const dept = was(base.departments);
  for (const d of changes.departments) items[`dept:${d.id}`] = { old: dept(d.id), now: d };
  for (const d of changes.removedDepartments) items[`dept:${d.id}`] = { old: d };
  const person = was(base.people);
  for (const p of changes.people.added) items[`person:${p.id}`] = { now: p };
  for (const p of changes.people.changed) items[`person:${p.id}`] = { old: person(p.id), now: p };
  for (const p of changes.people.removed) items[`person:${p.id}`] = { old: p };
  if (changes.settings) items[SETTINGS_KEY] = { old: base.settings, now: present.settings };
  return items;
}

/**
 * `state` with the items named by key set to these values (undefined
 * removes one): each in its place in its list, new ones at the end.
 */
export function setItems(state: DraftState, values: ReadonlyMap<string, unknown>): DraftState {
  const set = <T extends { id: string }>(items: T[], kind: string): T[] => {
    const byId = new Map<string, unknown>();
    for (const [k, v] of values) if (k.startsWith(`${kind}:`)) byId.set(k.slice(kind.length + 1), v);
    if (!byId.size) return items;
    const out = items.flatMap((x) => (!byId.has(x.id) ? [x] : byId.get(x.id) === undefined ? [] : [byId.get(x.id) as T]));
    const had = new Set(items.map((x) => x.id));
    for (const [id, v] of byId) if (!had.has(id) && v !== undefined) out.push(v as T);
    return out;
  };
  const settings = values.get(SETTINGS_KEY);
  return {
    boxes: set(state.boxes, "box"),
    departments: set(state.departments, "dept"),
    people: set(state.people, "person"),
    settings: settings === undefined ? state.settings : (settings as Settings),
  };
}

/** Throws unless `value` can be the item `key` (or its absence). */
function checkItem(key: string, value: unknown): void {
  if (value === undefined) return;
  const kind = /^(box|dept|person):(.+)$/.exec(key);
  const ok =
    typeof value === "object" && value !== null && !Array.isArray(value) && (kind ? (value as { id?: unknown }).id === kind[2] : key === SETTINGS_KEY);
  if (!ok) throw new Error(`Not an item this BoxOps stores: ${key}`);
}

/**
 * A stored delta, restored onto `base` (the roadmap loaded now): the roadmap
 * it was made against is `base` with each item's old version, and the draft is
 * that with ours; then it's rebased like any newer save. Items nobody touched
 * are `base`'s own (as `base` reads them, whatever build stored the delta),
 * ours stay, and ones someone else changed meanwhile too are clashes. Throws
 * if the delta isn't one this BoxOps stores.
 */
export function restoreDelta(items: Record<string, DeltaItem>, base: DraftState): { draft: DraftState; conflicts: string[] } {
  const old = new Map<string, unknown>();
  const now = new Map<string, unknown>();
  for (const [key, item] of Object.entries(items)) {
    if (typeof item !== "object" || item === null) throw new Error(`Not an item this BoxOps stores: ${key}`);
    checkItem(key, item.old);
    checkItem(key, item.now);
    old.set(key, item.old);
    now.set(key, item.now);
  }
  const oldBase = setItems(base, old);
  return rebaseDraft(oldBase, setItems(oldBase, now), base);
}

/** A stored draft restored onto `base`, with the clashes it had and any new ones. */
export function restoreRecord(record: StoredDraft, base: DraftState): { draft: DraftState; conflicts: string[] } {
  const r = restoreDelta(record.items, base);
  return { draft: r.draft, conflicts: [...record.conflicts, ...r.conflicts] };
}

/**
 * The draft every tab shared before drafts were per tab (the whole roadmap as
 * loaded, `base`, and as edited) as a record; null if it can't be (one too old
 * to say what it was made against). Fields added since get their defaults; it
 * never said when it was written, so that's unknown ("").
 */
export function fromSharedDraft(value: unknown, current: DraftState): StoredDraft | null {
  type Shared = { base?: Partial<DraftState>; boxes?: Box[] } & Partial<Omit<DraftState, "boxes">>;
  const v = value as Shared | null;
  if (typeof v !== "object" || v === null || !Array.isArray(v.boxes) || typeof v.base !== "object" || v.base === null || !Array.isArray(v.base.boxes)) {
    return null;
  }
  const fte = (boxes: Box[]) => boxes.map((b) => ({ ...b, fte: b.fte ?? 1 }));
  try {
    const oldBase: DraftState = {
      boxes: fte(v.base.boxes),
      departments: v.base.departments ?? current.departments,
      people: v.base.people ?? [],
      settings: v.base.settings ?? current.settings,
    };
    const draft: DraftState = {
      boxes: fte(v.boxes),
      departments: v.departments ?? oldBase.departments,
      people: v.people ?? oldBase.people,
      settings: v.settings ?? oldBase.settings,
    };
    const items = changedItems(oldBase, draft, diffDraft(oldBase, draft));
    return { v: RECORD, format: FORMAT, build: "", baseCommit: "", savedAt: "", alive: 0, items, conflicts: [] };
  } catch {
    return null;
  }
}

/** A stored draft this tab didn't make: left by a tab that's gone, or one this BoxOps can't restore. */
export interface DraftOffer {
  key: string;
  /** As stored: what "Download my unsaved edits" saves. */
  value: unknown;
  /**
   * Restorable here, as `count` changes (lines of a save, as the toolbar
   * counts them); otherwise only to download or discard: written by another
   * version of BoxOps, or `unreadable` (not JSON, or broken).
   */
  restorable: boolean;
  unreadable: boolean;
  count: number;
  /** When it was last written (ISO 8601); "" if unknown. */
  savedAt: string;
}

/** Whether a stored draft is laid out by another version of BoxOps: another record layout or data format, or the old shared draft. */
const otherVersion = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && ((value as StoredDraft).v !== RECORD || (value as StoredDraft).format !== FORMAT);

function offerOf(found: FoundDraft, base: DraftState): DraftOffer {
  const offer = { key: found.key, value: found.value, restorable: false, unreadable: !otherVersion(found.value), count: 0, savedAt: savedAtOf(found.value) };
  if (!found.record) return offer;
  try {
    return { ...offer, restorable: true, unreadable: false, count: describeChanges(base, restoreRecord(found.record, base).draft).length };
  } catch {
    return { ...offer, unreadable: true };
  }
}

/** Offers for drafts left by tabs that are gone; ones with nothing left to restore (all of it saved since) are removed. */
function offersFor(left: FoundDraft[], base: DraftState, local: Store): DraftOffer[] {
  return left.flatMap((found) => {
    const offer = offerOf(found, base);
    if (!offer.restorable || offer.count) return [offer];
    removeDraft(found.key, local);
    return [];
  });
}

/**
 * Offers to restore counted again against `base`, a newer roadmap (a poll, a
 * save): what restoring each would change now. One with nothing left to
 * restore (all of it saved since) isn't offered. Download-only offers stay
 * as they are.
 */
export function recountOffers(offers: DraftOffer[], base: DraftState): DraftOffer[] {
  return offers.flatMap((offer) => {
    if (!offer.restorable) return [offer];
    const now = offerOf({ key: offer.key, value: offer.value, record: asRecord(offer.value) }, base);
    return now.restorable && !now.count ? [] : [now];
  });
}

/** What to store for a draft: its changed items, with what they were changed from; null when there's nothing to keep. */
function recordOf(
  { base, present, conflicts, changes, commit }: { base: DraftState; present: DraftState; conflicts: string[]; changes: Changes; commit: string },
  build: string,
): StoredDraft | null {
  if (!changes.count) return null;
  const now = new Date();
  const items = changedItems(base, present, changes);
  return { v: RECORD, format: FORMAT, build, baseCommit: commit, savedAt: now.toISOString(), alive: now.getTime(), items, conflicts };
}

/** Where this roadmap's draft is kept, and what to put in the record. */
export interface DraftOptions {
  /** `owner/repo@branch`. */
  scope: string;
  /** The commit `base` was read from. */
  commit: string;
  /** This BoxOps build (__BOXOPS_BUILD__). */
  build: string;
}

/**
 * Open this tab's drafts: its own (from before a reload, `reloaded` when this
 * page is one) restored onto `base`, and the others to offer. Its own draft,
 * if it can't be restored, stays as it is to download, and this tab takes a
 * fresh key. Drafts left by gone tabs with nothing left to restore (all of it
 * saved since) are removed. `adopted` is the page that wrote the draft
 * restored, now this page's to write.
 */
export function openDraft(base: DraftState, scope: string, stores: Stores, reloaded = false) {
  const now = Date.now();
  const opened = openTab(scope, now, stores, (value) => fromSharedDraft(value, base), reloaded);
  let { key } = opened;
  let restored: { draft: DraftState; conflicts: string[] } | undefined;
  let adopted: string | undefined;
  const offers: DraftOffer[] = [];
  if (opened.own) {
    try {
      if (opened.own.record) {
        restored = restoreRecord(opened.own.record, base);
        adopted = pageOf(opened.own.value);
      }
    } catch {
      // Offered to download below.
    }
    if (!restored) {
      key = newTabKey(scope, stores);
      offers.push(offerOf(opened.own, base));
    }
  }
  offers.push(...offersFor(opened.orphans, base, stores.local));
  return { key, adopted, restored, offers };
}

export function useDraft(base: DraftState, { scope, commit, build }: DraftOptions) {
  const [stores] = useState(browserStores);
  const [opened] = useState(() => openDraft(base, scope, stores, wasReloaded()));
  const [history, setHistory] = useState<History>(() => startHistory(base, opened.restored));
  const dispatch = useCallback((a: HistoryAction) => setHistory((h) => reduceHistory(h, a)), []);

  // A newer roadmap arrived (our own save, or someone else's): carry the draft
  // over. Setting state while rendering makes React re-render straight away with it.
  if (history.base !== base) setHistory(reduceHistory(history, { type: "rebase", base }));
  const { present, conflicts } = history;

  const changes = useMemo(() => diffDraft(base, present), [base, present]);

  // Kept in storage: this tab's draft, as a delta (draftStore.ts).
  /** Whether storage holds the draft as it is (a full or blocked storage refuses writes). */
  const [kept, setKept] = useState(true);
  /** Where: it changes if another tab turns out to share this one's id (a duplicated tab). */
  const [storageKey, setStorageKey] = useState(opened.key);
  const [writer] = useState(
    () => new DraftWriter(opened.key, scope, stores, { result: setKept, move: setStorageKey }, opened.adopted),
  );
  // A pause after the last change writes it; nothing left to keep removes it at once.
  useEffect(() => {
    writer.track(() => recordOf({ base, present, conflicts, changes, commit }, build));
    if (changes.count) writer.changed();
    else writer.write();
  }, [writer, base, present, conflicts, changes, commit, build]);

  /** Other open tabs with unsaved changes to this roadmap. */
  const [others, setOthers] = useState(0);
  /** Drafts this tab didn't make: left by tabs that are gone, or that this BoxOps can't restore. */
  const [offers, setOffers] = useState(opened.offers);
  // For the heartbeat, which looks for drafts left since by tabs that have gone.
  const latest = useRef({ base, offers });
  useEffect(() => {
    latest.current = { base, offers };
  }, [base, offers]);
  // A newer roadmap (a poll, a save): each offer says what restoring it would change now.
  const offered = useMemo(() => recountOffers(offers, base), [offers, base]);
  // While the tab is open its draft is marked alive (a heartbeat); once it
  // closes (or goes into the back/forward cache), closed. Another tab's
  // draft coming or going updates the notice, and one on offer that its tab
  // took back (or another tab restored) stops being offered. While the tab is
  // in view, each heartbeat also offers drafts left since by tabs that have
  // gone (closed, or crashed: not marked alive for STALE_MS).
  useEffect(() => {
    const { local } = stores;
    const count = () => setOthers(otherTabs(scope, writer.key, Date.now(), local));
    const lookAround = () => {
      if (document.hidden) return;
      const known = new Set([...latest.current.offers.map((o) => o.key), ...writer.removing]);
      const left = leftBehind(scope, writer.key, Date.now(), local).filter((f) => !known.has(f.key));
      const more = offersFor(left, latest.current.base, local);
      if (more.length) setOffers((cur) => [...cur, ...more.filter((o) => !cur.some((c) => c.key === o.key))]);
    };
    const beat = () => {
      writer.beat(Date.now());
      count();
      lookAround();
    };
    const close = () => {
      writer.flush();
      writer.mark(0);
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) beat();
    };
    const onVisibility = () => (document.hidden ? writer.flush() : beat());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && !e.key.startsWith(DRAFT_PREFIX)) return;
      // Another page changed this tab's key: one sharing its id (this tab moves
      // to a new one), or one that restored this tab's draft while it slept.
      if (e.key === writer.key) {
        beat();
        return;
      }
      count();
      setOffers((cur) => {
        const now = Date.now();
        const left = cur.filter((o) => isLeft(o.key, now, local));
        return left.length === cur.length ? cur : left;
      });
    };
    writer.mark(Date.now());
    count();
    const timer = setInterval(beat, HEARTBEAT_MS);
    window.addEventListener("pagehide", close);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [stores, scope, writer]);

  /**
   * Bring in a draft left by a tab that's gone: its items over ours, as one
   * undo step. It's removed once this tab's draft, with them in, is written.
   */
  const restoreOffer = useCallback(
    (key: string) => {
      const found = asRecord(readValue(stores.local, key));
      setOffers((cur) => cur.filter((o) => o.key !== key));
      if (!found) return; // gone meanwhile: another tab restored or discarded it
      let r: { draft: DraftState; conflicts: string[] };
      try {
        r = restoreRecord(found, base);
      } catch {
        return;
      }
      const values = new Map(Object.keys(found.items).map((k) => [k, entityOf(r.draft, k)]));
      dispatch({ type: "adopt", values, conflicts: r.conflicts });
      writer.removeOnceWritten(key);
    },
    [stores, base, dispatch, writer],
  );
  /** Throw away a draft on offer, for good. */
  const discardOffer = useCallback(
    (key: string) => {
      setOffers((cur) => cur.filter((o) => o.key !== key));
      removeDraft(key, stores.local);
    },
    [stores],
  );

  const apply = useCallback(
    (update: (draft: DraftState) => DraftState, key?: string) => dispatch({ type: "edit", update, key }),
    [dispatch],
  );

  const applyBoxes = useCallback(
    (update: (boxes: Box[]) => Box[], key?: string) => apply((d) => ({ ...d, boxes: update(d.boxes) }), key),
    [apply],
  );

  const baseIds = useMemo(() => new Set(base.boxes.map((b) => b.id)), [base.boxes]);

  /**
   * Patch one box. Returns the box's id afterwards, which changes when an
   * uncommitted box is retitled.
   */
  const updateBox = useCallback(
    (id: string, patch: Partial<Box>, key?: string): string => {
      let newId = id;
      if (patch.title !== undefined && !baseIds.has(id)) newId = boxId(tagOf(id), patch.title);
      applyBoxes((boxes) => boxes.map((b) => (b.id === id ? { ...b, ...patch, id: newId } : b)), key);
      return newId;
    },
    [applyBoxes, baseIds],
  );

  /**
   * Add a box with a fresh code and id; returns its id. Neither is one a box
   * has, nor one in `reserved` (box files the loader couldn't fully read: a
   * save over one is refused).
   */
  const addBox = useCallback(
    (box: Omit<Box, "id" | "code">, reserved: Reserved = NOTHING_RESERVED): string => {
      // A tag no other box has, so the id stays unique however the box is retitled.
      const tags = new Set([...[...base.boxes, ...present.boxes].map((b) => b.id), ...reserved.ids].map((x) => TAG.exec(x)?.[1]));
      let tag = randomTag();
      for (let n = 0; tags.has(tag) && n < 100; n++) tag = randomTag();
      const id = boxId(tag, box.title);
      applyBoxes((boxes) => [...boxes, { ...box, id, code: newBoxCode(new Set([...boxes.map((b) => b.code), ...reserved.codes])) }]);
      return id;
    },
    [applyBoxes, base.boxes, present.boxes],
  );

  /** Remove a box, and any rules on other boxes that point at it, as one undo step. */
  const removeBox = useCallback(
    (id: string) =>
      applyBoxes((boxes) => {
        const gone = boxes.find((b) => b.id === id);
        return boxes
          .filter((b) => b.id !== id)
          .map((b) =>
            gone && b.relations?.some((r) => r.box === gone.code)
              ? { ...b, relations: b.relations.filter((r) => r.box !== gone.code) }
              : b,
          );
      }),
    [applyBoxes],
  );

  const updateLane = useCallback(
    (laneId: string, patch: Partial<Omit<Lane, "id">>, key?: string) =>
      apply(
        (d) => ({
          ...d,
          departments: d.departments.map((dept) =>
            dept.lanes.some((l) => l.id === laneId)
              ? { ...dept, lanes: dept.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)) }
              : dept,
          ),
        }),
        key,
      ),
    [apply],
  );

  // Departments and lanes: each is one undo step. Removing never drops work:
  // boxes in a removed lane or department move to `moveTo`.
  const addDepartment = useCallback(
    (name: string, color?: string, code?: string, skipped?: readonly string[]): string => {
      const { id } = structure.addDepartment(present, name, color, code, skipped);
      apply((d) => structure.addDepartment(d, name, color, code, skipped).state);
      return id;
    },
    [apply, present],
  );
  const updateDepartment = useCallback(
    (id: string, patch: Partial<Pick<Department, "name" | "color" | "code">>, key?: string) =>
      apply((d) => structure.updateDepartment(d, id, patch), key),
    [apply],
  );
  const moveDepartment = useCallback((id: string, dir: -1 | 1) => apply((d) => structure.moveDepartment(d, id, dir)), [apply]);
  const placeDepartment = useCallback((id: string, index: number) => apply((d) => structure.placeDepartment(d, id, index)), [apply]);
  const removeDepartment = useCallback(
    (id: string, moveTo?: string) => apply((d) => structure.removeDepartment(d, id, moveTo)),
    [apply],
  );
  const addLane = useCallback(
    (deptId: string, fte = 1): string => {
      const { laneId } = structure.addLane(present, deptId, fte);
      apply((d) => structure.addLane(d, deptId, fte).state);
      return laneId;
    },
    [apply, present],
  );
  const moveLane = useCallback((laneId: string, dir: -1 | 1) => apply((d) => structure.moveLane(d, laneId, dir)), [apply]);
  const removeLane = useCallback(
    (laneId: string, moveTo?: string) => apply((d) => structure.removeLane(d, laneId, moveTo)),
    [apply],
  );

  /** Add an engineer to the roster; returns their id (a slug of the name, made unique). */
  const addPerson = useCallback(
    (name: string, department?: string): string => {
      const taken = new Set(present.people.map((p) => p.id));
      const slug = slugify(name).replace(/^box$/, "engineer");
      let id = slug;
      for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
      apply((d) => ({ ...d, people: [...d.people, { id, name: name.trim(), department }] }));
      return id;
    },
    [apply, present.people],
  );

  const basePeople = useMemo(() => new Set(base.people.map((p) => p.id)), [base.people]);

  /**
   * Edit an engineer's details. Returns their id afterwards: someone not saved
   * yet gets an id that follows their name (and their boxes follow along);
   * once saved, the id never changes.
   */
  const updatePerson = useCallback(
    (id: string, patch: Partial<Omit<Person, "id">>, key?: string): string => {
      let newId = id;
      if (patch.name?.trim() && !basePeople.has(id)) {
        const taken = new Set(present.people.filter((p) => p.id !== id).map((p) => p.id));
        const slug = slugify(patch.name).replace(/^box$/, "engineer");
        newId = slug;
        for (let n = 2; taken.has(newId); n++) newId = `${slug}-${n}`;
      }
      apply(
        (d) => ({
          ...d,
          people: d.people.map((p) => (p.id === id ? { ...p, ...patch, id: newId } : p)),
          boxes:
            newId === id
              ? d.boxes
              : d.boxes.map((b) =>
                  b.engineers?.includes(id) ? { ...b, engineers: b.engineers.map((e) => (e === id ? newId : e)) } : b,
                ),
        }),
        key,
      );
      return newId;
    },
    [apply, basePeople, present.people],
  );

  /** Remove an engineer and unassign them from every box, as one undo step. */
  const removePerson = useCallback(
    (id: string) =>
      apply((d) => ({
        ...d,
        people: d.people.filter((p) => p.id !== id),
        boxes: d.boxes.map((b) =>
          b.engineers?.includes(id) ? { ...b, engineers: b.engineers.filter((e) => e !== id) } : b,
        ),
      })),
    [apply],
  );

  const undo = useCallback(() => dispatch({ type: "undo" }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: "redo" }), [dispatch]);
  /** Throw the whole draft away (undoable). */
  const discard = useCallback(() => apply(() => base), [apply, base]);
  /** Settle these clashes (the ones the user was shown): keep our version, or take the latest saved one. */
  const resolve = useCallback((keys: string[], keep: "mine" | "theirs") => dispatch({ type: "resolve", keys, keep }), [dispatch]);
  /** Our save wrote `draft`: the roadmap it comes back with is rebased from that, so edits made meanwhile are ours. */
  const saved = useCallback((draft: DraftState) => dispatch({ type: "saved", draft }), [dispatch]);
  /** Ends typing coalescing, e.g. when the editor closes. */
  const checkpoint = useCallback(() => dispatch({ type: "checkpoint" }), [dispatch]);

  /** Change team settings; `key` groups keystrokes in one field into a single undo step. */
  const updateSettings = useCallback(
    (patch: Partial<Settings>, key?: string) => apply((d) => ({ ...d, settings: { ...d.settings, ...patch } }), key),
    [apply],
  );

  return {
    boxes: present.boxes,
    departments: present.departments,
    people: present.people,
    settings: present.settings,
    updateSettings,
    changes,
    conflicts,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    updateBox,
    addBox,
    removeBox,
    updateLane,
    addDepartment,
    updateDepartment,
    moveDepartment,
    placeDepartment,
    removeDepartment,
    addLane,
    moveLane,
    removeLane,
    addPerson,
    updatePerson,
    removePerson,
    undo,
    redo,
    discard,
    resolve,
    saved,
    checkpoint,
    /** Where this tab keeps its draft (the crash screen offers it). */
    storageKey,
    kept,
    /** Write any change still waiting now (before saving). */
    flush: useCallback(() => writer.flush(), [writer]),
    others,
    /** Drafts on offer, as restoring each would change the roadmap now. */
    offers: offered,
    restoreOffer,
    discardOffer,
  };
}
