// The editing draft: boxes and departments as the user has changed them, with
// undo/redo, a diff against what was loaded, and a copy in localStorage so a
// refresh never loses work. Nothing here touches git; committing is a later step.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Box, Department, Lane, Person } from "./types";

export interface DraftState {
  boxes: Box[];
  departments: Department[];
  people: Person[];
}

interface History {
  /** The loaded roadmap this draft is relative to. */
  base: DraftState;
  past: DraftState[];
  present: DraftState;
  future: DraftState[];
  /** Consecutive edits with the same key (typing in one field) form one undo step. */
  lastKey?: string;
  /** Items (`box:<id>`, `dept:<id>`) someone else changed while we were editing them too. */
  conflicts: string[];
}

export interface Changes {
  added: Box[];
  modified: Box[];
  removed: Box[];
  /** Departments whose settings or lanes changed. */
  departments: Department[];
  /** Engineers added, renamed or removed. */
  people: { added: Person[]; changed: Person[]; removed: Person[] };
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
  const basePeople = new Map(base.people.map((p) => [p.id, p]));
  const currentPeople = new Set(current.people.map((p) => p.id));
  const people = {
    added: current.people.filter((p) => !basePeople.has(p.id)),
    changed: current.people.filter((p) => basePeople.has(p.id) && !same(basePeople.get(p.id)!, p)),
    removed: base.people.filter((p) => !currentPeople.has(p.id)),
  };
  const peopleCount = people.added.length + people.changed.length + people.removed.length;
  return { ...boxes, departments, people, count: boxes.count + departments.length + peopleCount };
}

function same<T extends object>(a: T, b: T): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * Canonical form for comparing: empty optional fields dropped (so "" and
 * undefined compare equal) and keys sorted (a box built in the app lists its
 * fields in a different order than one read from a file).
 */
function normalize(v: unknown): unknown {
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
  return {
    draft: {
      boxes: mergeById(oldBase.boxes, draft.boxes, newBase.boxes, "box", conflicts),
      departments: mergeById(oldBase.departments, draft.departments, newBase.departments, "dept", conflicts),
      people: mergeById(oldBase.people, draft.people, newBase.people, "person", conflicts),
    },
    conflicts,
  };
}

const entityOf = (state: DraftState, key: string) => {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "box") return state.boxes.find((b) => b.id === id);
  if (kind === "person") return state.people.find((p) => p.id === id);
  return state.departments.find((d) => d.id === id);
};

/** `draft` with these items put back to how they are in `base` (taking "theirs"). */
export function revertItems(draft: DraftState, base: DraftState, keys: string[]): DraftState {
  const revert = <T extends { id: string }>(items: T[], baseItems: T[], kind: string) => {
    const keyed = new Set(keys.filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1)));
    if (!keyed.size) return items;
    const kept = items.filter((x) => !keyed.has(x.id));
    return [...kept, ...baseItems.filter((x) => keyed.has(x.id))];
  };
  return {
    boxes: revert(draft.boxes, base.boxes, "box"),
    departments: revert(draft.departments, base.departments, "dept"),
    people: revert(draft.people, base.people, "person"),
  };
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

const storageKey = (scope: string) => `boxops-draft:${scope}`;

interface Stored {
  baseHash: string;
  /** The roadmap the draft was made against, so it can be carried onto a newer one. */
  base?: DraftState;
  boxes: Box[];
  departments?: Department[];
  people?: Person[];
}

/** The saved draft, carried onto `base` if someone saved since it was written. */
function readStored(scope: string, baseHash: string, base: DraftState): { draft: DraftState; conflicts: string[] } | null {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Stored;
    if (!Array.isArray(saved.boxes)) return null;
    // Drafts saved before a field existed get its default.
    const draft = {
      boxes: saved.boxes.map((b) => ({ ...b, fte: b.fte ?? 1 })),
      departments: saved.departments ?? base.departments,
      people: saved.people ?? base.people,
    };
    if (saved.baseHash === baseHash) return { draft, conflicts: [] };
    if (!saved.base) return null;
    const oldBase = {
      boxes: saved.base.boxes.map((b) => ({ ...b, fte: b.fte ?? 1 })),
      departments: saved.base.departments,
      people: saved.base.people ?? [],
    };
    return rebaseDraft(oldBase, draft, base);
  } catch {
    return null;
  }
}

