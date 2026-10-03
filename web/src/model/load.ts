// Turns raw YAML files into a Roadmap plus a list of problems.
// Loading is lenient: a bad file or field is reported and skipped so one typo
// never blanks the whole roadmap. CI treats any issue as a failure.

import { parse } from "yaml";
import { parseDay } from "./dates";
import type {
  Box,
  BoxStatus,
  BoxType,
  Department,
  Issue,
  Lane,
  Person,
  Roadmap,
  RoadmapFiles,
  Settings,
  ZoomLevel,
} from "./types";
import { BOX_FTE_OPTIONS, ZOOM_LEVELS } from "./types";

const ID = /^[a-z0-9][a-z0-9_-]*$/;

export const DEFAULT_DEPT_COLOR = "#8a94a6";

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_SETTINGS: Settings = {
  title: "Roadmap",
  fiscal_year_start_month: 1,
  default_zoom: "months",
  types: [{ id: "project", name: "Project", color: "#4f7cff" }],
  statuses: [{ id: "planned", name: "Planned" }],
};

type Obj = Record<string, unknown>;

class Reader {
  constructor(
    private path: string,
    private issues: Issue[],
  ) {}

  fail(message: string): void {
    this.issues.push({ path: this.path, message });
  }

  /** Parse the file to a mapping, or report why it isn't one. */
  doc(text: string): Obj | null {
    let value: unknown;
    try {
      value = parse(text);
    } catch (e) {
      this.fail(`YAML syntax error: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }
    if (!isObj(value)) {
      this.fail("expected a YAML mapping at the top level");
      return null;
    }
    return value;
  }

  str(obj: Obj, key: string, where = ""): string | null {
    const v = obj[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
    this.fail(`${where}${key}: required text is missing`);
    return null;
  }

  optStr(obj: Obj, key: string, where = ""): string | undefined {
    const v = obj[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string" || typeof v === "number") return String(v);
    this.fail(`${where}${key}: expected text`);
    return undefined;
  }

  id(obj: Obj, key: string, where = ""): string | null {
    const v = this.str(obj, key, where);
    if (v === null) return null;
    if (!ID.test(v)) {
      this.fail(`${where}${key}: "${v}" must be lowercase letters, digits, dashes or underscores`);
      return null;
    }
    return v;
  }

  strList(obj: Obj, key: string): string[] | undefined {
    const v = obj[key];
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    this.fail(`${key}: expected a list of text`);
    return undefined;
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fileId(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

export function loadRoadmap(files: RoadmapFiles): { roadmap: Roadmap; issues: Issue[] } {
  const issues: Issue[] = [];
  const paths = Object.keys(files).sort();

  const settings = loadSettings(files["settings.yaml"], issues);

  const departments: Department[] = [];
  const laneOwner = new Map<string, string>();
  for (const path of paths.filter((p) => /^departments\/[^/]+\.ya?ml$/.test(p))) {
    const dept = loadDepartment(path, files[path], issues);
    if (!dept) continue;
    if (departments.some((d) => d.id === dept.id)) {
      issues.push({ path, message: `duplicate department id "${dept.id}"` });
      continue;
    }
    dept.lanes = dept.lanes.filter((lane) => {
      const owner = laneOwner.get(lane.id);
      if (owner) {
        issues.push({ path, message: `lane id "${lane.id}" is already used in department "${owner}"` });
        return false;
      }
      laneOwner.set(lane.id, dept.id);
      return true;
    });
    departments.push(dept);
  }
  departments.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const people = loadPeople(files["people.yaml"], new Set(departments.map((d) => d.id)), issues);
  const personIds = new Set(people.map((p) => p.id));

  const typeIds = new Set(settings.types.map((t) => t.id));
  const statusIds = new Set(settings.statuses.map((s) => s.id));
  const boxes: Box[] = [];
  const boxIds = new Set<string>();
  for (const path of paths.filter((p) => /^boxes\/[^/]+\.ya?ml$/.test(p))) {
    const box = loadBox(path, files[path], issues);
    if (!box) continue;
    const r = new Reader(path, issues);
    if (boxIds.has(box.id)) {
      r.fail(`duplicate box id "${box.id}"`);
      continue;
    }
    if (!laneOwner.has(box.lane)) {
      r.fail(`lane: "${box.lane}" does not exist in any department`);
      continue;
    }
    if (!typeIds.has(box.type)) r.fail(`type: "${box.type}" is not defined in settings.yaml`);
    if (!statusIds.has(box.status)) r.fail(`status: "${box.status}" is not defined in settings.yaml`);
    for (const id of box.engineers ?? []) {
      if (!personIds.has(id)) r.fail(`engineers: "${id}" is not in people.yaml`);
    }
    boxIds.add(box.id);
    boxes.push(box);
  }

  for (const path of paths) {
    if (!["settings.yaml", "people.yaml"].includes(path) && !/^(departments|boxes)\/[^/]+\.ya?ml$/.test(path)) {
      issues.push({ path, message: "unexpected file; roadmap files live in departments/ or boxes/" });
    }
  }

  return { roadmap: { settings, departments, boxes, people }, issues };
}

function loadPeople(text: string | undefined, departmentIds: Set<string>, issues: Issue[]): Person[] {
  if (text === undefined) return [];
  const r = new Reader("people.yaml", issues);
  const doc = r.doc(text);
  if (!doc) return [];
  const seen = new Set<string>();
  return readList(r, doc, "people", (o, where): Person | null => {
    const id = r.id(o, "id", where);
    const name = r.str(o, "name", where);
    if (!id || !name) return null;
    if (seen.has(id)) {
      r.fail(`${where}id: "${id}" appears twice`);
      return null;
    }
    seen.add(id);
    const department = r.optStr(o, "department", where);
    if (department !== undefined && !departmentIds.has(department)) {
      r.fail(`${where}department: "${department}" does not exist`);
    }
    const email = r.optStr(o, "email", where);
    if (email !== undefined && !EMAIL.test(email)) r.fail(`${where}email: "${email}" doesn't look like an email address`);
    return { id, name, department, role: r.optStr(o, "role", where), email };
  });
}

function loadSettings(text: string | undefined, issues: Issue[]): Settings {
  const path = "settings.yaml";
  if (text === undefined) {
    issues.push({ path, message: "missing; using defaults" });
    return DEFAULT_SETTINGS;
  }
  const r = new Reader(path, issues);
  const doc = r.doc(text);
  if (!doc) return DEFAULT_SETTINGS;

  const fy = doc.fiscal_year_start_month ?? 1;
  let fiscalStart = 1;
  if (typeof fy === "number" && Number.isInteger(fy) && fy >= 1 && fy <= 12) fiscalStart = fy;
  else r.fail("fiscal_year_start_month: expected a month number 1-12");

  let zoom: ZoomLevel = DEFAULT_SETTINGS.default_zoom;
  if (doc.default_zoom !== undefined) {
    if (ZOOM_LEVELS.includes(doc.default_zoom as ZoomLevel)) zoom = doc.default_zoom as ZoomLevel;
    else r.fail(`default_zoom: expected one of ${ZOOM_LEVELS.join(", ")}`);
  }

  const types = readList(r, doc, "types", (o, where): BoxType | null => {
    const id = r.id(o, "id", where);
    const name = r.str(o, "name", where);
    const color = r.str(o, "color", where);
    return id && name && color ? { id, name, color } : null;
  });
  const statuses = readList(r, doc, "statuses", (o, where): BoxStatus | null => {
    const id = r.id(o, "id", where);
    const name = r.str(o, "name", where);
    return id && name ? { id, name } : null;
  });

  return {
    title: r.optStr(doc, "title") ?? DEFAULT_SETTINGS.title,
    fiscal_year_start_month: fiscalStart,
    default_zoom: zoom,
    types: types.length ? types : DEFAULT_SETTINGS.types,
    statuses: statuses.length ? statuses : DEFAULT_SETTINGS.statuses,
  };
}

function readList<T>(r: Reader, doc: Obj, key: string, read: (o: Obj, where: string) => T | null): T[] {
  const list = doc[key];
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    r.fail(`${key}: expected a list`);
    return [];
  }
  const out: T[] = [];
  list.forEach((item, i) => {
    const where = `${key}[${i}].`;
    if (!isObj(item)) return r.fail(`${where.slice(0, -1)}: expected a mapping`);
    const v = read(item, where);
    if (v) out.push(v);
  });
  return out;
}

