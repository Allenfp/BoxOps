// Turns the draft back into YAML file changes. Changed files are edited in
// place through the `yaml` Document API, so comments, key order and quoting in
// the original survive and a commit's diff shows only the lines that really
// changed: only fields that differ from what was loaded are touched, list
// entries are matched up one by one, and a file keeps its BOM and line endings.
// Titles and names are written without spaces at either end.
//
// A file the loader couldn't fully read is never written (UnsafeWrite): that
// would delete whatever the loader left out.

import { Document, isMap, isScalar, isSeq, parseDocument, visit, type YAMLMap, type YAMLSeq } from "yaml";
import { formatDay } from "./dates";
import { diffDraft, normalize, type DraftState } from "./draft";
import { FORMAT } from "./format";
import { DEFAULT_DEPT_COLOR, type LoadResult } from "./load";
import { loadRoadmap } from "./parse";
import type { Box, Department, Person, RoadmapFiles, Settings } from "./types";

/** path → new file text, or null to delete the file. */
export type FileChanges = Record<string, string | null>;

/** A save would write files the loader couldn't fully read (or a roadmap in another data format). */
export class UnsafeWrite extends Error {
  constructor(readonly files: { path: string; problems: string[] }[]) {
    super(
      "Saving would delete parts of these files the app couldn’t read; fix them in the file first. " +
        files.map((f) => `roadmap/${f.path}: ${f.problems.join("; ")}`).join(" · "),
    );
  }
}

type Plain = Record<string, unknown>;

/** Field order for newly written files; also the set of keys the app owns. */
const BOX_KEYS = [
  "id",
  "code",
  "title",
  "lane",
  "start",
  "end",
  "type",
  "status",
  "fte",
  "engineers",
  "relations",
  "epic",
  "description",
  "tags",
  "links",
];
const DEPT_KEYS = ["id", "code", "name", "color", "order", "collapsed", "lanes"];
const LANE_KEYS = ["id", "name", "fte", "start", "end"];
const PERSON_KEYS = ["id", "name", "department", "role", "email", "manager", "notes", "pto"];
const SETTINGS_KEYS = ["format", "title", "fiscal_year_start_month", "default_zoom", "types", "statuses"];

/** How a list of mappings is merged: entries matched by `id`, or (PTO, rules) by what they say. */
interface ListSpec {
  keys: string[];
  byId?: boolean;
  lists?: Lists;
}
type Lists = Record<string, ListSpec>;

const BOX_LISTS: Lists = { relations: { keys: ["type", "box"] } };
const DEPT_LISTS: Lists = { lanes: { keys: LANE_KEYS, byId: true } };
const PEOPLE_LISTS: Lists = { people: { keys: PERSON_KEYS, byId: true, lists: { pto: { keys: ["start", "end", "note"] } } } };
const SETTINGS_LISTS: Lists = {
  types: { keys: ["id", "name", "color"], byId: true },
  statuses: { keys: ["id", "name"], byId: true },
};

/** A key that is absent from the file means this value. */
const DEFAULTS: Plain = { fte: 1, collapsed: false, order: 0, color: DEFAULT_DEPT_COLOR };

/** yaml's output options, keeping what it can of the file's own style. */
function style(indentless = false) {
  return { lineWidth: 0, flowCollectionPadding: false, indentSeq: !indentless } as const;
}

/**
 * Whether a list in the parsed file is written flush with its key
 * ("lanes:\n- id: x"), so the file is written back that way. Read from the
 * nodes' positions, so text that only looks like a list (inside a `|` block)
 * doesn't count.
 */
function indentless(doc: Document, text: string): boolean {
  const column = (offset: number) => {
    const start = text.lastIndexOf("\n", offset - 1) + 1;
    return offset - start - (start === 0 && text.startsWith("\uFEFF") ? 1 : 0);
  };
  let flush = false;
  visit(doc, {
    Pair(_, { key, value }) {
      if (!isSeq(value) || value.flow || !value.range || !isScalar(key) || !key.range) return;
      if (column(value.range[0]) > column(key.range[0])) return;
      flush = true;
      return visit.BREAK;
    },
  });
  return flush;
}

function boxToPlain(b: Box): Plain {
  return { ...b, title: b.title.trim(), start: formatDay(b.start), end: formatDay(b.end) };
}

function personToPlain(p: Person): Plain {
  return {
    ...p,
    name: p.name.trim(),
    pto: p.pto?.map((t) => ({ start: formatDay(t.start), end: formatDay(t.end), ...(t.note?.trim() && { note: t.note.trim() }) })),
  };
}

function deptToPlain(d: Department): Plain {
  return {
    ...d,
    name: d.name.trim(),
    lanes: d.lanes.map((l) => ({
      ...l,
      name: l.name?.trim() || undefined,
      start: l.start === undefined ? undefined : formatDay(l.start),
      end: l.end === undefined ? undefined : formatDay(l.end),
    })),
  };
}

