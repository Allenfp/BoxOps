// A roadmap folder for the command-line tool: read from disk (validate,
// report, migrate, preview) and summed up in the lines every command and the
// action print. Node-only.

import { join, relative } from "node:path";
import { thousands } from "../src/model/count.ts";
import type { RoadmapFolder } from "../src/model/bundle.ts";
import type { LoadResult } from "../src/model/load.ts";
import { loadRoadmap } from "../src/model/parse.ts";
import { type Report, formatReport } from "../src/model/report.ts";
import type { Issue, Roadmap } from "../src/model/types.ts";
import { type ReadProblem, RoadmapReadError, readRoadmapDir } from "./git.ts";

/** `3 departments, 9 lanes, 16 boxes — OK` (or `— 2 issue(s)`): what `validate` ends with, and the action's `result`. */
export function resultLine(roadmap: Roadmap, problems: number): string {
  const lanes = roadmap.departments.reduce((n, d) => n + d.lanes.length, 0);
  return (
    `${thousands(roadmap.departments.length)} departments, ${thousands(lanes)} lanes, ${thousands(roadmap.boxes.length)} boxes — ` +
    (problems ? `${thousands(problems)} issue(s)` : "OK")
  );
}

/** The report's departments (capacity), then how many of everything else it lists: the job summary's capacity part. */
export function headlines(report: Report): string {
  const departments = formatReport(report).split("\n\n")[0];
  const count = (n: number) => (n ? thousands(n) : "none");
  return [
    departments,
    "",
    `Engineers over 1 FTE: ${count(report.people.filter((p) => p.over.length).length)}`,
    `Engineers booked during PTO: ${count(report.onPto.length)}`,
    `Boxes with no engineer: ${count(report.unassigned.length)}`,
    `Broken rules between boxes: ${count(report.ruleWarnings.length)}`,
  ].join("\n");
}

/**
 * `roadmap/people.yaml:12: …`: a path editors and terminals can open, relative
 * to `here` (where the command was typed) unless that's longer.
 */
export function issueLine(dir: string, issue: Pick<Issue, "path" | "message" | "line">, here: string): string {
  const full = join(dir, issue.path);
  const near = relative(here, full);
  return `${near.length < full.length ? near : full}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`;
}

/**
 * The roadmap folder at `dir` on disk, read (cli/git.ts: lstat, so a symlink
 * is an error) and loaded. A folder that can't be read as it is gives its
 * problems as `unreadable`, and no roadmap.
 */
export async function loadDir(dir: string): Promise<({ folder: RoadmapFolder; unreadable: null } & LoadResult) | { folder: null; unreadable: ReadProblem[] }> {
  try {
    const folder = await readRoadmapDir(dir);
    return { folder, ...loadRoadmap(folder.files, folder.ignored), unreadable: null };
  } catch (e) {
    if (!(e instanceof RoadmapReadError)) throw e;
    return { folder: null, unreadable: e.problems };
  }
}
