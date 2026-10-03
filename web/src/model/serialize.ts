// Turns the draft back into YAML file changes. Changed files are edited in
// place through the `yaml` Document API, so comments, key order and quoting in
// the original survive and a PR diff shows only the lines that really changed.

import { Document, isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { formatDay } from "./dates";
import { diffDraft, type DraftState } from "./draft";
import { DEFAULT_DEPT_COLOR } from "./load";
import type { Box, Department, RoadmapFiles } from "./types";

/** path → new file text, or null to delete the file. */
export type FileChanges = Record<string, string | null>;

type Plain = Record<string, unknown>;

/** Field order for newly written files; also the set of keys the app owns. */
const BOX_KEYS = [
  "id",
  "title",
  "lane",
  "start",
  "end",
  "type",
  "status",
  "fte",
  "engineers",
  "epic",
  "description",
  "tags",
  "links",
];
const DEPT_KEYS = ["id", "name", "color", "order", "collapsed", "lanes"];
const LANE_KEYS = ["id", "name", "fte"];
const PERSON_KEYS = ["id", "name", "department", "role", "email"];

/** A key that is absent from the file means this value. */
const DEFAULTS: Record<string, unknown> = { fte: 1, collapsed: false, order: 0, color: DEFAULT_DEPT_COLOR };

const TO_STRING = { lineWidth: 0 } as const;

function boxToPlain(b: Box): Plain {
  return { ...b, start: formatDay(b.start), end: formatDay(b.end) };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Bring `map` in line with `value` for the keys we own. Keys we don't know
 * about are left alone, so hand-added fields survive app edits.
 */
function mergeMap(doc: Document, map: YAMLMap, value: Plain, keys: string[], childKeys: Record<string, string[]>) {
  for (const key of keys) {
    const v = value[key];
    const node = map.get(key, true);
    if (isEmpty(v)) {
      if (map.has(key)) map.delete(key);
      continue;
    }
    if (!map.has(key) && sameValue(v, DEFAULTS[key])) continue;
    if (Array.isArray(v) && isSeq(node) && childKeys[key]) {
      mergeIdSeq(doc, node, v as Plain[], childKeys[key]);
      continue;
    }
    const current = node === undefined ? undefined : map.toJSON()[key];
    if (sameValue(current, v)) continue;
    if (map.has(key)) {
      map.set(key, doc.createNode(v));
      continue;
    }
    // A new field goes after the nearest field that comes before it in the usual order.
    const before = new Set(keys.slice(0, keys.indexOf(key)));
    let at = 0;
    map.items.forEach((pair, i) => {
      if (before.has(String((pair.key as { value?: unknown })?.value ?? pair.key))) at = i + 1;
    });
    map.items.splice(at, 0, doc.createPair(key, v));
  }
}

/** Merge a list of `{id, …}` mappings, keeping each surviving item's node (and comments). */
function mergeIdSeq(doc: Document, seq: YAMLSeq, items: Plain[], keys: string[]) {
  const byId = new Map<unknown, YAMLMap>();
  for (const node of seq.items) {
    if (isMap(node)) byId.set(node.get("id"), node);
  }
  seq.items = items.map((item) => {
    const existing = byId.get(item.id);
    if (!existing) return doc.createNode(ordered(item, keys));
    mergeMap(doc, existing, item, keys, {});
    return existing;
  });
}

/** `value` with owned keys first in canonical order, empty and default-valued fields dropped. */
function ordered(value: Plain, keys: string[]): Plain {
  const out: Plain = {};
  for (const k of keys) {
    const v = value[k];
    if (isEmpty(v) || (k in DEFAULTS && sameValue(v, DEFAULTS[k]))) continue;
    out[k] =
      Array.isArray(v) && k === "lanes"
        ? v.map((l) => ordered(l as Plain, LANE_KEYS))
        : Array.isArray(v) && k === "people"
          ? v.map((p) => ordered(p as Plain, PERSON_KEYS))
          : v;
  }
  return out;
}

function writeFile(original: string | undefined, value: Plain, keys: string[], childKeys: Record<string, string[]>) {
  if (original === undefined) return new Document(ordered(value, keys)).toString(TO_STRING);
  const doc = parseDocument(original);
  if (!isMap(doc.contents)) return new Document(ordered(value, keys)).toString(TO_STRING);
  mergeMap(doc, doc.contents, value, keys, childKeys);
  return doc.toString(TO_STRING);
}

/** Existing file for an id in a folder (`boxes/x.yaml` or `.yml`), else the path a new one gets. */
function pathFor(files: RoadmapFiles, folder: string, id: string): string {
  return [`${folder}/${id}.yaml`, `${folder}/${id}.yml`].find((p) => p in files) ?? `${folder}/${id}.yaml`;
}

export function serializeChanges(baseFiles: RoadmapFiles, base: DraftState, draft: DraftState): FileChanges {
  const changes = diffDraft(base, draft);
  const out: FileChanges = {};

  for (const b of [...changes.added, ...changes.modified]) {
    const path = pathFor(baseFiles, "boxes", b.id);
    out[path] = writeFile(baseFiles[path], boxToPlain(b), BOX_KEYS, {});
  }
  for (const b of changes.removed) out[pathFor(baseFiles, "boxes", b.id)] = null;

  for (const d of changes.departments) {
    const path = pathFor(baseFiles, "departments", d.id);
    out[path] = writeFile(baseFiles[path], deptToPlain(d), DEPT_KEYS, { lanes: LANE_KEYS });
  }

  if (changes.people.added.length + changes.people.changed.length + changes.people.removed.length) {
    const path = "people.yaml";
    out[path] = writeFile(baseFiles[path], { people: draft.people.map((p) => ({ ...p })) }, ["people"], { people: PERSON_KEYS });
  }

  // Drop no-op rewrites (e.g. a field changed and changed back).
  for (const [path, text] of Object.entries(out)) {
    if (text !== null && text === baseFiles[path]) delete out[path];
  }
  return out;
}

function deptToPlain(d: Department): Plain {
  return { ...d, lanes: d.lanes.map((l) => ({ ...l })) };
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