function loadDepartment(path: string, text: string, issues: Issue[]): Department | null {
  const r = new Reader(path, issues);
  const doc = r.doc(text);
  if (!doc) return null;
  const id = r.id(doc, "id");
  const name = r.str(doc, "name");
  if (!id || !name) return null;
  if (id !== fileId(path)) r.fail(`id "${id}" should match the file name "${fileId(path)}"`);

  const lanes = readList(r, doc, "lanes", (o, where): Lane | null => {
    const laneId = r.id(o, "id", where);
    if (!laneId) return null;
    const fte = o.fte ?? 1;
    if (typeof fte !== "number" || fte <= 0 || fte > 1) {
      r.fail(`${where}fte: expected a number greater than 0 and at most 1`);
      return null;
    }
    return { id: laneId, name: r.optStr(o, "name", where), fte };
  });
  const seen = new Set<string>();
  const uniqueLanes = lanes.filter((l) => {
    if (seen.has(l.id)) {
      r.fail(`lane id "${l.id}" appears twice`);
      return false;
    }
    seen.add(l.id);
    return true;
  });

  const order = doc.order ?? 0;
  if (typeof order !== "number") r.fail("order: expected a number");

  return {
    id,
    name,
    color: r.optStr(doc, "color") ?? DEFAULT_DEPT_COLOR,
    order: typeof order === "number" ? order : 0,
    collapsed: doc.collapsed === true,
    lanes: uniqueLanes,
  };
}

