// `npm run validate` and `npm run report` in web/: the command-line tool's
// validate and report (cli/boxops.ts) on the roadmap folder given as their
// only argument (`npm run validate -- <dir>`), else ../roadmap. The folder is
// read from disk with cli/git.ts's reader: a symlink, a file that isn't UTF-8
// or one over the size limits stops the check (exit 1) before anything is
// validated.

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { main } from "../cli/boxops";
import { defaultIo } from "../cli/context";

/** Where the command was typed: npm runs scripts in web/, but says where it was run in INIT_CWD. */
const here = process.env.INIT_CWD ?? process.cwd();

/** Runs `command` on the folder named on the command line; returns the exit code. */
export async function runOnRoadmapArg(command: "validate" | "report"): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    console.error(`Usage: npm run ${command} -- [roadmap folder]   (default: ../roadmap)`);
    return 2;
  }
  // A folder given is relative to where the command was typed; the default, to web/.
  const dir = args[0] === undefined ? resolve("../roadmap") : resolve(here, args[0]);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`No roadmap folder at ${dir}`);
    return 2;
  }
  return main([command, dir], {}, { ...defaultIo(), cwd: here });
}
