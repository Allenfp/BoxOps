// The roadmap folder a command-line check reads: the one given as its only
// argument (`npm run validate -- <dir>`), else ../roadmap.

import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readRoadmapDir } from "../src/model/files";
import { loadRoadmap } from "../src/model/load";
import type { Issue } from "../src/model/types";

/** Where the command was typed: npm runs scripts in web/, but says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd();

export function loadRoadmapArg(command: string) {
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
  return { dir, ...loadRoadmap(readRoadmapDir(dir)) };
}

/** `../roadmap/people.yaml:12: …`: a path editors and terminals can open (relative to where the command was typed, unless that's longer). */
export function issueLine(dir: string, issue: Issue): string {
  const full = join(dir, issue.path);
  const near = relative(here, full);
  return `${near.length < full.length ? near : full}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`;
}