function loadBox(path: string, text: string, issues: Issue[]): Box | null {
  const r = new Reader(path, issues);
  const doc = r.doc(text);
  if (!doc) return null;
  const id = r.id(doc, "id");
  const title = r.str(doc, "title");
  const lane = r.str(doc, "lane");
  const type = r.str(doc, "type");
  const status = r.str(doc, "status");
  const startText = r.str(doc, "start");
  const endText = r.str(doc, "end");
  if (!id || !title || !lane || !type || !status || !startText || !endText) return null;
  if (id !== fileId(path)) r.fail(`id "${id}" should match the file name "${fileId(path)}"`);

  const start = parseDay(startText);
  const end = parseDay(endText);
  if (start === null) r.fail(`start: "${startText}" is not a valid YYYY-MM-DD date`);
  if (end === null) r.fail(`end: "${endText}" is not a valid YYYY-MM-DD date`);
  if (start === null || end === null) return null;
  if (end < start) {
    r.fail(`end (${endText}) is before start (${startText})`);
    return null;
  }

  const fte = doc.fte ?? 1;
  if (!BOX_FTE_OPTIONS.includes(fte as (typeof BOX_FTE_OPTIONS)[number])) {
    r.fail(`fte: expected one of ${BOX_FTE_OPTIONS.join(", ")}`);
    return null;
  }

  const epic = r.optStr(doc, "epic");
  if (epic !== undefined && !/^https?:\/\//.test(epic)) r.fail(`epic: "${epic}" should be an http(s) link`);

  return {
    id,
    title,
    lane,
    start,
    end,
    type,
    status,
    fte: fte as number,
    engineers: r.strList(doc, "engineers"),
    epic,
    description: r.optStr(doc, "description"),
    tags: r.strList(doc, "tags"),
    links: r.strList(doc, "links"),
  };
}
