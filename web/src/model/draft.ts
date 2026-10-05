// The editing draft: boxes and departments as the user has changed them, with
// undo/redo, a diff against what was loaded, and a copy in localStorage so a
// refresh never loses work. Nothing here touches git; committing is a later step.

import { useCallback, useEffect, useMemo, useState } from "react";
import { newBoxCode } from "./relations";
import * as structure from "./structure";
import type { Box, Department, Lane, Person, Settings } from "./types";

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

export function diffDraft(base: DraftState, current: DraftState): Changes {
  const boxes = diffBoxes(base.boxes, current.boxes);
  const baseDepts = new Map(base.departments.map((d) => [d.id, d]));
  const departments = current.departments.filter((d) => {
    const was = baseDepts.get(d.id);
    return !was || !same(was, d);
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
  const orderOnly = departments.filter((d) => {
    const was = baseDepts.get(d.id);
    return was && was.order !== d.order && same({ ...was, order: d.order }, d);
  }).length;
  const deptCount = departments.length - orderOnly + (orderOnly ? 1 : 0);
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
 * undefined compare equal) and keys sorted (a box built in the app lists its
 * fields in a different order than one read from a file).
 */
export function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (x === undefined || x === "" || (Array.isArray(x) && x.length === 0)) continue;
    out[k] = normalize(x);
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
 * keep our version and are reported, so the user decides before saving.
 */
export function rebaseDraft(oldBase: DraftState, draft: DraftState, newBase: DraftState) {
  const conflicts: string[] = [];
  // Settings are one item: ours if we changed them, else theirs.
  const oursSettings = !same(oldBase.settings, draft.settings);
  const theirsSettings = !same(oldBase.settings, newBase.settings);
  if (oursSettings && theirsSettings && !same(draft.settings, newBase.settings)) conflicts.push(SETTINGS_KEY);
  return {
    draft: {
      boxes: mergeById(oldBase.boxes, draft.boxes, newBase.boxes, "box", conflicts),
      departments: mergeById(oldBase.departments, draft.departments, newBase.departments, "dept", conflicts),
      people: mergeById(oldBase.people, draft.people, newBase.people, "person", conflicts),
      settings: oursSettings ? draft.settings : newBase.settings,
    },
    conflicts,
  };
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
 * order, so moving someone would be a change of its own.
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
  return {
    boxes: revert(draft.boxes, base.boxes, "box"),
    departments: revert(draft.departments, base.departments, "dept"),
    people: revert(draft.people, base.people, "person"),
    settings: keys.includes(SETTINGS_KEY) ? base.settings : draft.settings,
  };
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
  | { type: "saved"; draft: DraftState };

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

function tagOf(id: string): string {
  return /^bx-([0-9a-f]{4})-/.exec(id)?.[1] ?? randomTag();
}

/** Where a roadmap's draft is kept in localStorage; `scope` is `owner/repo@branch`. */
export const draftKey = (scope: string) => `boxops-draft:${scope}`;

interface Stored {
  baseHash: string;
  /** The roadmap the draft was made against, so it can be carried onto a newer one. */
  base?: DraftState;
  boxes: Box[];
  departments?: Department[];
  people?: Person[];
  settings?: Settings;
}

/** The saved draft, carried onto `base` if someone saved since it was written. */
function readStored(scope: string, baseHash: string, base: DraftState): { draft: DraftState; conflicts: string[] } | null {
  try {
    const raw = localStorage.getItem(draftKey(scope));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Stored;
    if (!Array.isArray(saved.boxes)) return null;
    // Drafts saved before a field existed get its default.
    const draft = {
      boxes: saved.boxes.map((b) => ({ ...b, fte: b.fte ?? 1 })),
      departments: saved.departments ?? base.departments,
      people: saved.people ?? base.people,
      settings: saved.settings ?? base.settings,
    };
    if (saved.baseHash === baseHash) return { draft, conflicts: [] };
    if (!saved.base) return null;
    const oldBase = {
      boxes: saved.base.boxes.map((b) => ({ ...b, fte: b.fte ?? 1 })),
      departments: saved.base.departments,
      people: saved.base.people ?? [],
      settings: saved.base.settings ?? base.settings,
    };
    return rebaseDraft(oldBase, draft, base);
  } catch {
    return null;
  }
}

function writeStored(scope: string, baseHash: string, base: DraftState, draft: DraftState | null): void {
  try {
    if (draft === null) localStorage.removeItem(draftKey(scope));
    else localStorage.setItem(draftKey(scope), JSON.stringify({ baseHash, base, ...draft } satisfies Stored));
  } catch {
    // Private browsing or full storage: the draft just won't survive a refresh.
  }
}

/** Short stable hash of the loaded files, so a draft is only restored onto the version it was made from. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function useDraft(base: DraftState, scope: string, baseHash: string) {
  const [history, setHistory] = useState<History>(() => startHistory(base, readStored(scope, baseHash, base) ?? undefined));
  const dispatch = useCallback((a: HistoryAction) => setHistory((h) => reduceHistory(h, a)), []);

  // A newer roadmap arrived (our own save, or someone else's): carry the draft
  // over. Setting state while rendering makes React re-render straight away with it.
  if (history.base !== base) setHistory(reduceHistory(history, { type: "rebase", base }));
  const { present, conflicts } = history;

  const changes = useMemo(() => diffDraft(base, present), [base, present]);

  useEffect(() => {
    writeStored(scope, baseHash, base, changes.count ? present : null);
  }, [scope, baseHash, base, present, changes.count]);

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

  /** Add a box with a fresh unique code; returns its id. */
  const addBox = useCallback(
    (box: Omit<Box, "id" | "code">): string => {
      const id = boxId(randomTag(), box.title);
      applyBoxes((boxes) => [...boxes, { ...box, id, code: newBoxCode(new Set(boxes.map((b) => b.code))) }]);
      return id;
    },
    [applyBoxes],
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
  };
}
