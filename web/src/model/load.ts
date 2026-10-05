// Turns raw YAML files into a Roadmap plus a list of problems.
// Loading is lenient: a bad file or field is reported and skipped so one typo
// never blanks the whole roadmap. CI treats any issue as a failure. A problem
// that leaves part of a file out of the roadmap marks the file "lossy": the app
// won't write it, since that would delete what was left out.
//
// Two phases. parse.ts reads each file on its own (parseFile); this module
// puts the parsed files together and checks what spans files (assemble): ids,
// lanes and codes used twice, what boxes and people refer to, unexpected
// files. loadRoadmap() (parse.ts) does both. What a file parses to depends
// only on its path and text, so the app keeps it by git blob SHA and takes it
// from the build where it can (loadFolder): this module never needs the yaml
// library, and the app loads it only for a file no one has parsed yet.

import { FORMAT, type FormatStatus, formatStatus } from "./format.ts"; // with .ts: vite.config.ts imports this file
import { BOX_PATH, DEPARTMENT_PATH, isRoadmapPath } from "./paths.ts";
import type { Box, Department, Issue, Person, Reserved, ReservedDepartments, Roadmap, RoadmapFiles, Settings } from "./types.ts";

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

export const DEFAULT_DEPT_COLOR = "#8a94a6";

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

/** A problem found in one file. `ifNoDepartment`: a person's department, reported only if no department file has that id. */
export type FileIssue = Issue & { ifNoDepartment?: string };

/** Lines of a department's or box's top-level keys, for the problems found across files. */
export type Lines = Partial<Record<"id" | "code" | "lane" | "lanes" | "type" | "status" | "engineers" | "relations", number>>;

/**
 * What one file holds, on its own (parse.ts), and its problems in the order
 * found; null when the file is skipped. Plain JSON, the same wherever it's
 * made: the build puts these in roadmap.json (`parsed`, by blob SHA).
 */
export type ParsedFile = { path: string; issues: FileIssue[] } & (
  | { kind: "settings"; settings: Settings; format: number | null }
  | { kind: "people"; people: Person[] }
  | { kind: "department"; lines: Lines; department: Department | null }
  | { kind: "box"; lines: Lines; box: Box | null }
  /** Not a roadmap file: reported as unexpected. */
  | { kind: "other" }
);

/**
 * A problem in a file. `same` stands in for the message in the issue's key
 * when the message names other files, which an unrelated edit can change (see
 * Issue.key). `lossy`: part of the file is left out of the roadmap.
 */
export function fileIssue(path: string, message: string, line?: number, lossy = false, same = message): Issue {
  return { path, message, ...(line !== undefined && { line }), key: `${path}|${same}`, ...(lossy && { lossy: true as const }) };
}

/** A file that isn't a roadmap file: nothing in it is read. */
export const otherFile = (path: string): ParsedFile => ({ path, kind: "other", issues: [] });

/**
 * The parsed files (path → parseFile's result, for every file read) as a
 * roadmap, checking what spans files. `ignored`: other files a reader found
 * in the roadmap folder but didn't read (it reads only isRoadmapPath()
 * files); like any other file that isn't a roadmap file, each is reported as
 * unexpected. Never changes what it's given, so parsed files can be shared
 * between loads.
 */