function settingsToPlain(s: Settings): Plain {
  const named = <T extends { name: string }>(list: T[]) => list.map((x) => ({ ...x, name: x.name.trim() }));
  return { format: FORMAT, ...s, title: s.title.trim(), types: named(s.types), statuses: named(s.statuses) };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The same once empty fields are dropped and keys sorted, as the draft compares. */
const same = (a: unknown, b: unknown) => sameValue(normalize(a), normalize(b));

/**
 * Bring `map` in line with `value` for the keys we own. A key whose value is
 * what was loaded (`base`) is left exactly as written, and keys we don't know
 * about are left alone, so hand-added fields survive app edits.
 */
function mergeMap(doc: Document, map: YAMLMap, value: Plain, base: Plain | undefined, keys: string[], lists: Lists, defaults: Plain) {
  for (const key of keys) {
    const v = value[key];
    if (base && same(v, base[key])) continue;
    const node = map.get(key, true);
    if (isEmpty(v)) {
      // people.yaml keeps its key when the roster is emptied: `people: []`, not `{}`.
      if (key === "people") map.set(key, doc.createNode([]));
      else if (map.has(key)) map.delete(key);
      continue;
    }
    if (!map.has(key) && sameValue(v, defaults[key])) continue;
    const list = lists[key];
    if (list && Array.isArray(v) && isSeq(node)) {
      mergeList(doc, node, v as Plain[], (base?.[key] as Plain[] | undefined) ?? [], list, defaults);
      continue;
    }
    const current = node === undefined ? undefined : map.toJSON()[key];
    if (sameValue(current, v)) continue;
    if (map.has(key)) {
      // A plain value is changed in place, so a comment beside it survives.
      if (isScalar(node) && (typeof v !== "object" || v === null)) node.value = v;
      else {
        const fresh = doc.createNode(orderedList(v, list, defaults));
        // `people: # note` with nobody listed yet: the note moves to the top of the new list.
        if (isScalar(node) && node.comment) fresh.commentBefore = node.comment;
        map.set(key, fresh);
      }
      continue;
    }
    // A new field goes after the nearest field that comes before it in the usual order.
    const before = new Set(keys.slice(0, keys.indexOf(key)));
    let at = 0;
    map.items.forEach((pair, i) => {
      if (before.has(String((pair.key as { value?: unknown })?.value ?? pair.key))) at = i + 1;
    });
    map.items.splice(at, 0, doc.createPair(key, orderedList(v, list, defaults)));
  }
}

/**
 * Merge a list of mappings entry by entry, so every entry that stays keeps its
 * node: comments, unknown fields and key order. `base` is the list as loaded,
 * which lines up with the file's entries (a file the loader left an entry out
 * of is never written).
 */
function mergeList(doc: Document, seq: YAMLSeq, items: Plain[], base: Plain[], spec: ListSpec, defaults: Plain) {
  const nodes = seq.items;
  const merge = (item: Plain, node: unknown, was: Plain | undefined) => {
    if (!isMap(node)) return doc.createNode(ordered(item, spec.keys, defaults, spec.lists));
    mergeMap(doc, node, item, was, spec.keys, spec.lists ?? {}, defaults);
    return node;
  };
  let next: unknown[];
  if (spec.byId) {
    // Ids compare as text (`id: 7` is 7 in the file); the first of a repeated id wins, as in the loader.
    const nodeById = new Map<string, unknown>();
    for (const node of nodes) {
      if (isMap(node) && !nodeById.has(String(node.get("id")))) nodeById.set(String(node.get("id")), node);
    }
    const baseById = new Map(base.map((b) => [String(b.id), b]));
    next = items.map((item) => merge(item, nodeById.get(String(item.id)), baseById.get(String(item.id))));
  } else {
    // No ids: an entry that's unchanged keeps its node as it is, and an edited
    // one takes over the node of one that's gone.
    const used = new Set<number>();
    const unchanged = items.map((item) => {
      const j = base.findIndex((b, i) => !used.has(i) && same(b, item));
      if (j >= 0) used.add(j);
      return j;
    });
    const spare = base.map((_, i) => i).filter((i) => !used.has(i));
    next = items.map((item, k) => {
      const j = unchanged[k] >= 0 ? unchanged[k] : spare.shift();
      return j === undefined ? merge(item, undefined, undefined) : merge(item, nodes[j], base[j]);
    });
  }
  // New entries are written one per line, even into a `[]` or `[a, b]` list.
  if (next.some((node) => !nodes.includes(node as never))) seq.flow = false;
  seq.items = next;
}

/** `value` with owned keys first in canonical order, empty and default-valued fields dropped. */
function ordered(value: Plain, keys: string[], defaults: Plain = DEFAULTS, lists: Lists = {}): Plain {
  const out: Plain = {};
  for (const k of keys) {
    const v = value[k];
    if (isEmpty(v) || (k in defaults && sameValue(v, defaults[k]))) continue;
    out[k] = orderedList(v, lists[k], defaults);
  }
  return out;
}

function orderedList(v: unknown, list: ListSpec | undefined, defaults: Plain): unknown {
  return list && Array.isArray(v) ? v.map((item) => ordered(item as Plain, list.keys, defaults, list.lists)) : v;
}

function writeFile(
  path: string,
  original: string | undefined,
  value: Plain,
  base: Plain | undefined,
  keys: string[],
  lists: Lists,
  defaults: Plain = DEFAULTS,
): string {
  if (original === undefined) return new Document(ordered(value, keys, defaults, lists)).toString(style());
  const doc = parseDocument(original) as Document;
  // The loader marks such files lossy, so a save never gets here; never write over one regardless.
  const error = doc.errors[0];
  if (error) throw new UnsafeWrite([{ path, problems: [`YAML syntax error: ${error.message.split("\n")[0].replace(/:$/, "")}`] }]);
  if (doc.contents === null) doc.contents = doc.createNode({}); // empty, or only comments
  if (!isMap(doc.contents)) throw new UnsafeWrite([{ path, problems: ["expected a YAML mapping (key: value lines) at the top level"] }]);
  const flush = indentless(doc, original);
  mergeMap(doc, doc.contents, value, base, keys, lists, defaults);
  let text = doc.toString(style(flush));
  if (original.includes("\r\n")) text = text.replace(/\r?\n/g, "\r\n");
  return original.startsWith("\uFEFF") ? `\uFEFF${text}` : text;
}

/**
 * The file changes that turn `base`, loaded from `baseFiles`, into `draft`.
 * Each department and box is written to the file it was loaded from. Throws
 * UnsafeWrite when that would mean writing a file the loader couldn't fully
 * read, or when the roadmap isn't in this BoxOps's data format.
 */
export function serializeChanges(
  baseFiles: RoadmapFiles,
  base: DraftState,
  draft: DraftState,
  loaded: Pick<LoadResult, "issues" | "lossy" | "sources" | "formatStatus"> = loadRoadmap(baseFiles),
): FileChanges {
  const changes = diffDraft(base, draft);
  const writes = new Map<string, () => string | null>();
  const boxPath = (id: string) => loaded.sources.boxes.get(id) ?? `boxes/${id}.yaml`;
  const deptPath = (id: string) => loaded.sources.departments.get(id) ?? `departments/${id}.yaml`;

  const baseBoxes = new Map(base.boxes.map((b) => [b.id, b]));
  for (const b of [...changes.added, ...changes.modified]) {
    const path = boxPath(b.id);
    const was = baseBoxes.get(b.id);
    writes.set(path, () => writeFile(path, baseFiles[path], boxToPlain(b), was && boxToPlain(was), BOX_KEYS, BOX_LISTS));
  }
  for (const b of changes.removed) writes.set(boxPath(b.id), () => null);

  const baseDepts = new Map(base.departments.map((d) => [d.id, d]));
  for (const d of changes.departments) {
    const path = deptPath(d.id);
    const was = baseDepts.get(d.id);
    writes.set(path, () => writeFile(path, baseFiles[path], deptToPlain(d), was && deptToPlain(was), DEPT_KEYS, DEPT_LISTS));
  }
  for (const d of changes.removedDepartments) writes.set(deptPath(d.id), () => null);

  if (changes.people.added.length + changes.people.changed.length + changes.people.removed.length) {
    const path = "people.yaml";
    const people = (list: Person[]) => ({ people: list.map(personToPlain) });
    writes.set(path, () => writeFile(path, baseFiles[path], people(draft.people), people(base.people), ["people"], PEOPLE_LISTS));
  }

  // Team settings: no implied defaults (a type's colour is always written out).
  // A settings.yaml written from scratch starts with this BoxOps's format.
  if (changes.settings) {
    const path = "settings.yaml";
    writes.set(path, () => writeFile(path, baseFiles[path], settingsToPlain(draft.settings), settingsToPlain(base.settings), SETTINGS_KEYS, SETTINGS_LISTS, {}));
  }

  if (writes.size && loaded.formatStatus !== "current") {
    const problems = loaded.issues.filter((i) => i.path === "settings.yaml" && (/^(format|missing):/.test(i.message) || i.lossy));
    throw new UnsafeWrite([{ path: "settings.yaml", problems: problems.map((i) => i.message) }]);
  }
  const unsafe = [...writes.keys()].filter((path) => loaded.lossy.has(path)).sort();
  if (unsafe.length) throw new UnsafeWrite(unsafe.map((path) => ({ path, problems: loaded.lossy.get(path)! })));

  const out: FileChanges = {};
  for (const [path, write] of writes) {
    const text = write();
    // Drop no-op rewrites (e.g. a field changed and changed back).
    if (text === null || text !== baseFiles[path]) out[path] = text;
  }
  return out;
}

/** The full file set after applying changes; used to validate before committing. */
export function applyChanges(files: RoadmapFiles, changes: FileChanges): RoadmapFiles {
  const out = { ...files };
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) delete out[path];
    else out[path] = text;
  }
  return out;
}
