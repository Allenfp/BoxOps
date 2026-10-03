// The editing draft: boxes and departments as the user has changed them, with
// undo/redo, a diff against what was loaded, and a copy in localStorage so a
// refresh never loses work. Nothing here touches git; committing is a later step.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Box, Department, Lane } from "./types";

export interface DraftState {
  boxes: Box[];
  departments: Department[];
}

interface History {
  past: DraftState[];
  present: DraftState;
  future: DraftState[];
  /** Consecutive edits with the same key (typing in one field) form one undo step. */
  lastKey?: string;
}

export interface Changes {
  added: Box[];
  modified: Box[];
  removed: Box[];
  /** Departments whose settings or lanes changed. */
  departments: Department[];
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
  return { ...boxes, departments, count: boxes.count + departments.length };
}

function same<T extends object>(a: T, b: T): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Drop empty optional fields (recursively) so "" and undefined compare equal. */
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v !== "object" || v === null) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === undefined || x === "" || (Array.isArray(x) && x.length === 0)) continue;
    out[k] = normalize(x);
  }
  return out;
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

function readStored(scope: string, baseHash: string, base: DraftState): DraftState | null {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { baseHash: string } & Partial<DraftState>;
    if (saved.baseHash !== baseHash || !Array.isArray(saved.boxes)) return null;
    return { boxes: saved.boxes, departments: saved.departments ?? base.departments };
  } catch {
    return null;
  }
}

function writeStored(scope: string, baseHash: string, draft: DraftState | null): void {
  try {
    if (draft === null) localStorage.removeItem(storageKey(scope));
    else localStorage.setItem(storageKey(scope), JSON.stringify({ baseHash, ...draft }));
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
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: readStored(scope, baseHash, base) ?? base,
    future: [],
  }));
  const { present } = history;

  const changes = useMemo(() => diffDraft(base, present), [base, present]);

  useEffect(() => {
    writeStored(scope, baseHash, changes.count ? present : null);
  }, [scope, baseHash, present, changes.count]);

  const apply = useCallback((update: (draft: DraftState) => DraftState, key?: string) => {
    setHistory((h) => {
      const next = update(h.present);
      if (next === h.present) return h;
      const coalesce = key !== undefined && key === h.lastKey;
      return {
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

  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length
          ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h,
      ),
    [],
  );
  /** Throw the whole draft away (undoable). */
  const discard = useCallback(() => apply(() => base), [apply, base]);
  /** Ends typing coalescing, e.g. when the editor closes. */
  const checkpoint = useCallback(() => setHistory((h) => (h.lastKey ? { ...h, lastKey: undefined } : h)), []);

  return {
    boxes: present.boxes,
    departments: present.departments,
    changes,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    updateBox,
    addBox,
    removeBox,
    updateLane,
    undo,
    redo,
    discard,
    checkpoint,
  };
}
