// Turns raw YAML files into a Roadmap plus a list of problems.
// Loading is lenient: a bad file or field is reported and skipped so one typo
// never blanks the whole roadmap. CI treats any issue as a failure. A problem
// that leaves part of a file out of the roadmap marks the file "lossy": the app
// won't write it, since that would delete what was left out.

import { type Document, isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { type Day, dayParts, formatDay, isWeekend, parseDay } from "./dates";
import { FORMAT, type FormatStatus, formatStatus } from "./format";
import { BOX_PATH, DEPARTMENT_PATH, isRoadmapPath } from "./paths";
import type {
  Box,
  BoxStatus,
  BoxType,
  Department,
  Issue,
  Lane,
  Person,
  Relation,
  RelationType,
  Roadmap,
  RoadmapFiles,
  Settings,
  TimeOff,
} from "./types";
import { BOX_FTE_OPTIONS, LANE_FTE_OPTIONS, ZOOM_LEVELS } from "./types";

const ID = /^[a-z0-9][a-z0-9_-]*$/;
/** Department codes: 2–4 capital letters/digits, starting with a letter. */
export const DEPT_CODE = /^[A-Z][A-Z0-9]{1,3}$/;
/** Box codes: exactly 3 capital letters/digits. */
export const BOX_CODE = /^[A-Z0-9]{3}$/;
/** Colours are `#rrggbb`, as the app's colour pickers write them; nothing else reaches CSS. */
export const COLOR = /^#[0-9a-fA-F]{6}$/;
/** Epic links and other links: http(s) only. */
export const LINK = /^https?:\/\/\S+$/;
/** File names Windows reserves even with an extension: a repo with one can't be checked out there. */
export const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const RELATION_TYPES: RelationType[] = ["before", "after", "during", "starts_with", "ends_with", "overlaps", "apart"];

export const DEFAULT_DEPT_COLOR = "#8a94a6";

const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_SETTINGS: Settings = {
  title: "Roadmap",
  fiscal_year_start_month: 1,
  default_zoom: "months",
  types: [{ id: "project", name: "Project", color: "#4f7cff" }],
  statuses: [
    { id: "at_risk", name: "At risk" },
    { id: "late", name: "Late" },
    { id: "blocked", name: "Blocked" },
  ],
};

/** The file each department and box was read from (by id), so a save writes exactly that file. */
export interface Sources {
  departments: Map<string, string>;
  boxes: Map<string, string>;
}

export interface LoadResult {
  roadmap: Roadmap;
  issues: Issue[];
  /** Files the loader couldn't fully read, with the reasons: the app must not write them. */
  lossy: Map<string, string[]>;
  sources: Sources;
  /** How `roadmap.format` compares with the format this BoxOps reads; anything but "current" is read-only. */
  formatStatus: FormatStatus;
}

type Obj = Record<string, unknown>;

/** A mapping in a file, and how messages name it: `person "sam-lee", ` (empty at the top level). */
interface At {
  obj: Obj;
  label: string;
}

/** Not set: left out, empty (`key:`) or an empty string. */
const unset = (v: unknown) => v === undefined || v === null || v === "";

/** What YAML made of a value that should have been text. */
function kindOf(v: unknown): string {
  if (typeof v === "number") return "a number";
  if (typeof v === "boolean") return "true or false";
  if (v instanceof Date) return "a date";
  return Array.isArray(v) ? "a list" : "a mapping";
}

class Reader {
  /** The YAML node each parsed mapping and list came from, for line numbers and the source text of values. */
  private nodes = new WeakMap<object, YAMLMap | YAMLSeq>();
  private lines = new LineCounter();
  /** The file's top-level mapping, once parsed. */
  top: At | null = null;

  constructor(
    private path: string,
    private issues: Issue[],
  ) {}

  /**
   * Report a problem. The file is still fully represented in the roadmap.
   * `same` stands in for the message in the issue's key when the message names
   * other files, which an unrelated edit can change (see Issue.key).
   */
  fail(message: string, obj?: object, key?: string | number, same = message): void {
    this.report(message, this.lineOf(obj, key), false, same);
  }

  /** Report a problem that leaves part of the file out of the roadmap, which makes the file unwritable. */
  drop(message: string, obj?: object, key?: string | number): void {
    this.report(message, this.lineOf(obj, key), true);
  }

  private report(message: string, line: number | undefined, lossy: boolean, same = message): void {
    this.issues.push({
      path: this.path,
      message,
      ...(line !== undefined && { line }),
      key: `${this.path}|${same}`,
      ...(lossy && { lossy: true as const }),
    });
  }

  private node(obj: object | undefined, key?: string | number): unknown {
    const parent = obj && this.nodes.get(obj);
    if (!parent || key === undefined) return parent;
    return isMap(parent) ? parent.get(key, true) : parent.items[key as number];
  }

  private lineOf(obj?: object, key?: string | number): number | undefined {
    const node = (this.node(obj, key) ?? this.node(obj)) as { range?: [number, number, number] | null } | undefined;
    return node?.range ? this.lines.linePos(node.range[0]).line : undefined;
  }

  /** How a value is written in the file (`2E5`, not 200000). */
  private source(obj: object, key: string | number): string {
    const node = this.node(obj, key);
    return isScalar(node) && node.source ? node.source : String((obj as Obj)[key]);
  }

  /** Parse the file to a mapping, or report why it isn't one. An empty file is an empty mapping. */
  doc(text: string): At | null {
    const doc = parseDocument(text, { lineCounter: this.lines });
    const error = doc.errors[0];
    if (error) {
      // "<what> at line 3, column 5:", then a code excerpt: keep the first line, without the colon.
      this.report(`YAML syntax error: ${error.message.split("\n")[0].replace(/:$/, "")}`, error.linePos?.[0].line, true);
      return null;
    }
    let value: unknown;
    try {
      value = doc.toJS() ?? {};
    } catch (e) {
      this.drop(`YAML can't be read: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }
    if (!isObj(value)) {
      this.drop("expected a YAML mapping (key: value lines) at the top level");
      return null;
    }
    indexNodes(doc.contents, value, doc, this.nodes);
    this.top = { obj: value, label: "" };
    return this.top;
  }

  private text(at: At, key: string, required: boolean): string | null | undefined {
    const v = at.obj[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (unset(v) || typeof v === "string") {
      if (required) this.drop(`${at.label}${key}: required text is missing`, at.obj, key);
      return required ? null : undefined;
    }
    if (typeof v === "object" && !(v instanceof Date)) {
      this.drop(`${at.label}${key}: expected text, not ${kindOf(v)}`, at.obj, key);
    } else {
      // e.g. `code: 2E5` or `title: 1.10`, which YAML reads as numbers: never convert them silently.
      const src = this.source(at.obj, key);
      this.drop(`${at.label}${key}: YAML reads ${src} as ${kindOf(v)}, not text; put it in quotes: ${key}: "${src}"`, at.obj, key);
    }
    return required ? null : undefined;
  }

  str(at: At, key: string): string | null {
    return this.text(at, key, true) ?? null;
  }

  optStr(at: At, key: string): string | undefined {
    return this.text(at, key, false) ?? undefined;
  }

  id(at: At, key: string): string | null {
    const v = this.str(at, key);
    if (v === null) return null;
    if (!ID.test(v)) {
      this.drop(`${at.label}${key}: "${v}" must be lowercase letters, digits, dashes or underscores`, at.obj, key);
      return null;
    }
    return v;
  }

  /** A required (null if missing or bad) or optional (undefined if not set, null if bad) YYYY-MM-DD date. */
  date(at: At, key: string, required: boolean): Day | null | undefined {
    const text = this.text(at, key, required);
    if (text === null || text === undefined) return text;
    const day = parseDay(text);
    if (day === null) this.drop(`${at.label}${key}: "${text}" is not a valid YYYY-MM-DD date`, at.obj, key);
    return day;
  }

  /** The roadmap has no weekends: the app never writes them, so flag hand edits that do. */
  weekday(at: At, key: string, day: Day): void {
    if (isWeekend(day)) this.fail(`${at.label}${key}: ${WEEKDAY[dayParts(day).weekday]} — roadmap dates must be weekdays`, at.obj, key);
  }

  /** One of a fixed set of values; anything else is reported and replaced by `fallback`. */
  oneOf<T>(at: At, key: string, options: readonly T[], fallback: T, expected: string): T {
    const v = at.obj[key];
    if (unset(v)) return fallback;
    if (options.includes(v as T)) return v as T;
    this.drop(`${at.label}${key}: expected ${expected}`, at.obj, key);
    return fallback;
  }

  bool(at: At, key: string): boolean {
    const v = at.obj[key];
    if (unset(v)) return false;
    if (typeof v === "boolean") return v;
    // YAML 1.2: only true and false are booleans (yes, no, on and off are text).
    this.drop(`${at.label}${key}: expected true or false`, at.obj, key);
    return false;
  }

  /** An optional `#rrggbb` colour; anything else is reported and replaced by `fallback`. */
  color(at: At, key: string, fallback: string, value = this.optStr(at, key)): string {
    if (value === undefined) return fallback;
    if (COLOR.test(value)) return value;
    this.drop(`${at.label}${key}: "${value}" must be a hex colour like "#4f7cff"`, at.obj, key);
    return fallback;
  }

  strList(at: At, key: string): string[] | undefined {
    const v = at.obj[key];
    if (unset(v)) return undefined;
    if (!Array.isArray(v)) {
      this.drop(`${at.label}${key}: expected a list of text`, at.obj, key);
      return undefined;
    }
    const out: string[] = [];
    v.forEach((x, i) => {
      if (typeof x === "string" && x.trim() !== "") out.push(x);
      else if (unset(x) || typeof x === "string") return;
      else if (typeof x === "object" && !(x instanceof Date)) this.drop(`${at.label}${key}: expected text, not ${kindOf(x)}`, v, i);
      else this.drop(`${at.label}${key}: YAML reads ${this.source(v, i)} as ${kindOf(x)}, not text; put it in quotes: "${this.source(v, i)}"`, v, i);
    });
    return out;
  }

  /**
   * The mappings in a list, each named for messages by `name` (its id), or by
   * its position when it has none (such an entry is skipped anyway).
   */
  *entries(at: At, key: string, noun: string, name: (o: Obj) => unknown = (o) => o.id): Generator<At> {
    const list = at.obj[key];
    if (unset(list)) return;
    if (!Array.isArray(list)) return this.drop(`${at.label}${key}: expected a list`, at.obj, key);
    for (const [i, item] of list.entries()) {
      if (!isObj(item)) {
        this.drop(`${at.label}${noun} ${i + 1}: expected a mapping`, list, i);
        continue;
      }
      const id = name(item);
      const label = typeof id === "string" || typeof id === "number" ? `"${id}"` : String(i + 1);
      yield { obj: item, label: `${at.label}${noun} ${label}, ` };
    }
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Record which YAML node each mapping and list of the parsed value came from. */
function indexNodes(node: unknown, value: unknown, doc: Document, out: WeakMap<object, YAMLMap | YAMLSeq>): void {
  if (isAlias(node)) node = node.resolve(doc);
  if (isMap(node) && isObj(value)) {
    out.set(value, node);
    for (const pair of node.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
      if (key in value) indexNodes(pair.value, value[key], doc, out);
    }
  } else if (isSeq(node) && Array.isArray(value)) {
    out.set(value, node);
    node.items.forEach((item, i) => indexNodes(item, value[i], doc, out));
  }
}

function fileId(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

/** A department or box is loaded only from the file named after it, so a save can never write it into another file. */
function matchesFile(r: Reader, top: At, id: string, path: string): boolean {
  if (id !== fileId(path)) {
    r.drop(`id: "${id}" doesn't match the file name "${fileId(path)}", so this file is skipped`, top.obj, "id");
    return false;
  }
  if (WINDOWS_RESERVED.test(id)) r.fail(`id: "${id}" can't be a file name on Windows, so the repo can't be checked out there`, top.obj, "id");
  return true;
}

/**
 * `ignored`: other files a reader found in the roadmap folder but didn't read
 * (it reads only isRoadmapPath() files); like any other file in `files`, each
 * is reported as unexpected.
 */
export function loadRoadmap(files: RoadmapFiles, ignored: string[] = []): LoadResult {
  const issues: Issue[] = [];
  const paths = Object.keys(files).sort();
  const readers = new Map<string, Reader>();
  const reader = (path: string) => {
    if (!readers.has(path)) readers.set(path, new Reader(path, issues));
    return readers.get(path)!;
  };
  const sources: Sources = { departments: new Map(), boxes: new Map() };

  const { settings, format } = loadSettings(files["settings.yaml"], reader("settings.yaml"));

  const departments: Department[] = [];
  const laneOwner = new Map<string, string>();
  for (const path of paths.filter((p) => DEPARTMENT_PATH.test(p))) {
    const r = reader(path);
    const dept = loadDepartment(r, path, files[path]);
    if (!dept) continue;
    const other = sources.departments.get(dept.id);
    if (other) {
      // departments/x.yaml and departments/x.yml
      r.drop(`id: "${dept.id}" is already used by ${other}, so this file is skipped`, r.top?.obj, "id");
      continue;
    }
    sources.departments.set(dept.id, path);
    dept.lanes = dept.lanes.filter((lane) => {
      const owner = laneOwner.get(lane.id);
      if (!owner) {
        laneOwner.set(lane.id, dept.id);
        return true;
      }
      r.drop(`lane "${lane.id}" is already used in department "${owner}", so it's left out here`, r.top?.obj, "lanes");
      const ownerReader = reader(sources.departments.get(owner)!);
      ownerReader.fail(`lane "${lane.id}" is also used in department "${dept.id}"`, ownerReader.top?.obj, "lanes");
      return false;
    });
    departments.push(dept);
  }
  // Report a shared code on every department that has it, not just the one that sorts later (keyed on the code, as for boxes).
  for (const dept of departments) {
    const others = departments.filter((d) => d !== dept && d.code !== "" && d.code === dept.code);
    const r = reader(sources.departments.get(dept.id)!);
    if (others.length) r.fail(`code: "${dept.code}" is also used by department "${others[0].id}"`, r.top?.obj, "code", `code: "${dept.code}" shared`);
  }
  departments.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const people = loadPeople(files["people.yaml"], reader("people.yaml"), new Set(departments.map((d) => d.id)));
  const personIds = new Set(people.map((p) => p.id));

  const typeIds = new Set(settings.types.map((t) => t.id));
  const statusIds = new Set(settings.statuses.map((s) => s.id));
  const boxes: Box[] = [];
  for (const path of paths.filter((p) => BOX_PATH.test(p))) {
    const r = reader(path);
    const box = loadBox(r, path, files[path]);
    if (!box) continue;
    const top = r.top!.obj;
    const other = sources.boxes.get(box.id);
    if (other) {
      r.drop(`id: "${box.id}" is already used by ${other}, so this file is skipped`, top, "id");
      continue;
    }
    if (!laneOwner.has(box.lane)) {
      r.drop(`lane: "${box.lane}" does not exist in any department, so the box is skipped`, top, "lane");
      continue;
    }
    if (!typeIds.has(box.type)) r.fail(`type: "${box.type}" is not defined in settings.yaml`, top, "type");
    if (box.status !== undefined && !statusIds.has(box.status)) r.fail(`status: "${box.status}" is not defined in settings.yaml`, top, "status");
    for (const id of box.engineers ?? []) {
      if (!personIds.has(id)) r.fail(`engineers: "${id}" is not in people.yaml`, top, "engineers");
    }
    sources.boxes.set(box.id, path);
    boxes.push(box);
  }

  // Box codes are unique across the roadmap (a shared one is reported on every
  // box that has it, keyed on the code, so deleting one of three boxes that
  // share it doesn't make the other two's problems new); rules must point at a
  // real, other box.
  const byCode = new Map<string, Box[]>();
  for (const box of boxes) byCode.set(box.code, [...(byCode.get(box.code) ?? []), box]);
  for (const box of boxes) {
    const r = reader(sources.boxes.get(box.id)!);
    const others = byCode.get(box.code)!.filter((b) => b !== box);
    if (others.length) r.fail(`code: "${box.code}" is also used by ${others.map((b) => b.id).join(", ")}`, r.top?.obj, "code", `code: "${box.code}" shared`);
    for (const rel of box.relations ?? []) {
      if (!byCode.has(rel.box)) r.fail(`relations: no box has code "${rel.box}"`, r.top?.obj, "relations");
      else if (rel.box === box.code) r.fail("relations: a box can't have a rule about itself", r.top?.obj, "relations");
    }
  }

  for (const path of [...new Set([...paths, ...ignored])].sort()) {
    if (isRoadmapPath(path)) continue;
    const misnamed = /^(settings|people)\.yml$/.exec(path);
    reader(path).fail(misnamed ? `rename this file to ${misnamed[1]}.yaml` : "unexpected file; roadmap files live in departments/ or boxes/");
  }

  const lossy = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.lossy) lossy.set(issue.path, [...(lossy.get(issue.path) ?? []), issue.message]);
  }
  return { roadmap: { format, settings, departments, boxes, people }, issues, lossy, sources, formatStatus: formatStatus(format) };
}

function loadPeople(text: string | undefined, r: Reader, departmentIds: Set<string>): Person[] {
  if (text === undefined) return [];
  const top = r.doc(text);
  if (!top) return [];
  const people: Person[] = [];
  // `people:` with nothing after it (or `people: []`) is an empty roster.
  for (const at of r.entries(top, "people", "person")) {
    const id = r.id(at, "id");
    const name = r.str(at, "name");
    if (!id || !name) continue;
    if (people.some((p) => p.id === id)) {
      r.drop(`${at.label}id: "${id}" appears twice, so the second entry is skipped`, at.obj, "id");
      continue;
    }
    const department = r.optStr(at, "department");
    if (department !== undefined && !departmentIds.has(department)) {
      r.fail(`${at.label}department: "${department}" does not exist`, at.obj, "department");
    }
    const email = r.optStr(at, "email");
    if (email !== undefined && !EMAIL.test(email)) r.fail(`${at.label}email: "${email}" doesn't look like an email address`, at.obj, "email");
    people.push({
      id,
      name,
      department,
      role: r.optStr(at, "role"),
      email,
      manager: r.optStr(at, "manager"),
      notes: r.optStr(at, "notes"),
      pto: readPto(r, at),
    });
  }
  return people;
}

/** A person's `pto: [{start, end, note}]`; bad entries are reported and skipped. */
function readPto(r: Reader, person: At): TimeOff[] | undefined {
  if (person.obj.pto === undefined || person.obj.pto === null) return undefined;
  const out: TimeOff[] = [];
  for (const at of r.entries(person, "pto", "PTO", (o) => o.start)) {
    const start = r.date(at, "start", true);
    const end = r.date(at, "end", true);
    if (start === null || start === undefined || end === null || end === undefined) continue;
    if (end < start) {
      r.drop(`${at.label}end (${formatDay(end)}) is before start (${formatDay(start)})`, at.obj, "end");
      continue;
    }
    r.weekday(at, "start", start);
    r.weekday(at, "end", end);
    out.push({ start, end, note: r.optStr(at, "note") });
  }
  return out;
}

function loadSettings(text: string | undefined, r: Reader): { settings: Settings; format: number | null } {
  if (text === undefined) {
    r.fail(`missing: every roadmap needs a settings.yaml with at least "format: ${FORMAT}"`);
    return { settings: DEFAULT_SETTINGS, format: 0 };
  }
  const top = r.doc(text);
  if (!top) return { settings: DEFAULT_SETTINGS, format: null };

  const format = readFormat(r, top);

  let fiscalStart = DEFAULT_SETTINGS.fiscal_year_start_month;
  const fy = top.obj.fiscal_year_start_month;
  if (typeof fy === "number" && Number.isInteger(fy) && fy >= 1 && fy <= 12) fiscalStart = fy;
  else if (!unset(fy)) r.drop("fiscal_year_start_month: expected a month number from 1 to 12", top.obj, "fiscal_year_start_month");

  const zoom = r.oneOf(top, "default_zoom", ZOOM_LEVELS, DEFAULT_SETTINGS.default_zoom, `one of ${ZOOM_LEVELS.join(", ")}`);

  const types: BoxType[] = [];
  for (const at of r.entries(top, "types", "type")) {
    const id = r.id(at, "id");
    const name = r.str(at, "name");
    const color = r.str(at, "color");
    if (!id || !name || !color) continue;
    if (types.some((t) => t.id === id)) {
      r.drop(`${at.label}id: "${id}" appears twice, so the second one is skipped`, at.obj, "id");
      continue;
    }
    types.push({ id, name, color: r.color(at, "color", DEFAULT_DEPT_COLOR, color) });
  }
  const statuses: BoxStatus[] = [];
  for (const at of r.entries(top, "statuses", "flag")) {
    const id = r.id(at, "id");
    const name = r.str(at, "name");
    if (!id || !name) continue;
    if (statuses.some((s) => s.id === id)) {
      r.drop(`${at.label}id: "${id}" appears twice, so the second one is skipped`, at.obj, "id");
      continue;
    }
    statuses.push({ id, name });
  }

  return {
    format,
    settings: {
      title: r.optStr(top, "title") ?? DEFAULT_SETTINGS.title,
      fiscal_year_start_month: fiscalStart,
      default_zoom: zoom,
      types: types.length ? types : DEFAULT_SETTINGS.types,
      statuses: statuses.length ? statuses : DEFAULT_SETTINGS.statuses,
    },
  };
}

/** `format:` in settings.yaml: 0 when missing, null when it isn't a whole number from 1 up. */
function readFormat(r: Reader, top: At): number | null {
  const v = top.obj.format;
  if (unset(v)) {
    r.fail(`format: missing; add "format: ${FORMAT}" at the top of this file`, top.obj);
    return 0;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) {
    r.fail(`format: expected a whole number, like "format: ${FORMAT}"`, top.obj, "format");
    return null;
  }
  if (v < 1) {
    r.fail(`format: ${v} isn't supported; this BoxOps reads format ${FORMAT}`, top.obj, "format");
    return null;
  }
  if (v > FORMAT) r.fail(`format: ${v} needs a newer BoxOps (this one reads format ${FORMAT})`, top.obj, "format");
  return v;
}

function loadDepartment(r: Reader, path: string, text: string): Department | null {
  const top = r.doc(text);
  if (!top) return null;
  const id = r.id(top, "id");
  const name = r.str(top, "name");
  if (!id || !name || !matchesFile(r, top, id, path)) return null;
  // A department without a code still loads (and is written back without one).
  const code = r.optStr(top, "code");
  if (code === undefined && unset(top.obj.code)) r.fail("code: required text is missing", top.obj, "code");
  else if (code !== undefined && !DEPT_CODE.test(code)) r.fail(`code: "${code}" must be 2–4 capital letters or digits, starting with a letter`, top.obj, "code");

  const lanes: Lane[] = [];
  for (const at of r.entries(top, "lanes", "lane")) {
    const laneId = r.id(at, "id");
    if (!laneId) continue;
    if (lanes.some((l) => l.id === laneId)) {
      r.drop(`${at.label}id: "${laneId}" appears twice in this department, so the second one is skipped`, at.obj, "id");
      continue;
    }
    const lane: Lane = { id: laneId, name: r.optStr(at, "name"), fte: r.oneOf(at, "fte", LANE_FTE_OPTIONS, 1, "0.5 or 1") };
    for (const field of ["start", "end"] as const) {
      const day = r.date(at, field, false);
      if (day === null || day === undefined) continue;
      r.weekday(at, field, day);
      lane[field] = day;
    }
    if (lane.start !== undefined && lane.end !== undefined && lane.end < lane.start) {
      r.drop(`${at.label}end is before start, so the end is left out`, at.obj, "end");
      delete lane.end;
    }
    lanes.push(lane);
  }

  const order = top.obj.order;
  const goodOrder = typeof order === "number" && Number.isFinite(order);
  if (!goodOrder && !unset(order)) r.drop("order: expected a number", top.obj, "order");

  return {
    id,
    code: code ?? "",
    name,
    color: r.color(top, "color", DEFAULT_DEPT_COLOR),
    order: goodOrder ? order : 0,
    collapsed: r.bool(top, "collapsed"),
    lanes,
  };
}

function loadBox(r: Reader, path: string, text: string): Box | null {
  const top = r.doc(text);
  if (!top) return null;
  const id = r.id(top, "id");
  const code = r.str(top, "code");
  const title = r.str(top, "title");
  const lane = r.str(top, "lane");
  const type = r.str(top, "type");
  const status = r.optStr(top, "status");
  const start = r.date(top, "start", true);
  const end = r.date(top, "end", true);
  if (!id || !code || !title || !lane || !type || start === null || start === undefined || end === null || end === undefined) {
    return null;
  }
  if (!BOX_CODE.test(code)) {
    r.drop(`code: "${code}" must be exactly 3 capital letters or digits`, top.obj, "code");
    return null;
  }
  if (!matchesFile(r, top, id, path)) return null;
  if (end < start) {
    r.drop(`end (${formatDay(end)}) is before start (${formatDay(start)})`, top.obj, "end");
    return null;
  }
  r.weekday(top, "start", start);
  r.weekday(top, "end", end);

  const fte = r.oneOf(top, "fte", BOX_FTE_OPTIONS, 1, `one of ${BOX_FTE_OPTIONS.join(", ")}`);

  let engineers = r.strList(top, "engineers");
  if (engineers) {
    // A name listed twice would halve their share of the box in the report.
    const twice = engineers.filter((e, i) => engineers!.indexOf(e) !== i);
    for (const e of new Set(twice)) r.fail(`engineers: "${e}" is listed twice`, top.obj, "engineers");
    engineers = [...new Set(engineers)];
  }

  const relations = readRelations(r, top);

  let epic = r.optStr(top, "epic");
  if (epic !== undefined && !LINK.test(epic)) {
    r.drop(`epic: "${epic}" isn't an http(s) link`, top.obj, "epic");
    epic = undefined;
  }
  const links = r.strList(top, "links")?.filter((link) => {
    if (LINK.test(link)) return true;
    r.drop(`links: "${link}" isn't an http(s) link`, top.obj, "links");
    return false;
  });

  return {
    id,
    title,
    lane,
    start,
    end,
    type,
    status,
    code,
    fte,
    engineers,
    relations,
    epic,
    description: r.optStr(top, "description"),
    tags: r.strList(top, "tags"),
    links,
  };
}

/** `relations: [{type, box}]`, where box is the other box's code ("A1F" or "DE-A1F"). */
function readRelations(r: Reader, top: At): Relation[] | undefined {
  if (top.obj.relations === undefined || top.obj.relations === null) return undefined;
  const out: Relation[] = [];
  for (const at of r.entries(top, "relations", "rule", (o) => (unset(o.type) || unset(o.box) ? undefined : `${o.type} ${o.box}`))) {
    const type = r.str(at, "type");
    const box = r.str(at, "box");
    if (!type || !box) continue;
    if (!RELATION_TYPES.includes(type as RelationType)) {
      r.drop(`${at.label}type: "${type}" must be one of ${RELATION_TYPES.join(", ")}`, at.obj, "type");
      continue;
    }
    const ref = box.trim().toUpperCase().replace(/^[A-Z0-9]+-(?=[A-Z0-9]{3}$)/, "");
    if (!BOX_CODE.test(ref)) {
      r.drop(`${at.label}box: "${box}" isn't a box code`, at.obj, "box");
      continue;
    }
    // Kept (not merged) so the rules stay in step with the file's own list.
    if (out.some((x) => x.type === type && x.box === ref)) r.fail(`${at.label.slice(0, -2)}: the same rule is listed twice`, at.obj);
    out.push({ type: type as RelationType, box: ref });
  }
  return out;
}
