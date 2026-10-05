// The roadmap folder a command-line check reads: the one given as its only
// argument (`npm run validate -- <dir>`), else ../roadmap. Read from disk with
// cli/git.ts's reader: a symlink, a file that isn't UTF-8 or one over the size
// limits stops the check (exit 1) before anything is validated.

import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { RoadmapReadError, readRoadmapDir } from "../cli/git";
import { loadRoadmap } from "../src/model/load";
import type { Issue } from "../src/model/types";

/** Where the command was typed: npm runs scripts in web/, but says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd();

export async function loadRoadmapArg(command: string) {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error(`Usage: npm run ${command} -- [roadmap folder]   (default: ../roadmap)`);
    process.exit(2);
  }
  // A folder given is relative to where the command was typed; the default, to web/.
  const dir = args[0] === undefined ? resolve("../roadmap") : resolve(here, args[0]);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`No roadmap folder at ${dir}`);
    process.exit(2);
  }
  try {
    const { files, ignored } = await readRoadmapDir(dir);
    return { dir, ...loadRoadmap(files, ignored) };
  } catch (e) {
    if (!(e instanceof RoadmapReadError)) throw e;
    for (const problem of e.problems) console.error(issueLine(dir, problem));
    process.exit(1);
  }
}

/** `../roadmap/people.yaml:12: …`: a path editors and terminals can open (relative to where the command was typed, unless that's longer). */
export function issueLine(dir: string, issue: Pick<Issue, "path" | "message" | "line">): string {
  const full = join(dir, issue.path);
  const near = relative(here, full);
  return `${near.length < full.length ? near : full}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`;
}