export function assemble(parsed: Record<string, ParsedFile>, ignored: string[] = []): LoadResult {
  const issues: Issue[] = [];
  const paths = Object.keys(parsed).sort();
  const sources: Sources = { departments: new Map(), boxes: new Map() };
  const fail = (path: string, message: string, line?: number, same?: string) => issues.push(fileIssue(path, message, line, false, same));
  const drop = (path: string, message: string, line?: number) => issues.push(fileIssue(path, message, line, true));
  /** A file's own problems; a person's department is a problem only if no department has its id. */
  const take = (list: FileIssue[], departmentIds?: ReadonlySet<string>) => {
    for (const x of list) {
      if (x.ifNoDepartment === undefined) issues.push(x);
      else if (!departmentIds?.has(x.ifNoDepartment)) {
        const { ifNoDepartment: _, ...issue } = x;
        issues.push(issue);
      }
    }
  };
  const lines = (path: string): Lines => {
    const f = parsed[path];
    return f.kind === "department" || f.kind === "box" ? f.lines : {};
  };

  let settings = DEFAULT_SETTINGS;
  let format: number | null = 0;
  const settingsFile = parsed["settings.yaml"];
  if (settingsFile?.kind === "settings") {
    take(settingsFile.issues);
    ({ settings, format } = settingsFile);
  } else {
    fail("settings.yaml", `missing: every roadmap needs a settings.yaml with at least "format: ${FORMAT}"`);
  }

  const departments: Department[] = [];
  const laneOwner = new Map<string, string>();
  for (const path of paths.filter((p) => DEPARTMENT_PATH.test(p))) {
    const f = parsed[path];
    if (f.kind !== "department") continue;
    take(f.issues);
    const dept = f.department;
    if (!dept) continue;
    const other = sources.departments.get(dept.id);
    if (other) {
      // departments/x.yaml and departments/x.yml
      drop(path, `id: "${dept.id}" is already used by ${other}, so this file is skipped`, f.lines.id);
      continue;
    }
    sources.departments.set(dept.id, path);
    const lanes = dept.lanes.filter((lane) => {
      const owner = laneOwner.get(lane.id);
      if (!owner) {
        laneOwner.set(lane.id, dept.id);
        return true;
      }
      drop(path, `lane "${lane.id}" is already used in department "${owner}", so it's left out here`, f.lines.lanes);
      const ownerPath = sources.departments.get(owner)!;
      fail(ownerPath, `lane "${lane.id}" is also used in department "${dept.id}"`, lines(ownerPath).lanes);
      return false;
    });
    departments.push(lanes.length === dept.lanes.length ? dept : { ...dept, lanes });
  }
  // Report a shared code on every department that has it, not just the one that sorts later (keyed on the code, as for boxes).
  for (const dept of departments) {
    const others = departments.filter((d) => d !== dept && d.code !== "" && d.code === dept.code);
    const path = sources.departments.get(dept.id)!;
    if (others.length) fail(path, `code: "${dept.code}" is also used by department "${others[0].id}"`, lines(path).code, `code: "${dept.code}" shared`);
  }
  departments.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const peopleFile = parsed["people.yaml"];
  let people: Person[] = [];
  if (peopleFile?.kind === "people") {
    take(peopleFile.issues, new Set(departments.map((d) => d.id)));
    people = [...peopleFile.people];
  }
  const personIds = new Set(people.map((p) => p.id));

  const typeIds = new Set(settings.types.map((t) => t.id));
  const statusIds = new Set(settings.statuses.map((s) => s.id));
  const boxes: Box[] = [];
  for (const path of paths.filter((p) => BOX_PATH.test(p))) {
    const f = parsed[path];
    if (f.kind !== "box") continue;
    take(f.issues);
    const box = f.box;
    if (!box) continue;
    const other = sources.boxes.get(box.id);
    if (other) {
      drop(path, `id: "${box.id}" is already used by ${other}, so this file is skipped`, f.lines.id);
      continue;
    }
    if (!laneOwner.has(box.lane)) {
      drop(path, `lane: "${box.lane}" does not exist in any department, so the box is skipped`, f.lines.lane);
      continue;
    }
    if (!typeIds.has(box.type)) fail(path, `type: "${box.type}" is not defined in settings.yaml`, f.lines.type);
    if (box.status !== undefined && !statusIds.has(box.status)) fail(path, `status: "${box.status}" is not defined in settings.yaml`, f.lines.status);
    for (const id of box.engineers ?? []) {
      if (!personIds.has(id)) fail(path, `engineers: "${id}" is not in people.yaml`, f.lines.engineers);
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
    const path = sources.boxes.get(box.id)!;
    const others = byCode.get(box.code)!.filter((b) => b !== box);
    if (others.length) fail(path, `code: "${box.code}" is also used by ${others.map((b) => b.id).join(", ")}`, lines(path).code, `code: "${box.code}" shared`);
    for (const rel of box.relations ?? []) {
      if (!byCode.has(rel.box)) fail(path, `relations: no box has code "${rel.box}"`, lines(path).relations);
      else if (rel.box === box.code) fail(path, "relations: a box can't have a rule about itself", lines(path).relations);
    }
  }

  for (const path of [...new Set([...paths, ...ignored])].sort()) {
    if (isRoadmapPath(path)) continue;
    const misnamed = /^(settings|people)\.yml$/.exec(path);
    fail(path, misnamed ? `rename this file to ${misnamed[1]}.yaml` : "unexpected file; roadmap files live in departments/ or boxes/");
  }

  const lossy = new Map<string, string[]>();
  for (const issue of issues) {
    if (issue.lossy) lossy.set(issue.path, [...(lossy.get(issue.path) ?? []), issue.message]);
  }
  return { roadmap: { format, settings, departments, boxes, people }, issues, lossy, sources, formatStatus: formatStatus(format) };
}

/**
 * The ids and codes of box files the loader couldn't fully read (`lossy`):
 * new boxes mustn't take them, as a save over such a file is refused. The id
 * is the file's name; the code, its `code:` line, read as a person would grep
 * for it (the file may not parse at all).
 */
export function reservedBoxes(lossy: ReadonlyMap<string, unknown>, files: RoadmapFiles): Reserved {
  const codes = new Set<string>();
  const ids = new Set<string>();
  for (const path of lossy.keys()) {
    if (!BOX_PATH.test(path)) continue;
    ids.add(path.replace(/^.*\//, "").replace(/\.ya?ml$/, ""));
    const code = /^code:[ \t]*(["']?)([A-Z0-9]{3})\1[ \t]*(?:#.*)?\r?$/m.exec(files[path] ?? "")?.[2];
    if (code) codes.add(code);
  }
  return { codes, ids };
}

/**
 * What new departments and lanes mustn't take from files the loader couldn't
 * fully read (`lossy`), read as for reservedBoxes: the id of each such
 * department file (its name), the code of one whose department didn't load,
 * its lanes' ids (whether or not they loaded), and the lane each such box
 * file names (it may be in a department file that didn't load). A lane given
 * one of those ids would take in boxes that aren't its, or clash with that
 * file once it's fixed.
 */
export function reservedDepartments(lossy: ReadonlyMap<string, unknown>, files: RoadmapFiles, sources: Pick<Sources, "departments">): ReservedDepartments {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const lanes = new Set<string>();
  const loaded = new Set(sources.departments.values());
  for (const path of lossy.keys()) {
    const text = files[path] ?? "";
    if (DEPARTMENT_PATH.test(path)) {
      ids.add(path.replace(/^.*\//, "").replace(/\.ya?ml$/, ""));
      const code = /^code:[ \t]*(["']?)([A-Z][A-Z0-9]{1,3})\1[ \t]*(?:#.*)?\r?$/m.exec(text)?.[2];
      if (code && !loaded.has(path)) codes.add(code);
      // A lane's id: indented, in a list entry or in braces (the department's own is at the start of a line).
      for (const m of text.matchAll(/(?:^[ \t]*-[ \t]*|^[ \t]+|[{,][ \t]*)id:[ \t]*(["']?)([a-z0-9][\w-]*)\1/gim)) lanes.add(m[2]);
    } else if (BOX_PATH.test(path)) {
      const lane = /^lane:[ \t]*(["']?)([a-z0-9][\w-]*)\1[ \t]*(?:#.*)?\r?$/im.exec(text)?.[2];
      if (lane) lanes.add(lane);
    }
  }
  return { ids, codes, lanes };
}

// ---- In the app --------------------------------------------------------------

/** Blob SHA → what that file parsed to, for every file this tab has loaded or been given parsed: blobs never change. */
const parsedBlobs = new Map<string, ParsedFile>();

/** parse.ts's parseFile, once loaded. */
let parse: ((path: string, text: string) => ParsedFile) | undefined;
let parser: Promise<void> | undefined;

/**
 * Load the parser, and with it the yaml library: fetched on first use (a
 * file no one has parsed yet, or a save). Anything about to need it can
 * start it early. A failure (the app's files replaced by a deploy, say)
 * isn't kept, so a later call tries again, though a browser may give the
 * same failure until the page is reloaded.
 */
export function loadParser(): Promise<void> {
  parser ??= import("./parse.ts").then(
    (m) => {
      parse = m.parseFile;
    },
    (e: unknown) => {
      parser = undefined;
      throw e;
    },
  );
  return parser;
}

/**
 * Keep what these files (blob SHA → parsed file) parse to, so loading them
 * needs no parsing: a bundle's `parsed`. Blobs already known keep what they
 * had, so an unchanged box stays the same object from one load to the next.
 */
export function rememberParsed(files: Record<string, ParsedFile>): void {
  for (const [sha, file] of Object.entries(files)) if (!parsedBlobs.has(sha)) parsedBlobs.set(sha, file);
}

/** For tests: forget every parsed file. */
export function forgetParsed(): void {
  parsedBlobs.clear();
}

/** A roadmap folder as the app holds it: the files, their git blob SHAs and the folder's other files. */
export interface Folder {
  files: RoadmapFiles;
  blobs: Record<string, string>;
  ignored: string[];
}

/**
 * The folder as loadRoadmap() would load it, parsing only the files no
 * earlier load or bundle has: a deployed copy the build parsed loads without
 * the yaml library.
 */
export async function loadFolder(folder: Folder): Promise<LoadResult> {
  const now = loadFolderNow(folder);
  if (now) return now;
  await loadParser();
  return loadFolderNow(folder)!;
}

/** loadFolder() without waiting: null if a file needs parsing and the parser isn't loaded (a save always loads it). */
export function loadFolderNow(folder: Folder): LoadResult | null {
  const parsed: Record<string, ParsedFile> = {};
  const todo: string[] = [];
  for (const path of Object.keys(folder.files)) {
    const known = parsedBlobs.get(folder.blobs[path]);
    // The same blob can be at two paths (a copied file): what it parses to depends on the path too.
    if (known?.path === path) parsed[path] = known;
    else if (!isRoadmapPath(path)) parsed[path] = otherFile(path);
    else todo.push(path);
  }
  if (todo.length && !parse) return null;
  for (const path of todo) {
    const file = (parsed[path] = parse!(path, folder.files[path]));
    const sha = folder.blobs[path];
    if (sha !== undefined) parsedBlobs.set(sha, file);
  }
  return assemble(parsed, folder.ignored);
}