function writeStored(scope: string, baseHash: string, base: DraftState, draft: DraftState | null): void {
  try {
    if (draft === null) localStorage.removeItem(storageKey(scope));
    else localStorage.setItem(storageKey(scope), JSON.stringify({ baseHash, base, ...draft } satisfies Stored));
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
  const [history, setHistory] = useState<History>(() => {
    const stored = readStored(scope, baseHash, base);
    return { base, past: [], present: stored?.draft ?? base, future: [], conflicts: stored?.conflicts ?? [] };
  });

  // A newer roadmap arrived (our own save, or someone else's): carry the draft
  // over. Undo history refers to the old roadmap, so it starts fresh.
  if (history.base !== base) {
    const r = rebaseDraft(history.base, history.present, base);
    const next: History = {
      base,
      past: [],
      present: r.draft,
      future: [],
      conflicts: [...new Set([...history.conflicts, ...r.conflicts])],
    };
    // Setting state while rendering makes React re-render straight away with it.
    setHistory(next);
  }
  const { present } = history;

  /** Conflicts that still matter: the item still differs from the latest roadmap. */
  const conflicts = useMemo(
    () => history.conflicts.filter((k) => !sameOrBothMissing(entityOf(base, k), entityOf(present, k))),
    [history.conflicts, base, present],
  );

  const changes = useMemo(() => diffDraft(base, present), [base, present]);

  useEffect(() => {
    writeStored(scope, baseHash, base, changes.count ? present : null);
  }, [scope, baseHash, base, present, changes.count]);

  const apply = useCallback((update: (draft: DraftState) => DraftState, key?: string) => {
    setHistory((h) => {
      const next = update(h.present);
      if (next === h.present) return h;
      const coalesce = key !== undefined && key === h.lastKey;
      return {
        ...h,
        past: coalesce ? h.past : [...h.past, h.present].slice(-200),
        present: next,
        future: [],
        lastKey: key,
      };
    });
  }, []);

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

  const addBox = useCallback(
    (box: Omit<Box, "id">): string => {
      const id = boxId(randomTag(), box.title);
      applyBoxes((boxes) => [...boxes, { ...box, id }]);
      return id;
    },
    [applyBoxes],
  );

  const removeBox = useCallback(
    (id: string) => applyBoxes((boxes) => boxes.filter((b) => b.id !== id)),
    [applyBoxes],
  );

  const updateLane = useCallback(
    (laneId: string, patch: Partial<Omit<Lane, "id">>) =>
      apply((d) => ({
        ...d,
        departments: d.departments.map((dept) =>
          dept.lanes.some((l) => l.id === laneId)
            ? { ...dept, lanes: dept.lanes.map((l) => (l.id === laneId ? { ...l, ...patch } : l)) }
            : dept,
        ),
      })),
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

  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length
          ? { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length ? { ...h, past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h,
      ),
    [],
  );
  /** Throw the whole draft away (undoable). */
  const discard = useCallback(() => apply(() => base), [apply, base]);
  /** Resolve conflicts by taking the latest saved version of these items. */
  const takeTheirs = useCallback((keys: string[]) => apply((d) => revertItems(d, base, keys)), [apply, base]);
  /** Ends typing coalescing, e.g. when the editor closes. */
  const checkpoint = useCallback(() => setHistory((h) => (h.lastKey ? { ...h, lastKey: undefined } : h)), []);

  return {
    boxes: present.boxes,
    departments: present.departments,
    people: present.people,
    changes,
    conflicts,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    updateBox,
    addBox,
    removeBox,
    updateLane,
    addPerson,
    updatePerson,
    removePerson,
    undo,
    redo,
    discard,
    takeTheirs,
    checkpoint,
  };
}
